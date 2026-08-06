// dashboard/js/equiv-ticker.js
import { formatFactoid } from './equiv-format.js';

const CORPUS_URL = '/data/factoids-1000.json';
const SAMPLE_SIZE = 25;
const ROTATE_MS = 4200;
const FADE_MS = 350;

const SUPPORTED_CATEGORIES = ['tokens', 'cost', 'burnRate'];

// Real-data-derived, hand-checked lines kept inline (not sourced from the
// corpus) so the ticker never goes blank while the corpus fetch is pending,
// and stays meaningful even if it never resolves (Section 5 of the spec).
/** @type {Record<string, string[]>} */
const CURATED_FALLBACK = {
    tokens: [
        'the ~497k-line codebase, regenerated from scratch, <b>~{n/4970000:.0f}×</b> over',
        '<b>War and Peace</b>, cover-to-cover, roughly <b>{n/763000:.0f} times</b>',
        '<b>~{n*4/200/60/24/365:.0f} years</b> of an engineer typing non-stop, 24/7, at 200 chars/min'
    ],
    cost: [
        '<b>{n/80:.0f} hours</b> of senior engineer time at $80/hr',
        'roughly <b>{n/28000:.1f}×</b> a well-used Miata (informal reference point)'
    ],
    burnRate: [
        'the whole codebase, rebuilt from scratch, every <b>~{4970000/n:.1f} minutes</b>',
        '≈ <b>{n/1000000:.2f}M</b> tokens every minute, before cache discounts'
    ]
};

/** @type {any[]|null} */
let corpus = null;

/** @type {Promise<void>|null} */
let corpusFetchPromise = null;

/** @type {Record<string, {n: number, lines: string[]}>} */
let _buildLinesCache = {};

/**
 * Partial Fisher-Yates: shuffles only the first k elements so we can
 * stop early instead of shuffling the entire filtered set.
 * @param {any[]} arr
 * @param {number} k
 * @returns {any[]}
 */
