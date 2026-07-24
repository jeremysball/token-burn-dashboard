/* global Bun */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

describe('animateNumber', () => {
  let animateNumber;
  let getSavedTheme;

  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="view-dashboard"></div>
      <div id="view-analytics"></div>
    `;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    global.fetch = mock().mockRejectedValue(new Error('test fetch'));
    ({ animateNumber, getSavedTheme } = await import('../../dashboard/js/main.js'));
  });

  it('preserves decimal string display values', async () => {
    const element = document.createElement('span');

    animateNumber(element, '0.00', '2.50', 0, '$');
    await Bun.sleep(20);

    expect(element.textContent).toBe('$2.50');
  });

  it('uses fmtNum for numeric token totals', async () => {
    const element = document.createElement('span');

    animateNumber(element, 0, 2_500_000_000, 0);
    await Bun.sleep(20);

    expect(element.textContent).toBe('2.50B');
  });

  it('uses the dark theme when localStorage is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('Storage is unavailable'); }
    });

    expect(getSavedTheme()).toBe('dark');

    Object.defineProperty(window, 'localStorage', descriptor);
  });
});
