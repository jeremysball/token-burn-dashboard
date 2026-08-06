import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createTaskferryReportWidget } from '../../dashboard/js/report-widget.js';

describe('createTaskferryReportWidget', () => {
  let container;
  let widget;

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-container"></div>';
    container = document.getElementById('test-container');
    widget = createTaskferryReportWidget({
      endpoint: '/api/test-report',
      cacheKeyField: 'date',
      bodyId: 'testBody',
      dateLabelId: 'testDate',
      retryId: 'testRetry',
      containerId: 'test-container',
      loadingText: 'Loading…',
      headingFor: (d) => `REPORT // ${d}`,
      notEnoughText: (s) => (s.data ? null : 'Not enough data'),
      buildFlag: 'testBuilt'
    });
  });

  it('shows notEnoughText when the summary is insufficient', () => {
    widget.render(container, { data: null });
    expect(container.querySelector('#testBody').textContent).toBe('Not enough data');
  });

  it('builds the widget DOM exactly once', () => {
    widget.render(container, { date: '2026-07-28', data: true });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(container.querySelectorAll('.field-report').length).toBe(1);
  });

  it('renders body text on a successful fetch', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'A **quiet** day.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').innerHTML).toContain('<b>quiet</b>');
  });

  it('shows an error and retry control on fetch failure', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').textContent).toMatch(/failed/i);
    expect(container.querySelector('#testRetry')).not.toBeNull();
  });

  it('de-duplicates in-flight requests for the same cache key', () => {
    globalThis.fetch = mock(() => new Promise(() => {})); // never resolves
    widget.render(container, { date: '2026-07-28', data: true });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('serves a cache hit from memory without fetching', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Cached.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    globalThis.fetch = mock(() => { throw new Error('should not be called'); });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(container.querySelector('#testBody').innerHTML).toContain('Cached.');
  });

  it('clears state on resetForTest', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Done.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    widget.resetForTest();
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Fresh.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').innerHTML).toContain('Fresh.');
  });
});
