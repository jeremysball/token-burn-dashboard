/**
 * @jest-environment jsdom
 */

import { MonoDashboard } from '../../src/MonoDashboard.js';

describe('MonoDashboard', () => {
  it('renders a pricing source badge in the detail panel', () => {
    document.body.innerHTML = '<div id="dashboard"></div>';

    const dashboard = new MonoDashboard({
      title: 'token_burn',
      subtitle: 'demo',
      stats: [],
      data: [
        {
          name: 'openai/gpt-4o',
          total: 1000,
          input: 600,
          output: 300,
          cache: 100,
          pricingSource: 'openrouter'
        }
      ],
      container: '#dashboard'
    });

    dashboard.render();

    const badge = document.querySelector('.mono-detail .pricing-source-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('OpenRouter');
    expect(badge.classList.contains('openrouter')).toBe(true);
  });
});
