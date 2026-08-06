// dashboard/js/odometer.js
/**
 * @typedef {Object} OdoColumn
 * @property {HTMLElement} strip
 * @property {HTMLElement} rowCur
 * @property {number} digit
 * @property {boolean} busy
 * @property {number|null} pendingDigit
 */

/**
 * @typedef {Object} DigitCodec
 * @property {string} probe
 * @property {string[]} digitToGlyph
 * @property {Map<string, number>} glyphToDigit
 */

/**
 * @typedef {Object} OdoState
 * @property {Array<OdoColumn|string>} digitCols
 * @property {string} valueStr
 * @property {string|null} pendingValueStr
 */

/**
 * Locale digit codec: maps each decimal digit to the glyph emitted by the
 * active Intl.NumberFormat locale (e.g. '1' in en-US, '١' in ar-EG) and maps
 * those glyphs back to digit values. Built lazily and rebuilt whenever the
 * active locale stops matching the cached glyphs, so a test that temporarily
 * swaps Intl.NumberFormat takes effect regardless of test ordering.
 * @type {DigitCodec|null}
 */
let digitCodec = null;
const getDigitCodec = () => {
    const formatter = new Intl.NumberFormat(undefined, { useGrouping: false });
    const probe = formatter.format(1);
    if (digitCodec && digitCodec.probe === probe) return digitCodec;
    const digitToGlyph = [];
    const glyphToDigit = new Map();
    for (let d = 0; d <= 9; d++) {
        const glyph = formatter.format(d);
        digitToGlyph.push(glyph);
        glyphToDigit.set(glyph, d);
    }
    digitCodec = { probe, digitToGlyph, glyphToDigit };
    return digitCodec;
};

/** @param {string} codePoint @returns {number|null} the digit a code point represents, or null for static text */
const codecValue = (codePoint) => getDigitCodec().glyphToDigit.get(codePoint) ?? null;

/** Transition fallback in case 'transitionend' never fires (reduced-motion, headless DOM). */
const SETTLE_FALLBACK_MS = 650;

/**
 * Per-element odometer state, keyed by the container element so multiple
 * odometers can coexist on one page without global mutable state.
 * Each digitCols slot is either a column object or the static separator text.
 * @type {WeakMap<HTMLElement, OdoState>}
 */
const odometerState = new WeakMap();

/**
 * (Re)build el's digit columns from scratch, showing valueStr immediately
 * with no roll animation. Digit glyphs come from the locale codec; non-digit
 * code points (commas, group separators, currency symbols) render as plain
 * static spans. Stores the currently displayed string plus a null newest
 * pending target.
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function renderOdometer(el, valueStr) {
    const { digitToGlyph } = getDigitCodec();
    el.innerHTML = '';
    /** @type {OdoState['digitCols']} */
    const digitCols = [];

    Array.from(valueStr).forEach((codePoint) => {
        const digit = codecValue(codePoint);
        if (digit == null) {
            const staticEl = document.createElement('span');
            staticEl.className = 'odo-static';
            staticEl.textContent = codePoint;
            el.appendChild(staticEl);
            digitCols.push(codePoint);
            return;
        }
        const col = document.createElement('span');
        col.className = 'odo-digit';
        const strip = document.createElement('span');
        strip.className = 'odo-digit-strip';
        const rowCur = document.createElement('span');
        rowCur.textContent = digitToGlyph[digit];
        strip.appendChild(rowCur);
        col.appendChild(strip);
        el.appendChild(col);
        digitCols.push({ strip, rowCur, digit, busy: false, pendingDigit: null });
    });

    odometerState.set(el, { digitCols, valueStr, pendingValueStr: null });
}

/**
 * Roll one digit column to `digit`. On settle, atomically set the displayed
 * row, clear the busy flag, re-roll to any newer pending digit recorded for
 * the column, and then drain the odometer toward its newest pending target.
 * @param {HTMLElement} el
 * @param {OdoState} state
 * @param {OdoColumn} col
 * @param {number} digit
 */
