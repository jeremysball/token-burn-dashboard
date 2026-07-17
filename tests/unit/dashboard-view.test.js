/**
 * @jest-environment jsdom
 */

import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';

const dataForModel = (model) => ({
  total_tokens: 100,
  total_cost: { total: 0 },
  total_cache_read: 0,
  total_input: 100,
  tokens_by_model: {
    [model]: { total: 100 }
  },
  files_processed: 0,
  total_lines: 0,
  pricing_by_model: {}
});

const dataForModelWithPricing = (model, pricing) => ({
  ...dataForModel(model),
  pricing_by_model: { [model]: pricing }
});

describe('dashboard model cards', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="top-models-grid"></div>';
    window.animateNumber = jest.fn();
    setHistoryData([]);
  });

  it('rebuilds a card when the model key changes during an in-place render', () => {
    setCurrentData(dataForModel('gpt-4o'));
    renderDashboard(true);

    setCurrentData(dataForModel('openrouter/tencent/hy3:free'));
    renderDashboard(false);

    const card = document.querySelector('.top-model-card');
    expect(card.dataset.modelKey).toBe('openrouter/tencent/hy3:free');
    expect(card.querySelector('.provider-badge').textContent).toBe('openrouter');
    expect(card.querySelector('.top-model-name').textContent).toBe('tencent/hy3:free');
  });

  it('renders model names as text in insights instead of HTML', () => {
    const maliciousModel = 'provider/<img src=x onerror="alert(1)">';
    document.body.innerHTML = '<div id="top-models-grid"></div><div id="insights-grid"></div>';

    setCurrentData(dataForModel(maliciousModel));
    renderDashboard(true);

    const insightValue = document.querySelector('.insight-value');
    expect(insightValue.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(insightValue.querySelector('img')).toBeNull();
  });

  it('refreshes pricing tooltip metadata during in-place updates', () => {
    const model = 'gpt-4o';
    const initialPricing = {
      input: 2.5,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 0.2,
      source: 'local'
    };
    const updatedPricing = {
      input: 2.5,
      output: 10,
      cacheRead: 4,
      cacheWrite: 5,
      source: 'openrouter'
    };

    setCurrentData(dataForModelWithPricing(model, initialPricing));
    renderDashboard(true);

    const price = document.querySelector('.top-model-price');
    const source = document.querySelector('.pricing-source-badge');
    const visiblePrice = price.textContent;

    setCurrentData(dataForModelWithPricing(model, updatedPricing));
    renderDashboard(false);

    expect(price.textContent).toBe(visiblePrice);
    expect(price.title).toContain('cache $4.00 read / $5.00 write');
    expect(price.title).toContain('OpenRouter');
    expect(source.textContent).toBe('OpenRouter');
    expect(source.title).toBe('Pricing sourced from OpenRouter');
  });
});
