// tests/unit/live-event-feed.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderLiveEventFeed, resetLiveEventFeedForTest } from '../../dashboard/js/live-event-feed.js';

const dataWith = (tokensByModel, pricingByModel = {}) => ({
  tokens_by_model: tokensByModel,
  pricing_by_model: pricingByModel
});

describe('renderLiveEventFeed', () => {
  let container;

  beforeEach(() => {
    resetLiveEventFeedForTest();
    document.body.innerHTML = '<section id="live-feed-section"></section>';
    container = document.getElementById('live-feed-section');
  });

  it('shows a neutral placeholder on the first render (no previous snapshot to diff)', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);
  });

  it('shows a real event on the second render once a model has grown', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }, {
      'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }));

    const text = container.querySelector('#latestPillText').textContent;
    expect(text).toContain('model-1');
    expect(text).toMatch(/150(\.0)?k? tokens|150,000 tokens/i);
  });

  it('leaves the previous event visible when nothing grew on a later poll', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }));
    const afterGrowth = container.querySelector('#latestPillText').textContent;

    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }));
    expect(container.querySelector('#latestPillText').textContent).toBe(afterGrowth);
  });
});