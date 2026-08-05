// tests/unit/title-belt-render.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderTitleBelt } from '../../dashboard/js/title-belt-render.js';

function fixtureWeeklyData(days, perDayGrowth) {
  const out = [];
  const cumulative = {};
  for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
  for (let d = 0; d < days; d++) {
    const models = {};
    for (const [name, growth] of Object.entries(perDayGrowth)) {
      cumulative[name] += growth;
      models[name] = { total: cumulative[name], input: cumulative[name], output: 0, cache_read: 0, cache_write: 0 };
    }
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    out.push({ day, tokens: 0, models });
  }
  return out;
}

const pricingByModel = {
  'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 }
};

describe('renderTitleBelt', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<div id="weekly-title-belt-container"></div>';
    container = document.getElementById('weekly-title-belt-container');
  });

  it('shows all 4 belt rows once there is 2+ weeks of history', () => {
    renderTitleBelt(container, fixtureWeeklyData(15, { 'a/model-1': 1000, 'a/model-2': 500 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(4);
    expect(container.textContent).toContain('Volume Crown');
    expect(container.textContent).toContain('Thrift King');
    expect(container.textContent).toContain('The Sommelier');
    expect(container.textContent).toContain('Most Improved');
  });

  it('shows only 3 belts plus a prior-week note with 8-14 daily snapshots', () => {
    renderTitleBelt(container, fixtureWeeklyData(8, { 'a/model-1': 1000 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(4); // 3 real rows + 1 placeholder row
    expect(container.textContent.toLowerCase()).toContain('prior calendar week is incomplete');
  });

  it('shows an empty-state message instead of a broken widget with fewer than 8 snapshots', () => {
    renderTitleBelt(container, fixtureWeeklyData(3, { 'a/model-1': 1000 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(0);
    expect(container.textContent.toLowerCase()).toContain('not enough history');
  });

  it('escapes model names as text, never as injected HTML', () => {
    const malicious = 'a/<img src=x onerror="alert(1)">';
    const data = fixtureWeeklyData(15, { [malicious]: 1000, 'a/model-2': 10 });
    renderTitleBelt(container, data, pricingByModel);
    expect(container.querySelector('.belt-model').textContent).toContain('<img');
    expect(container.querySelector('img')).toBeNull();
  });
});
