// tests/unit/odometer.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderOdometer, updateOdometer } from '../../dashboard/js/odometer.js';

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
});