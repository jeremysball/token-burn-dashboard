/**
 * Tests for the server-side Models.dev pricing module.
 */

const {
  buildModelsDevPricingRecord,
  getModelsDevPricingRecord,
  getModelsDevPricingSnapshot,
  setModelsDevPricingSnapshot
} = require('../../../lib/modelsdev');

import { beforeEach, describe, expect, it } from 'bun:test';

describe('buildModelsDevPricingRecord', () => {
  it('returns null when the entry has no usable cost fields', () => {
    expect(buildModelsDevPricingRecord('anthropic', 'ghost-model', { cost: {} })).toBeNull();
    expect(buildModelsDevPricingRecord('anthropic', 'ghost-model', {})).toBeNull();
    expect(buildModelsDevPricingRecord('anthropic', 'ghost-model', null)).toBeNull();
  });

  it('normalizes numeric cost fields and ignores non-finite values', () => {
    const record = buildModelsDevPricingRecord('anthropic', 'claude-haiku-4-5', {
      name: 'Claude Haiku 4.5',
      limit: { context: 200000 },
      cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25, reasoning: 'nope' }
    });

    expect(record).toMatchObject({
      id: 'anthropic/claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      provider: 'anthropic',
      contextLength: 200000,
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite: 1.25,
      source: 'models.dev'
    });
    expect(record.reasoning).toBeUndefined();
  });
});

describe('getModelsDevPricingRecord', () => {
  beforeEach(() => {
    setModelsDevPricingSnapshot({ catalog: {} });
  });

  const HAIKU_CATALOG = {
    anthropic: {
      models: {
        'claude-haiku-4-5': { name: 'Claude Haiku 4.5', cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } },
        'claude-haiku-4-5-20251001': { name: 'Claude Haiku 4.5', cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } },
        'claude-sonnet-5': { name: 'Claude Sonnet 5', cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } }
      }
    }
  };

  it('matches by full provider/model key', () => {
    setModelsDevPricingSnapshot({ catalog: HAIKU_CATALOG });

    const record = getModelsDevPricingRecord('anthropic/claude-haiku-4-5-20251001');
    expect(record).toMatchObject({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
  });

  it('matches by bare model id and is case-insensitive', () => {
    setModelsDevPricingSnapshot({ catalog: HAIKU_CATALOG });

    expect(getModelsDevPricingRecord('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
    expect(getModelsDevPricingRecord('ANTHROPIC/Claude-Haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
  });

  it('matches through an extra router-style provider prefix by stripping only the outer segment', () => {
    setModelsDevPricingSnapshot({ catalog: HAIKU_CATALOG });

    // stripProviderPrefix only removes the first "/"-delimited segment, so
    // "some-router/anthropic/claude-haiku-4-5-20251001" reduces to
    // "anthropic/claude-haiku-4-5-20251001", which matches the catalog directly.
    expect(getModelsDevPricingRecord('some-router/anthropic/claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
    expect(getModelsDevPricingRecord('anthropic/claude-haiku-4-5')).toMatchObject({ input: 1, output: 5 });
  });

  it('does not fuzzy-match a shorter id onto a longer catalog-only entry (no substring matching)', () => {
    setModelsDevPricingSnapshot({
      catalog: {
        openai: {
          models: {
            'gpt-4o-mini': { name: 'GPT-4o Mini', cost: { input: 0.15, output: 0.6 } }
          }
        }
      }
    });

    expect(getModelsDevPricingRecord('gpt-4o')).toBeNull();
  });

  it('returns null when the catalog has no matching entry', () => {
    setModelsDevPricingSnapshot({ catalog: HAIKU_CATALOG });
    expect(getModelsDevPricingRecord('totally-unknown-model')).toBeNull();
  });
});

describe('Models.dev snapshot round-trip', () => {
  it('preserves the raw catalog through get/set so a worker seed does not silently lose pricing', () => {
    const catalog = {
      anthropic: {
        models: {
          'claude-haiku-4-5': { name: 'Claude Haiku 4.5', cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } }
        }
      }
    };

    setModelsDevPricingSnapshot({ fetchedAt: 12345, source: 'models.dev', catalog, error: null });

    const snapshot = getModelsDevPricingSnapshot();
    expect(snapshot.catalog).toEqual(catalog);

    // Round-trip through another set/get should rebuild identical records
    // rather than treating the already-normalized snapshot as raw data.
    setModelsDevPricingSnapshot(snapshot);
    const record = getModelsDevPricingRecord('anthropic/claude-haiku-4-5');
    expect(record).toMatchObject({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
  });
});
