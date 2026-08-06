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

  it('escapes untrusted text in the rendered insights body (XSS via data.insights)', async () => {
    // C19-3 (XSS fix): the report body is taskferry-generated and
    // assigned via innerHTML, so any HTML in data.insights must be
    // escaped before the bold-markdown replacement. Only `**` should
    // produce real HTML. Assert that no live <img tag is present and
    // that the escaped form IS present (the word "onerror" appears in
    // the inert text — that's expected, since the user's intent is
    // not for the page to evaluate it).
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: '<img src=x onerror=alert(1)> **ok**' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const body = container.querySelector('#testBody').innerHTML;
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).toContain('<b>ok</b>');
  });

  it('escapes untrusted server error messages (XSS via errBody.error)', async () => {
    // C19-3 (XSS fix): the error message in the catch block is
    // server-supplied (res.json().error) and was being interpolated
    // into innerHTML unescaped. The error template must escape the
    // message so a malicious server response cannot inject a live
    // <img tag (the word "onerror" still appears as inert text in
    // the escaped form — the assertion targets the unescaped tag).
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ error: '<img src=x onerror=alert(1)>' }), { status: 503 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const body = container.querySelector('#testBody').innerHTML;
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(container.querySelector('#testRetry')).not.toBeNull();
  });

  it('ignores a stale fetch response when a newer fetch has been started (race regression)', async () => {
    // C19-3 (race fix): when a fetch for an older date is still in
    // flight and a newer date's render fires, the older response must
    // NOT overwrite `cached` and the visible report. The generation
    // counter on fetchAndRender guards against this.
    let resolveStale;
    const staleResponse = new Promise((r) => { resolveStale = r; });
    let fetchCount = 0;
    globalThis.fetch = mock(() => {
      fetchCount++;
      if (fetchCount === 1) return staleResponse;
      return Promise.resolve(new Response(JSON.stringify({ insights: 'Newer day report.' }), { status: 200 }));
    });

    // Day 1: starts a fetch that will never resolve on its own
    widget.render(container, { date: '2026-07-27', data: true });
    // Day 2: starts a second fetch for a newer date
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Now resolve the STALE (day 1) response AFTER day 2 has already committed
    resolveStale(new Response(JSON.stringify({ insights: 'Stale day 1 report.' }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The visible body must be the NEWER day's report, not the stale one
    expect(container.querySelector('#testBody').innerHTML).toContain('Newer day report.');
    expect(container.querySelector('#testBody').innerHTML).not.toContain('Stale day 1 report.');
    // The stale response must also not overwrite `cached`, so a subsequent
    // render for the stale date should re-fetch.
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ insights: 'Refetched day 1.' }), { status: 200 })));
    widget.render(container, { date: '2026-07-27', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').innerHTML).toContain('Refetched day 1.');
  });
});
