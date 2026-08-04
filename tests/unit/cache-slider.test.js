// tests/unit/cache-slider.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderCacheSlider } from '../../dashboard/js/cache-slider.js';

const dataAt = (hitRatePct) => {
  const cacheRead = hitRatePct * 1_000_000; // arbitrary scale
  const input = (100 - hitRatePct) * 1_000_000;
  return {
    total_input: input,
    total_cache_read: cacheRead,
    tokens_by_model: {
      'anthropic/claude-sonnet-5': { input, cache_read: cacheRead, output: 0, cache_write: 0, reasoning: 0, total: input + cacheRead }
    },
    pricing_by_model: {
      'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }
  };
};

describe('renderCacheSlider', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<section id="cache-savings-section"></section>';
    container = document.getElementById('cache-savings-section');
  });

  it('builds the section once and defaults the slider to the real hit rate', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    expect(slider).not.toBeNull();
    expect(Number(slider.value)).toBeCloseTo(90, 0);
    expect(Number(slider.max)).toBeCloseTo(90, 0);
  });

  it('updates the dollar readout when the slider is dragged', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const before = container.querySelector('#cacheSavedValue').textContent;

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));

    const after = container.querySelector('#cacheSavedValue').textContent;
    expect(after).not.toBe(before);
  });

  it('does not snap the slider back to the real rate on a subsequent render after the user dragged it', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));

    renderCacheSlider(container, dataAt(91)); // a later SSE update nudges the real rate slightly

    expect(Number(slider.value)).toBeCloseTo(10, 0);
  });
});