const { test, expect } = require('@playwright/test');
const { startRealServer, stopRealServer } = require('./real-server-fixtures');

let server;
let BASE_URL;

test.beforeAll(async () => {
  server = await startRealServer();
  BASE_URL = server.baseUrl;
});

test.afterAll(async () => {
  if (server) await stopRealServer(server);
});

test.describe('real-server integrated audit exercise', () => {
  test('Step 2: real network captures for corpus, tokens, historical, SSE liveness, and visible ticker', async ({ page }) => {
    // Register response listeners before navigation to capture real network traffic
    const corpusResponseP = page.waitForResponse(
      (res) => res.url().includes('/data/factoids-1000.json'),
      { timeout: 30000 }
    );
    const tokensResponseP = page.waitForResponse(
      (res) => res.url().includes('/api/tokens') && !res.url().includes('/stream') && !res.url().includes('/historical'),
      { timeout: 30000 }
    );
    const historicalResponseP = page.waitForResponse(
      (res) => res.url().includes('/api/tokens/historical'),
      { timeout: 30000 }
    );
    const sseResponseP = page.waitForResponse(
      (res) => res.url().includes('/api/tokens/stream'),
      { timeout: 30000 }
    );

    // Set up SSE message receipt detection before navigation
    await page.addInitScript(() => {
      window.__sseMessageReceived = false;
      const origES = window.EventSource;
      window.EventSource = function (...args) {
        const es = new origES(...args);
        es.addEventListener('message', () => {
          window.__sseMessageReceived = true;
        });
        return es;
      };
    });

    await page.goto(BASE_URL, { timeout: 30000 });

    // Assert corpus: HTTP 200 with all three required categories
    const corpusResponse = await corpusResponseP;
    expect(corpusResponse.status()).toBe(200);
    const corpusBody = await corpusResponse.json();
    const categories = corpusBody.map((f) => f.category);
    expect(categories).toContain('tokens');
    expect(categories).toContain('cost');
    expect(categories).toContain('burnRate');

    // Assert /api/tokens: HTTP 200 with valid JSON body
    const tokensResponse = await tokensResponseP;
    expect(tokensResponse.status()).toBe(200);
    const tokensBody = await tokensResponse.json();
    expect(tokensBody).toHaveProperty('total_tokens');

    // Assert /api/tokens/historical: HTTP 200 with valid JSON body
    const historicalResponse = await historicalResponseP;
    expect(historicalResponse.status()).toBe(200);
    const historicalBody = await historicalResponse.json();
    expect(Array.isArray(historicalBody)).toBe(true);

    // Assert SSE: HTTP 200 AND that the stream delivers at least one message
    const sseResponse = await sseResponseP;
    expect(sseResponse.status()).toBe(200);
    await page.waitForFunction(() => window.__sseMessageReceived === true, { timeout: 15000 });

    // Assert visible ticker text (explicit visibility + non-empty content)
    const ticker = page.locator('.equiv-ticker[data-equiv-category="tokens"] .equiv-text');
    await expect(ticker).toBeVisible({ timeout: 15000 });
    await expect(ticker).not.toBeEmpty({ timeout: 15000 });
  });

  test('Step 3 path 1: late corpus resolution via initEquivTickers refreshes mounted tickers', async ({ page }) => {
    // Intercept the corpus fetch so we can delay it and exercise late resolution
    await page.addInitScript(() => {
      window.__corpusResolve = null;
      const origFetch = window.fetch;
      window.fetch = function (url, ...args) {
        if (typeof url === 'string' && url.includes('/data/factoids-1000.json')) {
          return new Promise((resolve) => {
            window.__corpusResolve = () => origFetch.call(window, url, ...args).then(resolve);
          });
        }
        return origFetch.call(window, url, ...args);
      };
    });

    await page.goto(BASE_URL, { timeout: 30000 });

    // Wait for the dashboard to render with fallback (curated) lines.
    // The corpus fetch is delayed, so tickers show curated text.
    // This also means _equivLastValue is set on the ticker elements.
    const fallbackTicker = page.locator('.equiv-ticker[data-equiv-category="tokens"] .equiv-text');
    await expect(fallbackTicker).toBeVisible({ timeout: 15000 });
    await expect(fallbackTicker).not.toBeEmpty({ timeout: 15000 });
    const fallbackText = await fallbackTicker.textContent();

    // Release the delayed corpus fetch so the real server response arrives
    await page.evaluate(() => { if (window.__corpusResolve) window.__corpusResolve(); });

    // Wait for the corpus to arrive and refreshMountedTickers() to update the text.
    // This is the production late-resolution path: corpus promise resolves →
    // refreshMountedTickers() iterates mounted tickers → ensures new lines.
    await expect(fallbackTicker).not.toHaveText(fallbackText, { timeout: 15000 });
    await expect(fallbackTicker).toBeVisible({ timeout: 5000 });
  });

  test('Step 3 path 2: Arabic odometer settles to newest requested value', async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 30000 });

    // Patch Intl.NumberFormat to use Arabic-Indic digits (ar-EG locale)
    const expectedValue = '١٢٣٤٥٧٠';
    const result = await page.evaluate(async ({ expectedValue }) => {
      const OrigFormat = Intl.NumberFormat;
      const PatchedFormat = function (locales, options) {
        return new OrigFormat(locales === undefined ? 'ar-EG' : locales, options);
      };
      PatchedFormat.prototype = OrigFormat.prototype;
      PatchedFormat.supportedLocalesOf = OrigFormat.supportedLocalesOf;
      Intl.NumberFormat = PatchedFormat;

      const { renderOdometer, updateOdometer } = await import('/js/odometer.js');

      const container = document.createElement('div');
      document.body.appendChild(container);

      // Render initial value then submit three rapid totals
      renderOdometer(container, '١٢٣٤٥٦٧');
      updateOdometer(container, '١٢٣٤٥٦٨');
      updateOdometer(container, '١٢٣٤٥٦٩');
      updateOdometer(container, expectedValue);

      // Poll for settlement: wait until visible text equals the newest value.
      // The SETTLE_FALLBACK_MS is650ms; use1500ms bounded timeout.
      const deadline = Date.now() + 1500;
      let settled = false;
      while (Date.now() < deadline) {
        const text = (container.textContent || '').replace(/\s+/g, '');
        if (text === expectedValue) {
          settled = true;
          break;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      const finalText = (container.textContent || '').replace(/\s+/g, '');
      const digitCount = container.querySelectorAll('.odo-digit').length;
      container.remove();
      return { settled, finalText, digitCount, expectedValue };
    }, { expectedValue });

    // Assert Arabic locale was active
    expect(result.digitCount).toBe(7);
    // Assert odometer settled to the complete newest value, not an intermediate
    expect(result.settled).toBe(true);
    expect(result.finalText).toBe(expectedValue);
  });

  test('Step 3 path 3: cache slider preserves 0.04% readout with 99960/40 fixture', async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 30000 });

    const sliderProps = await page.evaluate(async () => {
      const { renderCacheSlider } = await import('/js/cache-slider.js');
      const section = document.createElement('section');
      document.body.appendChild(section);

      const mockData = {
        total_tokens: 100000,
        total_input: 99960,
        total_cache_read: 40,
        total_output: 0,
        total_cache_write: 0,
        tokens_by_model: {
          'test/model': { total: 100000, input: 99960, cache_read: 40, output: 0, cache_write: 0 }
        },
        pricing_by_model: {
          'test/model': { input: 2.5, output: 10, cacheRead: 0.625, cacheWrite: 0, source: 'openrouter' }
        },
        total_cost: { total: 0.1 },
        costs_by_model: {},
        files_processed: 1,
        total_lines: 100
      };

      renderCacheSlider(section, mockData);
      const slider = section.querySelector('#cacheSlider');
      const readout = section.querySelector('#cacheReadout');

      const result = {
        max: slider.max,
        step: slider.step,
        value: slider.value,
        readoutText: readout.textContent
      };

      section.remove();
      return result;
    });

    expect(sliderProps.max).toBe('0.040');
    expect(sliderProps.step).toBe('0.001');
    expect(sliderProps.value).toBe('0.04');
    expect(sliderProps.readoutText).toBe('0.040% hit rate');
  });

  test('Step 3 path 4: dead-air band appears for file-backed trailing gap, absent for SSE history', async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 30000 });

    const HOUR = 3600 * 1000;
    const now = 13 * HOUR;
    const t6 = 6 * HOUR;
    const t9 = 9 * HOUR;

    await page.evaluate(
      ({ now }) => {
        Date.now = () => now;
        window.Plotly = { newPlot: () => {}, react: () => {}, Plots: { resize: () => {} } };
      },
      { now }
    );

    const fileLayout = await page.evaluate(
      async ({ t6, t9 }) => {
        const { renderTimelineTab } = await import('/js/views/analytics/tabs/timeline.js');
        const { setAnalyticsRange, setFileHistoricalData, setHistoryData } = await import('/js/state.js');

        let capturedLayout = null;
        window.Plotly.newPlot = (_id, _traces, layout) => {
          capturedLayout = layout;
        };

        setAnalyticsRange('all');
        setHistoryData([]);
        setFileHistoricalData([{ time: t6, total: 100 }, { time: t9, total: 200 }]);

        const container = document.createElement('div');
        container.id = 'timeline-chart-container';
        document.body.appendChild(container);
        renderTimelineTab(container);
        container.remove();

        return capturedLayout;
      },
      { t6, t9 }
    );

    expect(fileLayout).not.toBeNull();
    expect(fileLayout.shapes).toHaveLength(1);
    expect(fileLayout.shapes[0].type).toBe('rect');
    expect(new Date(fileLayout.shapes[0].x0).getTime()).toBe(10 * HOUR);
    expect(new Date(fileLayout.shapes[0].x1).getTime()).toBe(13 * HOUR);
    expect(new Date(fileLayout.xaxis.range[1]).getTime()).toBe(now);

    await page.evaluate(
      ({ now }) => {
        Date.now = () => now;
        window.Plotly = { newPlot: () => {}, react: () => {}, Plots: { resize: () => {} } };
      },
      { now }
    );

    const sseLayout = await page.evaluate(
      async ({ t6, t9 }) => {
        const { renderTimelineTab } = await import('/js/views/analytics/tabs/timeline.js');
        const { setAnalyticsRange, setFileHistoricalData, setHistoryData } = await import('/js/state.js');

        let capturedLayout = null;
        window.Plotly.newPlot = (_id, _traces, layout) => {
          capturedLayout = layout;
        };

        setAnalyticsRange('all');
        setFileHistoricalData([]);
        setHistoryData([{ time: t6, total: 100 }, { time: t9, total: 200 }]);

        const container = document.createElement('div');
        container.id = 'timeline-chart-container';
        document.body.appendChild(container);
        renderTimelineTab(container);
        container.remove();

        return capturedLayout;
      },
      { t6, t9 }
    );

    expect(sseLayout).not.toBeNull();
    expect(sseLayout.shapes).toEqual([]);

    await page.evaluate(() => {
      delete Date.now;
    });
  });

  test('source-aware live-feed path: only second fresh snapshot changes pill text', async ({ page }) => {
    await page.goto(BASE_URL, { timeout: 30000 });

    const pillChanges = await page.evaluate(async () => {
      const { renderLiveEventFeed, resetLiveEventFeedForTest } = await import('/js/live-event-feed.js');

      const container = document.createElement('div');
      document.body.appendChild(container);

      resetLiveEventFeedForTest();

      const pricing = {
        'm1': { input: 2.5, output: 10, cacheRead: 0.625, cacheWrite: 0, source: 'openrouter' }
      };

      renderLiveEventFeed(container, {
        total_tokens: 1000, total_input: 800, total_cache_read: 200,
        tokens_by_model: { m1: { total: 1000, input: 800, cache_read: 200 } },
        pricing_by_model: pricing
      }, { source: 'cache', revision: 1 });

      const afterCache = container.querySelector('#latestPillText')?.textContent || '';

      renderLiveEventFeed(container, {
        total_tokens: 1000, total_input: 800, total_cache_read: 200,
        tokens_by_model: { m1: { total: 1000, input: 800, cache_read: 200 } },
        pricing_by_model: pricing
      }, { source: 'fresh-http', revision: 2 });

      const afterFirstFresh = container.querySelector('#latestPillText')?.textContent || '';

      renderLiveEventFeed(container, {
        total_tokens: 1500, total_input: 1100, total_cache_read: 400,
        tokens_by_model: { m1: { total: 1500, input: 1100, cache_read: 400 } },
        pricing_by_model: pricing
      }, { source: 'fresh-http', revision: 3 });

      const afterSecondFresh = container.querySelector('#latestPillText')?.textContent || '';

      container.remove();
      return { afterCache, afterFirstFresh, afterSecondFresh };
    });

    expect(pillChanges.afterFirstFresh).toBe(pillChanges.afterCache);
    expect(pillChanges.afterSecondFresh).not.toBe(pillChanges.afterFirstFresh);
    expect(pillChanges.afterSecondFresh).toContain('just burned');
    expect(pillChanges.afterSecondFresh).toMatch(/\d/);
  });
});
