// tests/unit/live-event-feed.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderLiveEventFeed, resetLiveEventFeedForTest } from '../../dashboard/js/live-event-feed.js';
import { setDataRevision, setDataSource } from '../../dashboard/js/state.js';

const dataWith = (tokensByModel, pricingByModel = {}) => ({
  tokens_by_model: tokensByModel,
  pricing_by_model: pricingByModel,
});

describe('renderLiveEventFeed', () => {
  let container;

  beforeEach(() => {
    resetLiveEventFeedForTest();
    setDataRevision(0);
    setDataSource(null);
    document.body.innerHTML = '<section id="live-feed-section"></section>';
    container = document.getElementById('live-feed-section');
  });

  it('shows a neutral placeholder on the first render (no previous snapshot to diff)', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });
    expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);
  });

  it('seeds the baseline on the first fresh revision without showing an event', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });
    expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);
  });

  it('shows a real event on the second fresh revision once a model has grown', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }, {
      'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.05 },
    }), { source: 'fresh-http', revision: 2 });

    const text = container.querySelector('#latestPillText').textContent;
    expect(text).toContain('model-1');
    expect(text).toMatch(/150(\.0)?k? tokens|150,000 tokens/i);
  });

  it('leaves the previous event visible when nothing grew on a later poll', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'fresh-http', revision: 2 });
    const afterGrowth = container.querySelector('#latestPillText').textContent;

    setDataRevision(3);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'fresh-http', revision: 3 });
    expect(container.querySelector('#latestPillText').textContent).toBe(afterGrowth);
  });

  it('ignores cache snapshots and does not create events from them', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('cache');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 500, input: 200, cache_read: 300 } }), { source: 'cache', revision: 2 });

    expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);
  });

  it('processes a live-sse revision exactly once and ignores a repeated revision', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('live-sse');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'live-sse', revision: 2 });
    const afterSse = container.querySelector('#latestPillText').textContent;
    expect(afterSse).not.toMatch(/waiting/i);

    setDataRevision(2);
    setDataSource('live-sse');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'live-sse', revision: 2 });
    expect(container.querySelector('#latestPillText').textContent).toBe(afterSse);
  });

  it('does not reprocess the same revision on a repeated dashboard render', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'fresh-http', revision: 2 });
    const afterGrowth = container.querySelector('#latestPillText').textContent;

    setDataRevision(2);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }), { source: 'fresh-http', revision: 2 });
    expect(container.querySelector('#latestPillText').textContent).toBe(afterGrowth);
  });

  it('processes a second fresh revision after a cache snapshot', () => {
    setDataRevision(1);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }), { source: 'fresh-http', revision: 1 });

    setDataRevision(2);
    setDataSource('cache');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 500, input: 200, cache_read: 300 } }), { source: 'cache', revision: 2 });

    setDataRevision(3);
    setDataSource('fresh-http');
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 600, input: 250, cache_read: 350 } }), { source: 'fresh-http', revision: 3 });
    const text = container.querySelector('#latestPillText').textContent;
    expect(text).toContain('model-1');
    expect(text).toMatch(/500(\.0)?k? tokens|500,000 tokens/i);
  });
});