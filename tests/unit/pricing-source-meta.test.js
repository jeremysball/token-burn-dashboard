/**
 * Tests for the centralized pricing-source badge helper (dashboard/js/utils.js).
 * Every view (dashboard.js, analytics tabs/shared.js) shares this one
 * implementation rather than each carrying its own openrouter/local ternary.
 */

import { getPricingSourceMeta } from '../../dashboard/js/utils.js';
import { describe, expect, it } from 'bun:test';

describe('getPricingSourceMeta', () => {
  it('labels Models.dev pricing distinctly from OpenRouter and local', () => {
    expect(getPricingSourceMeta({ source: 'models.dev' })).toMatchObject({
      source: 'models.dev',
      cssClass: 'modelsdev',
      label: 'Models.dev'
    });
  });

  it('labels OpenRouter pricing', () => {
    expect(getPricingSourceMeta({ source: 'openrouter' })).toMatchObject({
      source: 'openrouter',
      cssClass: 'openrouter',
      label: 'OpenRouter'
    });
  });

  it('defaults unknown or missing sources to local', () => {
    expect(getPricingSourceMeta({ source: 'local' })).toMatchObject({ source: 'local', cssClass: 'local', label: 'Local' });
    expect(getPricingSourceMeta({})).toMatchObject({ source: 'local', cssClass: 'local', label: 'Local' });
    expect(getPricingSourceMeta(null)).toMatchObject({ source: 'local', cssClass: 'local', label: 'Local' });
  });

  it('uses a dot-free cssClass token for models.dev so it stays a valid CSS class', () => {
    const meta = getPricingSourceMeta({ source: 'models.dev' });
    expect(meta.cssClass).not.toContain('.');
  });
});
