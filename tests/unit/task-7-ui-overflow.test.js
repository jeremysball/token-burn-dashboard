/**
 * @jest-environment jsdom
 *
 * TDD for Task 7: scale short B + comma multiples, heatmap dates/values,
 * overflow-sensitive rendering. These tests assert the *post-fix* behavior and
 * fail before the implementation lands.
 */

import { renderAnalytics } from '../../dashboard/js/views/analytics.js';
import {
  setCurrentData,
  setFileHistoricalData,
  setHistoryData
} from '../../dashboard/js/state.js';

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

const renderTab = (tab, body, history = []) => {
  document.body.innerHTML = `
    <button class="subnav-btn active" data-tab="${tab}"></button>
    ${body}
  `;
  setCurrentData(billionData());
  setFileHistoricalData([]);
  setHistoryData(history);
  renderAnalytics();
};

const cssRules = css => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return Array.from(style.sheet.cssRules);
};

const findRule = (rules, selector, property) => {
  const properties = [].concat(property || []);
  for (const rule of rules) {
    if (
      rule.selectorText?.split(',').map(item => item.trim()).includes(selector) &&
      properties.every(name => rule.style.getPropertyValue(name))
    ) return rule;
    if (rule.cssRules) {
      const nested = findRule(Array.from(rule.cssRules), selector, property);
      if (nested) return nested;
    }
  }
  return null;
};

const findMobileRule = (rules, selector) => {
  for (const rule of rules) {
    const query = rule.conditionText || rule.media?.mediaText;
    if (rule.cssRules && query?.includes('max-width: 768px')) {
      const nested = findRule(Array.from(rule.cssRules), selector);
      if (nested) return nested;
    }
  }
  return null;
};

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
    document.head.innerHTML = '';
    setHistoryData([]);
  });

  it('renders total tokens short with B and full value in title', () => {
    renderTab('scale', '<div id="scale-comparisons"></div>');
    const scaleNumber = document.querySelector('.scale-number');
    expect(scaleNumber).not.toBeNull();
    expect(scaleNumber.textContent).toBe('17.02B');
    expect(scaleNumber.getAttribute('title')).toBe('17,021,653,100');
  });

  it('renders achieved multiples comma-grouped', () => {
    renderTab('scale', '<div id="scale-comparisons"></div>');
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
    document.head.innerHTML = '';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders daily value short with full value in title', () => {
    const data = [
      { time: '2026-07-10T12:00:00Z', total: 17021653100 }
    ];
    renderTab('heatmaps', `
      <select id="heatmap-type"><option value="daily" selected>Daily</option></select>
      <div id="heatmaps-container"></div>
    `, data);
    const val = document.querySelector('.daily-heatmap-val');
    expect(val).not.toBeNull();
    expect(val.textContent).toBe('17.02B');
    expect(val.getAttribute('title')).toBe('17,021,653,100');
  });

  it('renders the weekday for the UTC date key in non-UTC browsers', () => {
    const original = Date.prototype.toLocaleDateString;
    const localeSpy = jest.spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementation(function(locale, options) {
        if (options?.timeZone !== 'UTC') return 'Thu';
        return original.call(this, locale, options);
      });

    renderTab('heatmaps', `
      <select id="heatmap-type"><option value="daily" selected>Daily</option></select>
      <div id="heatmaps-container"></div>
    `, [{ time: Date.UTC(2026, 6, 10, 0, 30), total: 100 }]);

    expect(document.querySelector('.daily-heatmap-day').textContent).toBe('Fri');
    expect(localeSpy).toHaveBeenCalledWith('en', {
      weekday: 'short',
      timeZone: 'UTC'
    });
  });
});