function partialShuffle(arr, k) {
    const copy = arr.slice();
    const n = Math.min(k, copy.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
}

/**
 * Validate a corpus response before it becomes the active corpus. Only
 * supported categories with nonblank string `copy` values are kept, and every
 * supported category must end up with at least one usable entry, so a
 * malformed, partial, or unknown-category payload never silently blanks a
 * ticker line. The caller assigns the result atomically or keeps the curated
 * fallback.
 * @param {any} data
 * @returns {any[]|null}
 */
function normalizeCorpus(data) {
    if (!Array.isArray(data)) return null;
    const usable = data.filter((factoid) => {
        if (!factoid || typeof factoid !== 'object') return false;
        if (!SUPPORTED_CATEGORIES.includes(factoid.category)) return false;
        return typeof factoid.copy === 'string' && factoid.copy.trim() !== '';
    });
    if (usable.length === 0) return null;
    for (const category of SUPPORTED_CATEGORIES) {
        if (!usable.some((factoid) => factoid.category === category)) return null;
    }
    return usable;
}

function ensureCorpusLoaded() {
    if (corpusFetchPromise) return corpusFetchPromise;
    corpusFetchPromise = fetch(CORPUS_URL)
        .then((r) => {
            if (!r.ok) throw new Error(`corpus fetch failed: ${r.status}`);
            return r.json();
        })
        .then((data) => {
            const normalized = normalizeCorpus(data);
            if (!normalized) {
                console.warn('equivalence corpus fetch failed, staying on curated lines only', { reason: 'malformed corpus' });
                return;
            }
            corpus = normalized;
            _buildLinesCache = {};
            refreshMountedTickers();
        })
        .catch((err) => {
            console.warn('equivalence corpus fetch failed, staying on curated lines only', err);
        });
    return corpusFetchPromise;
}

/**
 * @param {string} category
 * @param {number} n
 * @returns {string[]}
 */
function buildLines(category, n) {
    if (_buildLinesCache[category] && _buildLinesCache[category].n === n) {
        return _buildLinesCache[category].lines;
    }
    const curated = (CURATED_FALLBACK[category] || []).map((t) => formatFactoid(t, n));
    if (!corpus) return curated;
    const sample = partialShuffle(corpus.filter((f) => f.category === category), SAMPLE_SIZE);
    const lines = sample.map((f) => formatFactoid(f.copy, n));
    _buildLinesCache[category] = { n, lines };
    return lines;
}

/**
 * Rebuild lines for every mounted ticker from its stored last value, so a
 * corpus that resolves after the first render swaps fallback text for corpus
 * text without forcing another dashboard render.
 */
function refreshMountedTickers() {
    const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
    tickers.forEach((el) => {
        const mounted = /** @type {any} */ (el);
        const n = mounted._equivLastValue;
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
        const lines = buildLines(mounted.dataset.equivCategory, n);
        if (!lines.length) return;
        ensureRunning(mounted, lines);
    });
}

/**
 * Start (or hand fresh lines to) a ticker's rotation. Re-sampled lines are
 * applied without restarting an in-flight rotation, so a per-render call or an
 * async corpus refresh never interrupts a fade transition already underway.
 * The rotation index and fade timeout live on the element, letting an async
 * refresh replace `_equivLines` while the running interval keeps its identity.
 * @param {any} el
 * @param {string[]} lines
 */
function ensureRunning(el, lines) {
    el._equivLines = lines;
    if (el._equivIntervalId) return;

    const textEl = el.querySelector('.equiv-text');
    if (!textEl) return;
    if (typeof el._equivRotationIndex !== 'number' || el._equivRotationIndex >= lines.length) {
        el._equivRotationIndex = 0;
    }
    if (el._equivFadeTimeout === undefined) el._equivFadeTimeout = null;
    textEl.innerHTML = el._equivLines[el._equivRotationIndex] || '';

    const next = () => {
        if (!el._equivLines.length) return;
        textEl.classList.add('fade');
        const fadeTimeout = setTimeout(() => {
            if (el._equivFadeTimeout !== fadeTimeout) return;
            el._equivFadeTimeout = null;
            el._equivRotationIndex = (el._equivRotationIndex + 1) % el._equivLines.length;
            textEl.innerHTML = el._equivLines[el._equivRotationIndex];
            textEl.classList.remove('fade');
        }, FADE_MS);
        el._equivFadeTimeout = fadeTimeout;
    };
    el._equivIntervalId = setInterval(next, ROTATE_MS);
}

/**
 * Fully reset a mounted ticker so an invalid value never leaves a stale
 * interval, pending fade, leftover lines, or visible text behind.
 * @param {any} el
 */
function clearTicker(el) {
    el._equivLastValue = undefined;
    if (el._equivIntervalId) clearInterval(el._equivIntervalId);
    el._equivIntervalId = null;
    if (el._equivFadeTimeout) clearTimeout(el._equivFadeTimeout);
    el._equivFadeTimeout = null;
    el._equivLines = [];
    el._equivRotationIndex = 0;
    const textEl = el.querySelector('.equiv-text');
    if (textEl) {
        textEl.textContent = '';
        textEl.classList.remove('fade');
    }
}

/**
 * Start the one corpus request (or reuse the in-flight one) and resolve after
 * either a valid corpus is installed or the curated fallback stays active
 * after a fetch/parse failure.
 * @returns {Promise<void>}
 */
export function initEquivTickers() {
    return ensureCorpusLoaded();
}

/**
 * @param {{tokens?: number, cost?: number, burnRate?: number}} values
 */
export function updateEquivTickers(values) {
    const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
    tickers.forEach((el) => {
        const mounted = /** @type {any} */ (el);
        const category = mounted.dataset.equivCategory;
        const n = category ? values[/** @type {'tokens'|'cost'|'burnRate'} */ (category)] : undefined;
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
            mounted._equivLastValue = n;
            const lines = buildLines(/** @type {string} */ (category), n);
            if (!lines.length) return;
            ensureRunning(mounted, lines);
        } else {
            clearTicker(mounted);
        }
    });
}

export function resetEquivTickersForTest() {
    corpus = null;
    corpusFetchPromise = null;
    _buildLinesCache = {};
    document.querySelectorAll('.equiv-ticker').forEach((el) => {
        if (/** @type {any} */ (el)._equivIntervalId) clearInterval(/** @type {any} */ (el)._equivIntervalId);
        if (/** @type {any} */ (el)._equivFadeTimeout) clearTimeout(/** @type {any} */ (el)._equivFadeTimeout);
        /** @type {any} */ (el)._equivIntervalId = null;
        /** @type {any} */ (el)._equivFadeTimeout = null;
        /** @type {any} */ (el)._equivLines = undefined;
        /** @type {any} */ (el)._equivLastValue = undefined;
        /** @type {any} */ (el)._equivRotationIndex = undefined;
    });
}