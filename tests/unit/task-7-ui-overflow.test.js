/**
 * @jest-environment jsdom
 *
 * TDD for Task 7: scale short B + comma multiples, heatmap dates/values,
 * overflow-sensitive rendering. These tests assert the *post-fix* behavior and
 * fail before the implementation lands.
 */

import {
  renderScaleTab,
  renderDailyHeatmap,
  renderModelHeatmap
} from '../../dashboard/js/views/analytics.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';

const fs = require('fs');
const path = require('path');
const mainCss = fs.readFileSync(
  path.resolve(process.cwd(), 'dashboard/styles/main.css'),
  'utf8'
);
const designV2Css = fs.readFileSync(
  path.resolve(process.cwd(), 'dashboard/styles/design-v2.css'),
  'utf8'
);

const billionData = () => ({
  total_tokens: 17021653100,
  total_cost: { total: 0 },
  total_cache_read: 0,
  total_input: 100,
  tokens_by_model: {},
  files_processed: 0,
  total_lines: 0,
  pricing_by_model: {}
});

describe('Task 7: scale page rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="scale-comparisons"></div>';
    setHistoryData([]);
  });

  it('renders total tokens short with B and full value in title', () => {
    setCurrentData(billionData());
    renderScaleTab();
    const scaleNumber = document.querySelector('.scale-number');
    expect(scaleNumber).not.toBeNull();
    expect(scaleNumber.textContent).toBe('17.02B');
    expect(scaleNumber.getAttribute('title')).toBe('17,021,653,100');
  });

  it('renders achieved multiples comma-grouped', () => {
    setCurrentData(billionData());
    renderScaleTab();
    const multiples = Array.from(document.querySelectorAll('.scale-multiple'));
    // The Bible comparison (4,000,000 tokens) -> 17,021,653,100 / 4,000,000 = 4255.4
    // fmtMultiple floors integers >= 10 and comma-groups them.
    const bibleMultiple = multiples.find(m => m.textContent.includes('4,255'));
    expect(bibleMultiple).toBeTruthy();
    expect(bibleMultiple.textContent).toBe('4,255×');
  });
});

describe('Task 7: daily heatmap rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="heatmaps-container"></div>';
    setHistoryData([]);
  });

  it('renders daily value short with full value in title', () => {
    const data = [
      { time: '2026-07-10T12:00:00Z', total: 17021653100 }
    ];
    renderDailyHeatmap(document.getElementById('heatmaps-container'), data);
    const val = document.querySelector('.daily-heatmap-val');
    expect(val).not.toBeNull();
    expect(val.textContent).toBe('17.02B');
    expect(val.getAttribute('title')).toBe('17,021,653,100');
  });
});

describe('Task 7: model heatmap rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="heatmaps-container"></div>';
    setHistoryData([]);
  });

  it('renders y-label as split model with full key in title', () => {
    const data = [
      { time: '2026-07-10T12:00:00Z', total: 100, tokens_by_model: { 'openrouter/tencent/hy3:free': 100 } }
    ];
    renderModelHeatmap(document.getElementById('heatmaps-container'), data);
    const label = document.querySelector('.heatmap-y-label');
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('tencent/hy3:free');
    expect(label.getAttribute('title')).toBe('openrouter/tencent/hy3:free');
  });

  it('renders x-axis labels as actual dates not indexes', () => {
    const data = [
      { time: '2026-07-10T05:00:00Z', total: 100, tokens_by_model: { 'gpt-4o': 100 } },
      { time: '2026-07-10T13:00:00Z', total: 50, tokens_by_model: { 'gpt-4o': 50 } }
    ];
    renderModelHeatmap(document.getElementById('heatmaps-container'), data);
    const xLabels = Array.from(document.querySelectorAll('.heatmap-x-label'));
    // Must contain a date/hour token, not a bare numeric index
    expect(xLabels.length).toBeGreaterThan(0);
    const hasDateLabel = xLabels.some(l => /[A-Za-z]{3} \d{1,2} \d{1,2}:00/.test(l.textContent));
    expect(hasDateLabel).toBe(true);
  });
});

describe('Task 7: CSS overflow guards', () => {
  it('main.css guards scale-number with ellipsis', () => {
    expect(/\.scale-number\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(mainCss)).toBe(true);
    expect(/\.scale-number\s*\{[^}]*white-space\s*:\s*nowrap/.test(mainCss)).toBe(true);
  });

  it('main.css guards heatmap-y-label with ellipsis + fixed width', () => {
    expect(/\.heatmap-y-label\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(mainCss)).toBe(true);
    expect(/\.heatmap-y-label\s*\{[^}]*width\s*:\s*110px/.test(mainCss)).toBe(true);
  });

  it('main.css guards daily-heatmap-cell and daily-heatmap-val', () => {
    expect(/\.daily-heatmap-cell\s*\{[^}]*overflow\s*:\s*hidden/.test(mainCss)).toBe(true);
    expect(/\.daily-heatmap-val\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(mainCss)).toBe(true);
  });

  it('main.css guards heatmap-wrapper with horizontal scroll', () => {
    expect(/\.heatmap-wrapper\s*\{[^}]*overflow-x\s*:\s*auto/.test(mainCss)).toBe(true);
    expect(/\.heatmap-wrapper\s*\{[^}]*min-width\s*:\s*0/.test(mainCss)).toBe(true);
  });
});

describe('Task 7: mobile subnav 33% wrap', () => {
  it('design-v2 wraps subnav into ~33% grid under 768px', () => {
    const mobileBlock = designV2Css.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\n\}\s*$/m);
    expect(mobileBlock).not.toBeNull();
    const block = mobileBlock[1];
    expect(/\.analytics-subnav\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(block)).toBe(true);
    expect(/\.subnav-btn\s*\{[^}]*flex\s*:\s*1 1 calc\(33% - 6px\)/.test(block)).toBe(true);
    expect(/\.controls-bar\s*\{[^}]*flex-direction\s*:\s*column/.test(block)).toBe(true);
    expect(/\.range-selector\s*\{[^}]*width\s*:\s*100%/.test(block)).toBe(true);
    expect(/\.heatmap-controls\s*\{[^}]*flex-direction\s*:\s*column/.test(block)).toBe(true);
  });
});