const startRoll = (el, state, col, digit) => {
    const glyph = getDigitCodec().digitToGlyph[digit];
    if (col.digit === digit) return;
    col.busy = true;
    col.pendingDigit = null;
    const rowNext = document.createElement('span');
    rowNext.textContent = glyph;
    col.strip.appendChild(rowNext);
    col.strip.style.transform = 'translateY(-1em)';

    let done = false;
    const settle = () => {
        if (done) return;
        done = true;
        if (!col.strip.isConnected) return; // element was rebuilt; drop the stale roll
        col.strip.style.transition = 'none';
        col.rowCur.textContent = glyph;
        col.strip.removeChild(rowNext);
        col.strip.style.transform = 'translateY(0)';
        // force reflow before re-enabling transition
        col.strip.getBoundingClientRect();
        col.strip.style.transition = '';
        col.digit = digit;
        col.busy = false;
        const next = col.pendingDigit;
        col.pendingDigit = null;
        if (next != null && next !== col.digit) {
            startRoll(el, state, col, next);
            return;
        }
        drain(el, state);
    };
    col.strip.addEventListener('transitionend', settle, { once: true });
    setTimeout(settle, SETTLE_FALLBACK_MS);
};

/** @param {OdoState} state @returns {string} the string currently committed to the DOM */
const displayedString = (state) => state.digitCols
    .map((slot) => typeof slot === 'string' ? slot : getDigitCodec().digitToGlyph[slot.digit])
    .join('');

/**
 * After a transition settles, compare the displayed string against the newest
 * pending target and roll any eligible column toward it. A later update
 * replaces an older pending target rather than queuing an unbounded sequence;
 * pendingValueStr clears only once the display matches it.
 * @param {HTMLElement} el
 * @param {OdoState} state
 */
const drain = (el, state) => {
    const pending = state.pendingValueStr;
    if (pending == null) return;
    if (displayedString(state) === pending) {
        state.valueStr = pending;
        state.pendingValueStr = null;
        return;
    }
    Array.from(pending).forEach((codePoint, idx) => {
        const slot = state.digitCols[idx];
        if (typeof slot === 'string') return;
        const digit = codecValue(codePoint);
        if (digit == null || digit === slot.digit) return;
        if (slot.busy) {
            slot.pendingDigit = digit;
            return;
        }
        startRoll(el, state, slot, digit);
    });
};

/**
 * Roll el's digit columns to reflect valueStr, animating only the columns
 * whose digit actually changed. Records the newest requested string even when
 * one or more columns are busy and drains it once each transition settles.
 * Rebuilds immediately for a layout change (digit count or static separator
 * layout), and falls back to a full renderOdometer() when el has no prior
 * state.
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function updateOdometer(el, valueStr) {
    const state = odometerState.get(el);
    if (!state) {
        renderOdometer(el, valueStr);
        return;
    }
    if (valueStr === state.valueStr && state.pendingValueStr == null) return;

    const codePoints = Array.from(valueStr);
    const layoutChanged = codePoints.length !== state.digitCols.length || codePoints.some((codePoint, i) => {
        const digit = codecValue(codePoint);
        const slot = state.digitCols[i];
        if (digit != null) return typeof slot === 'string';
        return typeof slot !== 'string' || slot !== codePoint;
    });
    if (layoutChanged) {
        renderOdometer(el, valueStr);
        return;
    }

    state.pendingValueStr = valueStr;
    codePoints.forEach((codePoint, idx) => {
        const slot = state.digitCols[idx];
        if (typeof slot === 'string') return;
        const digit = codecValue(codePoint);
        if (digit == null || digit === slot.digit) return;
        if (slot.busy) {
            slot.pendingDigit = digit;
            return;
        }
        startRoll(el, state, slot, digit);
    });
}
