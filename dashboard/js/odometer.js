// dashboard/js/odometer.js
/**
 * Per-element odometer state, keyed by the container element so multiple
 * odometers can coexist on one page without global mutable state.
 * @type {WeakMap<HTMLElement, {digitCols: Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>, valueStr: string}>}
 */
const odometerState = new WeakMap();

/**
 * (Re)build el's digit columns from scratch, showing valueStr immediately
 * with no roll animation. Non-digit characters (commas, currency symbols)
 * render as plain static spans.
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function renderOdometer(el, valueStr) {
    el.innerHTML = '';
    /** @type {Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>} */
    const digitCols = [];

    valueStr.split('').forEach((ch) => {
        if (ch < '0' || ch > '9') {
            const staticEl = document.createElement('span');
            staticEl.className = 'odo-static';
            staticEl.textContent = ch;
            el.appendChild(staticEl);
            digitCols.push(null);
            return;
        }
        const col = document.createElement('span');
        col.className = 'odo-digit';
        const strip = document.createElement('span');
        strip.className = 'odo-digit-strip';
        const rowCur = document.createElement('span');
        rowCur.textContent = ch;
        strip.appendChild(rowCur);
        col.appendChild(strip);
        el.appendChild(col);
        digitCols.push({ strip, rowCur, digit: parseInt(ch, 10), busy: false });
    });

    odometerState.set(el, { digitCols, valueStr });
}

/**
 * Roll el's digit columns to reflect valueStr, animating only the columns
 * whose digit actually changed. Falls back to a full, unanimated
 * renderOdometer() when el has no prior state or the digit count changed
 * (e.g. '999' -> '1,000').
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function updateOdometer(el, valueStr) {
    const state = odometerState.get(el);
    const chars = valueStr.split('');
    if (!state || chars.length !== state.digitCols.length) {
        renderOdometer(el, valueStr);
        return;
    }
    if (valueStr === state.valueStr) return;

    let anySkipped = false;
    chars.forEach((ch, idx) => {
        const col = state.digitCols[idx];
        if (!col) return; // static char
        const digit = parseInt(ch, 10);
        if (digit === col.digit) return;
        if (col.busy) { anySkipped = true; return; }

        col.busy = true;
        const rowNext = document.createElement('span');
        rowNext.textContent = String(digit);
        col.strip.appendChild(rowNext);
        col.strip.style.transform = 'translateY(-1em)';

        let done = false;
        const settle = () => {
            if (done) return;
            done = true;
            col.strip.style.transition = 'none';
            col.rowCur.textContent = String(digit);
            col.strip.removeChild(rowNext);
            col.strip.style.transform = 'translateY(0)';
            // force reflow before re-enabling transition
            col.strip.getBoundingClientRect();
            col.strip.style.transition = '';
            col.digit = digit;
            col.busy = false;
        };
        col.strip.addEventListener('transitionend', settle, { once: true });
        setTimeout(settle, 650); // fallback in case transitionend doesn't fire (e.g. reduced-motion, headless DOM)
    });

    if (!anySkipped) state.valueStr = valueStr;
}