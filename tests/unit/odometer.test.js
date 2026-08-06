// tests/unit/odometer.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderOdometer, updateOdometer } from '../../dashboard/js/odometer.js';

/**
 * Capture globalThis.setTimeout so odometer transition fallbacks (650 ms)
 * can be driven synchronously via runAll() instead of waiting in real time.
 */
function captureTimers() {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let nextId = 1;
  /** @type {Map<number, Function>} */
  const scheduled = new Map();
  globalThis.setTimeout = (cb) => { const id = nextId++; scheduled.set(id, cb); return id; };
  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
  return {
    /** Fire every scheduled callback, including any scheduled during firing. */
    runAll() {
      let guard = 0;
      while (scheduled.size > 0 && guard++ < 100) {
        const pending = [...scheduled.values()];
        scheduled.clear();
        pending.forEach((cb) => cb());
      }
    },
    restore() {
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
    }
  };
}

describe('odometer', () => {
  let el;

  beforeEach(() => {
    document.body.innerHTML = '<div id="odo"></div>';
    el = document.getElementById('odo');
  });

  it('renders static digit columns with no transform on first build', () => {
    renderOdometer(el, '1,234');
    const digits = el.querySelectorAll('.odo-digit');
    expect(digits.length).toBe(4); // '1', '2', '3', '4' — comma is a static char
    const statics = el.querySelectorAll('.odo-static');
    expect(statics.length).toBe(1);
    expect(statics[0].textContent).toBe(',');
    digits.forEach((d) => {
      const strip = d.querySelector('.odo-digit-strip');
      expect(strip.style.transform).toBe('');
    });
  });

  it('delegates to a full rebuild when called without a prior render', () => {
    updateOdometer(el, '42');
    expect(el.querySelectorAll('.odo-digit').length).toBe(2);
  });

  it('rolls only the digit column(s) that actually changed', () => {
    renderOdometer(el, '1,234');
    updateOdometer(el, '1,235');

    const digitCols = el.querySelectorAll('.odo-digit');
    // last digit (4 -> 5) should have a rowNext appended (mid-roll)
    const lastStrip = digitCols[digitCols.length - 1].querySelector('.odo-digit-strip');
    expect(lastStrip.children.length).toBe(2);
    // an unchanged digit column should still have exactly one row
    const firstStrip = digitCols[0].querySelector('.odo-digit-strip');
    expect(firstStrip.children.length).toBe(1);
  });

  it('rebuilds instead of rolling when the digit count changes', () => {
    renderOdometer(el, '999');
    updateOdometer(el, '1,000');

    expect(el.querySelectorAll('.odo-digit').length).toBe(4);
    expect(el.querySelectorAll('.odo-static').length).toBe(1);
  });

  it('ignores a call with an unchanged value (no-op, no busy columns left dangling)', () => {
    renderOdometer(el, '1,234');
    updateOdometer(el, '1,234');

    el.querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1);
    });
  });

  it('treats Arabic-Indic glyphs as digits and ٬ as a static separator via the locale codec', () => {
    const RealNF = Intl.NumberFormat;
    const timers = captureTimers();
    try {
      Intl.NumberFormat = class extends RealNF {
        constructor(locale, opts) { super(locale || 'ar-EG', opts); }
      };

      renderOdometer(el, '١٬٢٣٤');
      const digits = el.querySelectorAll('.odo-digit');
      expect(digits).toHaveLength(4);
      const statics = el.querySelectorAll('.odo-static');
      expect(statics).toHaveLength(1);
      expect(statics[0].textContent).toBe('٬');

      updateOdometer(el, '١٬٢٣٥');
      const strips = el.querySelectorAll('.odo-digit-strip');
      const lastStrip = strips[strips.length - 1];
      expect(lastStrip.children).toHaveLength(2); // mid-roll
      expect(lastStrip.lastChild.textContent).toBe('٥'); // target glyph, not '5'

      timers.runAll();
      expect(el.textContent).toContain('١٬٢٣٥');
    } finally {
      timers.restore();
      Intl.NumberFormat = RealNF;
    }
  });

  it('settles the newest of rapid updates while a column is busy (newest-target replay)', () => {
    const timers = captureTimers();
    try {
      renderOdometer(el, '1,001');
      updateOdometer(el, '1,002');
      updateOdometer(el, '1,003');
      timers.runAll();
      expect(el.textContent).toContain('1,003');
    } finally {
      timers.restore();
    }
  });

  it('settles a same-value rollback requested while a transition is still in flight', () => {
    const timers = captureTimers();
    try {
      renderOdometer(el, '1,001');
      updateOdometer(el, '1,002');
      updateOdometer(el, '1,001');
      timers.runAll();
      expect(el.textContent).toContain('1,001');
    } finally {
      timers.restore();
    }
  });
});