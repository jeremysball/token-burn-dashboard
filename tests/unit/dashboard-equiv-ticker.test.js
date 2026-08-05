// tests/unit/dashboard-equiv-ticker.test.js
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
import { resetEquivTickersForTest, updateEquivTickers } from '../../dashboard/js/equiv-ticker.js';

function captureTimers() {
  const real = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  let intervalCallbacks = [];
  let nextId = 100;
  /** @type {Map<number, Function>} */
  const scheduled = new Map();
  globalThis.setInterval = (cb) => { intervalCallbacks.push(cb); return intervalCallbacks.length; };
  globalThis.clearInterval = () => { intervalCallbacks = []; };
  globalThis.setTimeout = (cb) => { const id = ++nextId; scheduled.set(id, cb); return id; };
  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
  return {
    fireRotation() { intervalCallbacks.forEach(cb => cb()); },
    runFade(id) { const cb = scheduled.get(id); if (cb) cb(); },
    restore() {
      globalThis.setInterval = real.setInterval;
      globalThis.clearInterval = real.clearInterval;
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
    }
  };
}

describe('dashboard hero equivalence tickers', () => {
  beforeEach(() => {
    resetEquivTickersForTest();
    document.body.innerHTML = `
      <div class="hero-stat primary">
        <div class="hero-value" id="hero-tokens">0</div>
        <div class="hero-spark" id="hero-spark-tokens"></div>
        <div class="equiv-ticker" data-equiv-category="tokens"><span class="glyph">≈</span><span class="equiv-text"></span></div>
      </div>
      <div class="hero-value" id="hero-cost">$0.00</div>
      <div class="hero-value burn-rate-value" id="burn-rate">0/min</div>
      <div class="equiv-ticker" data-equiv-category="cost"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="burnRate"><span class="equiv-text"></span></div>
      <div id="last-update"></div>
      <div id="footer-stats"></div>
      <div id="top-models-grid"></div>
      <div id="insights-grid"></div>
    `;
    window.animateNumber = mock();
    globalThis.fetch = mock(() => new Promise(() => {}));
    setHistoryData([]);
  });

  it('populates the tokens ticker text after a render with real data', () => {
    setCurrentData({
      total_tokens: 21630000000,
      total_cost: { total: 11800 },
      total_cache_read: 0,
      total_input: 100,
      tokens_by_model: { 'anthropic/claude-sonnet-5': { total: 21630000000 } },
      files_processed: 10,
      total_lines: 1000
    });

    renderDashboard(true);

    const text = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
    expect(text.innerHTML.length).toBeGreaterThan(0);
  });

  it('clears interval, fade timeout, lines, and visible text when the value goes invalid', () => {
    setCurrentData({
      total_tokens: 100,
      total_cost: { total: 5 },
      total_cache_read: 0,
      total_input: 0,
      tokens_by_model: { 'm': { total: 100 } },
      files_processed: 1,
      total_lines: 10
    });

    const timers = captureTimers();
    try {
      renderDashboard(true);

      const ticker = document.querySelector('[data-equiv-category="tokens"]');
      expect(ticker._equivIntervalId).not.toBeNull();
      expect(ticker.querySelector('.equiv-text').textContent).not.toBe('');

      timers.fireRotation();
      expect(ticker._equivFadeTimeout).not.toBeNull();

      updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });

      expect(ticker._equivIntervalId).toBeNull();
      expect(ticker._equivFadeTimeout).toBeNull();
      expect(ticker._equivLines).toEqual([]);
      expect(ticker.querySelector('.equiv-text').textContent).toBe('');
    } finally {
      timers.restore();
    }
  });

  it('restarts a cleared ticker once a valid value returns', () => {
    setCurrentData({
      total_tokens: 100,
      total_cost: { total: 5 },
      total_cache_read: 0,
      total_input: 0,
      tokens_by_model: { 'm': { total: 100 } },
      files_processed: 1,
      total_lines: 10
    });

    renderDashboard(true);

    const ticker = document.querySelector('[data-equiv-category="tokens"]');
    expect(ticker._equivIntervalId).not.toBeNull();

    updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });
    expect(ticker._equivIntervalId).toBeNull();
    expect(ticker.querySelector('.equiv-text').textContent).toBe('');

    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
    expect(ticker._equivIntervalId).not.toBeNull();
    expect(ticker.querySelector('.equiv-text').textContent).not.toBe('');
  });
});
