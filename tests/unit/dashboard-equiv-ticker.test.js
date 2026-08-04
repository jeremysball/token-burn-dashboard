// tests/unit/dashboard-equiv-ticker.test.js
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
import { resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';

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
});