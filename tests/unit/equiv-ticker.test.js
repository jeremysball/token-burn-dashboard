// tests/unit/equiv-ticker.test.js
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { initEquivTickers, updateEquivTickers, resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';

const VALID_CORPUS = [
  { category: 'tokens', copy: '{n} tokens sampled' },
  { category: 'tokens', copy: 'another {n} tokens line' },
  { category: 'cost', copy: '${n} spent' },
  { category: 'burnRate', copy: '{n} per minute' }
];

const PARTIAL_CORPUS = [
  { category: 'tokens', copy: '{n} tokens sampled' }
];

const MISSING_CATEGORY_CORPUS = [
  { category: 'tokens', copy: '{n} tokens sampled' },
  { category: 'cost', copy: '${n} spent' }
];

const BLANK_COPY_CORPUS = [
  { category: 'tokens', copy: '' },
  { category: 'tokens', copy: '   ' },
  { category: 'cost', copy: '${n} spent' },
  { category: 'burnRate', copy: '{n} per minute' }
];

const MALFORMED_BODIES = [
  ['null payload', null],
  ['non-array object', {}],
  ['empty array', []],
  ['unknown categories only', [{ category: 'mystery', copy: '{n} mystery factoid' }]],
  ['missing burnRate category', MISSING_CATEGORY_CORPUS],
  ['blank copy values', BLANK_COPY_CORPUS],
  ['partial tokens-only', PARTIAL_CORPUS]
];

function captureTimers() {
  const real = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  let intervalCallbacks = [];
  let nextId = 100;
  /** @type {Map<number, Function>} */
  const scheduled = new Map();
  globalThis.setInterval = (cb) => { intervalCallbacks.push(cb); return intervalCallbacks.length; };
  globalThis.clearInterval = () => { intervalCallbacks = []; };
  globalThis.setTimeout = (cb) => { const id = ++nextId; scheduled.set(id, cb); return id; };
  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
  return {
    fireRotation() { intervalCallbacks.forEach(cb => cb()); },
    runFade(id) { const cb = scheduled.get(id); if (cb) cb(); },
    restore() {
      globalThis.setInterval = real.setInterval;
      globalThis.clearInterval = real.clearInterval;
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
    }
  };
}

describe('equiv-ticker', () => {
  beforeEach(() => {
    resetEquivTickersForTest();
    document.body.innerHTML = `
      <div class="equiv-ticker" data-equiv-category="tokens"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="cost"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="burnRate"><span class="equiv-text"></span></div>
    `;
  });

  afterEach(() => {
    resetEquivTickersForTest();
  });

  it('shows a curated fallback line immediately, before the corpus fetch resolves', () => {
    globalThis.fetch = mock(() => new Promise(() => {})); // never resolves
    initEquivTickers();
    updateEquivTickers({ tokens: 21630000000, cost: 11800, burnRate: 2150000 });

    const tokensText = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
    expect(tokensText.innerHTML.length).toBeGreaterThan(0);
  });

  it('mixes in corpus lines for the matching category once a valid corpus resolves', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(VALID_CORPUS))));
    await initEquivTickers();
    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
    expect(tokensEl._equivLines.some(l => l.includes('another 100 tokens line'))).toBe(true);
    expect(tokensEl._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
  });

  it('falls back to curated-only lines forever when the corpus fetch fails, without throwing', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down')));
    await initEquivTickers();
    expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.length).toBeGreaterThan(0);
    expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
  });

  MALFORMED_BODIES.forEach(([label, body]) => {
    it(`keeps curated fallback lines for a ${label} corpus, without throwing or going blank`, async () => {
      globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(body))));
      await initEquivTickers();
      expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();

      const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
      expect(tokensEl._equivLines.length).toBeGreaterThan(0);
      expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
      expect(tokensEl.querySelector('.equiv-text').textContent).not.toBe('');
    });
  });

  it('clears a category whose value is missing, zero, or non-finite', () => {
    globalThis.fetch = mock(() => new Promise(() => {}));
    initEquivTickers();
    updateEquivTickers({ tokens: 0, cost: NaN });

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines).toEqual([]);
    expect(tokensEl._equivIntervalId).toBeNull();
    expect(tokensEl.querySelector('.equiv-text').textContent).toBe('');
    const costEl = document.querySelector('[data-equiv-category="cost"]');
    expect(costEl._equivLines).toEqual([]);
    expect(costEl._equivIntervalId).toBeNull();
  });

  it('advances the rotation index and swaps text after a fade completes', () => {
    globalThis.fetch = mock(() => new Promise(() => {}));
    const timers = captureTimers();
    try {
      initEquivTickers();
      updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });

      const ticker = document.querySelector('[data-equiv-category="tokens"]');
      const textEl = ticker.querySelector('.equiv-text');
      const firstLine = textEl.innerHTML;
      expect(ticker._equivRotationIndex).toBe(0);

      timers.fireRotation();
      const fadeId = ticker._equivFadeTimeout;
      expect(fadeId).not.toBeNull();
      timers.runFade(fadeId);
      expect(ticker._equivRotationIndex).toBe(1);
      expect(textEl.innerHTML).not.toBe(firstLine);
    } finally {
      timers.restore();
    }
  });

  it('refreshes mounted fallback lines with corpus text when a delayed corpus resolves, without replacing the interval', async () => {
    let resolveFetch;
    globalThis.fetch = mock(() => new Promise((resolve) => {
      resolveFetch = () => resolve(new Response(JSON.stringify(VALID_CORPUS)));
    }));

    const initPromise = initEquivTickers();
    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });

    const ticker = document.querySelector('[data-equiv-category="tokens"]');
    const originalIntervalId = ticker._equivIntervalId;
    expect(originalIntervalId).not.toBeNull();
    expect(ticker._equivLines.some(l => l.includes('War and Peace'))).toBe(true);

    resolveFetch();
    await initPromise;

    expect(ticker._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
    expect(ticker._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
    expect(ticker._equivIntervalId).toBe(originalIntervalId);
  });
});
