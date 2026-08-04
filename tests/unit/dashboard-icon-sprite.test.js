// tests/unit/dashboard-icon-sprite.test.js
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('dashboard icon sprite', () => {
  const html = readFileSync(join(import.meta.dir, '../../dashboard/index.html'), 'utf-8');

  it('defines all four title-belt icon symbols', () => {
    for (const id of ['icon-crown', 'icon-thrift', 'icon-wine', 'icon-improved']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('carries the ISC license notice', () => {
    expect(html).toContain('Licensed under the ISC License');
  });
});
