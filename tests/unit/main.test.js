/**
 * @jest-environment jsdom
 */

describe('animateNumber', () => {
  let animateNumber;

  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="view-dashboard"></div>
      <div id="view-analytics"></div>
    `;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    global.fetch = jest.fn().mockRejectedValue(new Error('test fetch'));
    ({ animateNumber } = await import('../../dashboard/js/main.js'));
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves decimal string display values', () => {
    const element = document.createElement('span');

    animateNumber(element, '0.00', '2.50', 0, '$');
    jest.runOnlyPendingTimers();

    expect(element.textContent).toBe('$2.50');
  });

  it('uses fmtNum for numeric token totals', () => {
    const element = document.createElement('span');

    animateNumber(element, 0, 2_500_000_000, 0);
    jest.runOnlyPendingTimers();

    expect(element.textContent).toBe('2.50B');
  });
});
