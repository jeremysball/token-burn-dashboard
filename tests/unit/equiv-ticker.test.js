// tests/unit/equiv-ticker.test.js
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { initEquivTickers, updateEquivTickers, resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';

const CORPUS = [
  { category: 'tokens', copy: '{n} tokens sampled' },
  { category: 'tokens', copy: 'another {n} tokens line' },
  { category: 'cost', copy: '${n} spent' }
];

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

  it('mixes in corpus lines for the matching category once the fetch resolves', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(CORPUS))));
    initEquivTickers();
    await Promise.resolve(); // let the fetch microtask chain settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
    expect(tokensEl._equivLines.some(l => l.includes('another 100 tokens line'))).toBe(true);
    expect(tokensEl._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
  });

  it('falls back to curated-only lines forever when the corpus fetch fails, without throwing', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down')));
    initEquivTickers();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.length).toBeGreaterThan(0);
    expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
  });

  it('skips a category whose value is missing, zero, or non-finite', () => {
    globalThis.fetch = mock(() => new Promise(() => {}));
    initEquivTickers();
    updateEquivTickers({ tokens: 0, cost: NaN });

    expect(document.querySelector('[data-equiv-category="tokens"]')._equivLines).toBeUndefined();
    expect(document.querySelector('[data-equiv-category="cost"]')._equivLines).toBeUndefined();
  });
});