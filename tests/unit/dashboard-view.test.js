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
});
