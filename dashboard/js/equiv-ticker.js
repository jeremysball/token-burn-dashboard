// dashboard/js/equiv-ticker.js
import { formatFactoid } from './equiv-format.js';

const CORPUS_URL = '/data/factoids-1000.json';
const SAMPLE_SIZE = 25;
const ROTATE_MS = 4200;
const FADE_MS = 350;

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

function ensureCorpusLoaded() {
    if (corpusFetchPromise) return corpusFetchPromise;
    corpusFetchPromise = fetch(CORPUS_URL)
        .then((r) => {
            if (!r.ok) throw new Error(`corpus fetch failed: ${r.status}`);
            return r.json();
        })
        .then((data) => { corpus = data; })
        .catch((err) => {
            console.warn('equivalence corpus fetch failed, staying on curated lines only', err);
        });
    return corpusFetchPromise;
}

/** @type {Record<string, {n: number, lines: string[]}>} */
let _buildLinesCache = {};

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
 * Start (or hand fresh lines to) a ticker's rotation. Re-sampled lines are
 * applied without restarting an in-flight rotation, so a per-render call
 * never interrupts a fade transition already underway.
 * @param {any} el
 * @param {string[]} lines
 */
function ensureRunning(el, lines) {
    el._equivLines = lines;
    if (el._equivIntervalId) return;

    const textEl = el.querySelector('.equiv-text');
    if (!textEl) return;
    let i = 0;
    textEl.innerHTML = el._equivLines[0] || '';

    const next = () => {
        if (!el._equivLines.length) return;
        textEl.classList.add('fade');
        setTimeout(() => {
            i = (i + 1) % el._equivLines.length;
            textEl.innerHTML = el._equivLines[i];
            textEl.classList.remove('fade');
        }, FADE_MS);
    };
    el._equivIntervalId = setInterval(next, ROTATE_MS);
}

export function initEquivTickers() {
    ensureCorpusLoaded();
}

/**
 * @param {{tokens?: number, cost?: number, burnRate?: number}} values
 */
export function updateEquivTickers(values) {
    const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
    tickers.forEach((el) => {
        const category = /** @type {HTMLElement} */ (el).dataset.equivCategory;
        const n = category ? values[/** @type {'tokens'|'cost'|'burnRate'} */ (category)] : undefined;
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
        const lines = buildLines(/** @type {string} */ (category), n);
        if (!lines.length) return;
        ensureRunning(el, lines);
    });
}

export function resetEquivTickersForTest() {
    corpus = null;
    corpusFetchPromise = null;
    _buildLinesCache = {};
    document.querySelectorAll('.equiv-ticker').forEach((el) => {
        if (/** @type {any} */ (el)._equivIntervalId) clearInterval(/** @type {any} */ (el)._equivIntervalId);
        /** @type {any} */ (el)._equivIntervalId = null;
        /** @type {any} */ (el)._equivLines = undefined;
    });
}