describe('Task 7: model heatmap rendering', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('renders y-label as split model with full key in title', () => {
    const data = [
      { time: '2026-07-10T12:00:00Z', total: 100, tokens_by_model: { 'openrouter/tencent/hy3:free': 100 } }
    ];
    renderTab('heatmaps', `
      <select id="heatmap-type"><option value="model" selected>Model</option></select>
      <div id="heatmaps-container"></div>
    `, data);
    const label = document.querySelector('.heatmap-y-label');
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('tencent/hy3:free');
    expect(label.getAttribute('title')).toBe('openrouter/tencent/hy3:free');
  });

  it('renders exact UTC date/time labels and both historical model shapes', () => {
    const data = [
      { time: Date.UTC(2026, 6, 10, 5), total: 100, models: { 'claude-sonnet': 100 } },
      { time: Date.UTC(2026, 6, 10, 13), total: 50, tokens_by_model: { 'gpt-4o': 50 } }
    ];
    renderTab('heatmaps', `
      <select id="heatmap-type"><option value="model" selected>Model</option></select>
      <div id="heatmaps-container"></div>
    `, data);

    const xLabels = Array.from(document.querySelectorAll('.heatmap-x-label'), el => el.textContent);
    const yLabels = Array.from(document.querySelectorAll('.heatmap-y-label'), el => el.textContent);
    expect(xLabels).toEqual(['Jul 10 05:00', 'Jul 10 13:00']);
    expect(yLabels).toEqual(['claude-sonnet', 'gpt-4o']);
    expect(document.querySelector('.heatmap-grid').classList.contains('model')).toBe(true);
  });
});

describe('Task 7: CSS overflow guards', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('clips long scale and daily values without widening their containers', () => {
    const rules = cssRules(mainCss);
    const scale = findRule(rules, '.scale-number', 'text-overflow').style;
    const cell = findRule(rules, '.daily-heatmap-cell', 'overflow').style;
    const value = findRule(rules, '.daily-heatmap-val', 'text-overflow').style;
    expect(scale.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(scale.getPropertyValue('white-space')).toBe('nowrap');
    expect(cell.getPropertyValue('overflow')).toBe('hidden');
    expect(value.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(value.getPropertyValue('max-width')).toBe('100%');
  });

  it('keeps readable model columns inside the intentional scroll container', () => {
    const rules = cssRules(mainCss);
    const wrapper = findRule(rules, '.heatmap-wrapper', ['overflow-x', 'min-width']).style;
    const yLabel = findRule(rules, '.heatmap-y-label', 'text-overflow').style;
    const xLabelRule = findRule(rules, '.heatmap-grid.model .heatmap-x-label', 'width');
    const xLabelTextRule = findRule(rules, '.heatmap-grid.model .heatmap-x-label', 'white-space');
    const modelCellRule = findRule(rules, '.heatmap-grid.model .heatmap-cell-full', 'flex');
    expect(wrapper.getPropertyValue('overflow-x')).toBe('auto');
    expect(wrapper.getPropertyValue('min-width')).toBe('0');
    expect(yLabel.getPropertyValue('text-overflow')).toBe('ellipsis');
    expect(yLabel.getPropertyValue('width')).toBe('110px');
    expect(xLabelRule).not.toBeNull();
    expect(xLabelTextRule).not.toBeNull();
    expect(modelCellRule).not.toBeNull();
    const xLabel = xLabelRule?.style;
    const modelCell = modelCellRule?.style;
    expect(xLabelTextRule?.style.getPropertyValue('white-space')).toBe('nowrap');
    expect(parseInt(xLabel?.getPropertyValue('width'), 10)).toBeGreaterThanOrEqual(80);
    expect(modelCell?.getPropertyValue('flex')).toContain(xLabel?.getPropertyValue('width'));
  });
});

describe('Task 7: mobile subnav strip', () => {
  it('keeps analytics navigation in one scrollable row under 768px', () => {
    const rules = cssRules(designV2Css);
    const subnav = findMobileRule(rules, '.analytics-subnav').style;
    const button = findMobileRule(rules, '.analytics-subnav .subnav-btn').style;
    const controls = findMobileRule(rules, '.controls-bar').style;
    const range = findMobileRule(rules, '.range-selector').style;
    const heatmapControls = findMobileRule(rules, '.heatmap-controls').style;
    expect(subnav.getPropertyValue('flex-wrap')).toBe('nowrap');
    expect(subnav.getPropertyValue('overflow-x')).toBe('auto');
    expect(button.getPropertyValue('flex')).toBe('0 0 auto');
    expect(button.getPropertyValue('min-width')).toBe('auto');
    expect(controls.getPropertyValue('flex-direction')).toBe('column');
    expect(range.getPropertyValue('width')).toBe('100%');
    expect(range.getPropertyValue('overflow-x')).toBe('auto');
    expect(heatmapControls.getPropertyValue('flex-direction')).toBe('column');
  });
});
