// tests/unit/nav-buttons-single-binding.test.js
//
// #63: main.js:299-301 already attaches a click listener to every
// `.nav-btn` that calls setView(el.dataset.view). index.html must not also
// carry an inline onclick="setView(...)" on those same buttons, or every
// click invokes the tab-switch logic (including its ~300ms transition
// timers) twice.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('nav buttons are bound exactly once', () => {
  const html = readFileSync(join(import.meta.dir, '../../dashboard/index.html'), 'utf-8');

  it('has no inline onclick on .nav-btn elements', () => {
    const navButtonTags = html.match(/<button class="nav-btn[^>]*>/g) || [];
    expect(navButtonTags.length).toBeGreaterThan(0);
    for (const tag of navButtonTags) {
      expect(tag).not.toContain('onclick');
    }
  });

  it('keeps the data-view attribute main.js relies on to bind the click listener', () => {
    const navButtonTags = html.match(/<button class="nav-btn[^>]*>/g) || [];
    for (const tag of navButtonTags) {
      expect(tag).toMatch(/data-view="[^"]+"/);
    }
  });
});
