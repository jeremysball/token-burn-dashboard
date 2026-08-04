// tests/unit/dashboard-odometer.test.js
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';

const data = (total) => ({
  total_tokens: total,
  total_cost: { total: 0 },
  total_cache_read: 0,
  total_input: 0,
  tokens_by_model: { 'anthropic/claude-sonnet-5': { total } },
  files_processed: 0,
  total_lines: 0
});

describe('dashboard hero-tokens odometer', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="hero-value odometer" id="hero-tokens">0</div>
      <div class="hero-value" id="hero-cost">$0.00</div>
      <div class="hero-value burn-rate-value" id="burn-rate">0/min</div>
      <div id="last-update"></div>
      <div id="footer-stats"></div>
      <div id="top-models-grid"></div>
      <div id="insights-grid"></div>
    `;
    window.animateNumber = mock();
    globalThis.fetch = mock(() => new Promise(() => {}));
    setHistoryData([]);
  });

  it('shows the literal digit count with no roll animation on the first render', () => {
    setCurrentData(data(1234567));
    renderDashboard(true);

    const heroTokens = document.getElementById('hero-tokens');
    expect(heroTokens.querySelectorAll('.odo-digit').length).toBe(7);
    heroTokens.querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1); // no in-flight roll on first paint
    });
  });

  it('rolls the changed digits on a subsequent real value change, not on an idle re-render', () => {
    setCurrentData(data(1234567));
    renderDashboard(true);

    // Idle re-render with the same value: nothing should start rolling.
    renderDashboard(false);
    document.getElementById('hero-tokens').querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1);
    });

    // Real SSE-driven change:
    setCurrentData(data(1234568));
    renderDashboard(false);

    const lastStrip = document.getElementById('hero-tokens').querySelectorAll('.odo-digit-strip');
    expect(lastStrip[lastStrip.length - 1].children.length).toBe(2);
  });
});