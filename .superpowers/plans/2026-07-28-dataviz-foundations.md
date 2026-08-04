# Dataviz Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mockup's shared assets (equivalence-factoid corpus, Lucide icon sprite, `formatFactoid()` template evaluator) into the real app so every later dataviz-widget plan can depend on them.

**Architecture:** Three independent, self-contained deliverables landed as one plan since none of them are individually worth a fresh-reviewer gate on their own: a static data file relocated with a build-time copy step, an inline SVG sprite relocated into `dashboard/index.html`, and a small pure-function module extracted from the mockup's inline script with a unit test.

**Tech Stack:** Bun (test runner + package manager), Vite 7 (dashboard build), vanilla JS ES modules (no framework).

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 1.
- No new npm/bun dependencies — every task uses only what's already in `package.json`.
- Tests run via `bun test tests/unit --coverage` (existing `bun run test` script); every new file must stay covered per `scripts/check-coverage.mjs`'s per-file 10% floor (trivially cleared by real tests here).
- This plan must land and merge before any of the 9 per-widget plans start, since the ticker (equiv-format.js), title belt (icon sprite), and league table (icon sprite via badge reuse) all import from it.

---

### Task 1: Move the equivalence-factoid corpus and wire the build to copy it

**Files:**
- Create: `dashboard/data/factoids-1000.json` (moved from `.lavish/factoids-1000.json`, byte-identical)
- Delete: `.lavish/factoids-1000.json`
- Create: `scripts/copy-static-data.mjs`
- Test: `tests/unit/scripts/copy-static-data.test.js`
- Modify: `package.json:25` (`build:ui` script)

**Interfaces:**
- Produces: `copyStaticData(srcDir, destDir)` (exported from `scripts/copy-static-data.mjs`) — copies `srcDir`'s contents into `destDir`, creating `destDir` if missing. Used by later tasks' `dist-dashboard/data/factoids-1000.json` expectation, and importable directly by the ticker/title-belt widget plans' Playwright fixtures if they need to assert the file is servable.

Vite's default `publicDir` (`dashboard/public/`) doesn't cover `dashboard/data/`, and the file isn't referenced anywhere in `dashboard/index.html` or a JS import, so Vite's own asset graph won't pick it up during `vite build`. `lib/routes/static.js`'s extension-fallback branch already serves any extensioned path under the dev/prod root verbatim (`dashboardSourceDir + url.pathname`), so once the file physically exists at `dashboard/data/factoids-1000.json` (dev) and `dist-dashboard/data/factoids-1000.json` (prod), `/data/factoids-1000.json` resolves correctly in both — no route changes needed, exactly as the spec requires. The prod side needs an explicit copy step since Vite won't do it implicitly.

- [ ] **Step 1: Move the corpus file**

```bash
mkdir -p dashboard/data
git mv .lavish/factoids-1000.json dashboard/data/factoids-1000.json
```

- [ ] **Step 2: Write the failing test for the copy helper**

```js
// tests/unit/scripts/copy-static-data.test.js
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStaticData } from '../../../scripts/copy-static-data.mjs';

describe('copyStaticData', () => {
  let src;
  let dest;

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'copy-static-data-src-'));
    dest = join(mkdtempSync(join(tmpdir(), 'copy-static-data-dest-')), 'nested', 'dist-dashboard-data');
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it('copies a flat file from src into a dest directory that does not exist yet', () => {
    writeFileSync(join(src, 'factoids-1000.json'), '[{"id":1}]');

    copyStaticData(src, dest);

    expect(existsSync(join(dest, 'factoids-1000.json'))).toBe(true);
    expect(readFileSync(join(dest, 'factoids-1000.json'), 'utf-8')).toBe('[{"id":1}]');
  });

  it('copies nested subdirectories', () => {
    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'sub', 'nested.json'), '{}');

    copyStaticData(src, dest);

    expect(existsSync(join(dest, 'sub', 'nested.json'))).toBe(true);
  });

  it('throws if the source directory does not exist', () => {
    rmSync(src, { recursive: true, force: true });
    expect(() => copyStaticData(src, dest)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/scripts/copy-static-data.test.js`
Expected: FAIL — `Cannot find module '../../../scripts/copy-static-data.mjs'`

- [ ] **Step 3: Write the copy script**

```js
// scripts/copy-static-data.mjs
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Copy every file/subdirectory under srcDir into destDir, creating destDir
 * (and any missing parents) if needed. Existing files in destDir with the
 * same relative path are overwritten.
 * @param {string} srcDir
 * @param {string} destDir
 */
export function copyStaticData(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    throw new Error(`copyStaticData: source directory does not exist: ${srcDir}`);
  }
  cpSync(srcDir, destDir, { recursive: true });
}

if (import.meta.main) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  copyStaticData(join(root, 'dashboard', 'data'), join(root, 'dist-dashboard', 'data'));
  console.log('Copied dashboard/data/ -> dist-dashboard/data/');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/scripts/copy-static-data.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the script into the build**

In `package.json`, change:

```json
    "build:ui": "bunx --bun vite build",
```

to:

```json
    "build:ui": "bunx --bun vite build && bun scripts/copy-static-data.mjs",
```

- [ ] **Step 6: Verify the full build produces the file**

Run: `bun run build:ui && test -f dist-dashboard/data/factoids-1000.json && echo OK`
Expected: `OK` printed, and `dist-dashboard/index.html` still references the hashed `styles/main.css`/`design-v2.css` bundle as before (unaffected by this change).

Clean up the build output afterward so it isn't accidentally committed:

```bash
rm -rf dist-dashboard
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/data/factoids-1000.json scripts/copy-static-data.mjs tests/unit/scripts/copy-static-data.test.js package.json
git commit -m "feat(dashboard): serve the equivalence-factoid corpus as a static asset"
```

---

### Task 2: Move the Lucide icon sprite into `dashboard/index.html`

**Files:**
- Modify: `dashboard/index.html`

**Interfaces:**
- Produces: four `<symbol>` ids in the DOM — `#icon-crown`, `#icon-thrift`, `#icon-wine`, `#icon-improved` — referenced later by the weekly-title-belt plan (`<svg><use href="#icon-crown"></use></svg>`, one per belt) and the league-table plan (badge icons, same ids).

The mockup's inline `<svg>` sprite block (`.lavish/burn-odometer-mockup.html:214-235`) is copied byte-for-byte, ISC notice included, into the real app's `<body>`. No new build step needed — this is a plain inline SVG the browser will use for every `<use href="#icon-*">` on the page, in both dev and prod, since it's part of `index.html` which Vite processes as the build's HTML entry either way.

- [ ] **Step 1: Insert the sprite block**

In `dashboard/index.html`, immediately after the opening `<body>` tag (`dashboard/index.html:13`) and before the `<!-- Ambient particles background -->` comment, insert:

```html
    <!--
      Icons adapted from Lucide Static 0.468.0.
      Copyright (c) Lucide Icons and Contributors.
      Licensed under the ISC License. Permission to use, copy, modify, and/or
      distribute this software for any purpose with or without fee is hereby
      granted, provided that the above copyright notice and this permission
      notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE
      AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
    -->
    <svg aria-hidden="true" width="0" height="0" style="position:absolute;overflow:hidden">
      <defs>
        <symbol id="icon-crown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
          <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
          <path d="M5 21h14"/>
        </symbol>
        <symbol id="icon-thrift" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
          <path d="M12 2v20"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </symbol>
        <symbol id="icon-wine" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
          <path d="M8 22h8"/>
          <path d="M7 10h10"/>
          <path d="M12 15v7"/>
          <path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>
        </symbol>
        <symbol id="icon-improved" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
          <path d="m22 7-8.5 8.5-5-5L2 17"/>
          <path d="M16 7h6v6"/>
        </symbol>
      </defs>
    </svg>
```

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `bun test tests/unit/dashboard-icon-sprite.test.js`
Expected before Step 1's edit: FAIL (4 missing `id="icon-*"` matches). After the edit: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html tests/unit/dashboard-icon-sprite.test.js
git commit -m "feat(dashboard): vendor the Lucide title-belt icon sprite"
```

---

### Task 3: Extract `formatFactoid()` into a shared, tested module

**Files:**
- Create: `dashboard/js/equiv-format.js`
- Test: `tests/unit/equiv-format.test.js`

**Interfaces:**
- Produces: `formatFactoid(copyTemplate: string, n: number): string`, the single named export. Takes a factoid's `copy` string (containing `{...}` placeholders) and a live numeric value, returns the copy with placeholders replaced by formatted numbers. Used directly by the equivalence-ticker widget plan.

This is a straight extraction of the mockup's inline `formatFactoid` (`.lavish/burn-odometer-mockup.html:591-605`) into its own module, unchanged in behavior, so it can be imported by both the real ticker widget and its unit test. It refuses to evaluate anything outside `[0-9.*/+\-() ]` in the extracted expression, returning the placeholder unmodified (`{...}` left as-is) rather than throwing or executing arbitrary code.

- [ ] **Step 1: Write the failing tests covering all 4 placeholder shapes**

```js
// tests/unit/equiv-format.test.js
import { describe, expect, it } from 'bun:test';
import { formatFactoid } from '../../dashboard/js/equiv-format.js';

describe('formatFactoid', () => {
  it('formats {n/X:.Nf} — division with fixed decimals', () => {
    expect(formatFactoid('~{n/1000000:.2f} million', 21630000)).toBe('~21.63 million');
  });

  it('formats {n*A/B:.Nf} — multiply-then-divide with fixed decimals', () => {
    expect(formatFactoid('{n*3/4:.1f} of it', 100)).toBe('75.0 of it');
  });

  it('formats {X/n:.Nf} — value in the denominator', () => {
    expect(formatFactoid('a {1000000/n:.3f} share', 4000000)).toBe('a 0.250 share');
  });

  it('formats bare {n} with locale grouping and rounding', () => {
    expect(formatFactoid('{n} total', 1234567)).toBe('1,234,567 total');
  });

  it('substitutes multiple placeholders in the same string', () => {
    expect(formatFactoid('{n} tokens (~{n/1000:.1f}k)', 2500)).toBe('2,500 tokens (~2.5k)');
  });

  it('refuses to evaluate an expression outside the allowed character set', () => {
    const malicious = '{n; fetch("https://evil.example")}';
    expect(formatFactoid(malicious, 42)).toBe(malicious);
  });

  it('refuses a well-formed-looking but non-numeric expression rather than throwing', () => {
    const template = '{n.constructor.constructor("return 1")()}';
    expect(() => formatFactoid(template, 42)).not.toThrow();
    expect(formatFactoid(template, 42)).toBe(template);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/equiv-format.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/equiv-format.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/equiv-format.js
/**
 * Evaluate a factoid's `copy` string against a live numeric value, replacing
 * every `{expr}` or `{expr:.Nf}` placeholder with the computed, formatted
 * result. `n` inside `expr` is substituted with the literal numeric value
 * before evaluation. Any placeholder whose expression contains a character
 * outside `[0-9.*/+\-() ]`, or that fails to evaluate to a finite number, is
 * left untouched in the output rather than throwing or executing arbitrary
 * code — this is the corpus's only trust boundary, since factoid `copy`
 * strings are data, not code the app authored.
 * @param {string} copyTemplate
 * @param {number} n
 * @returns {string}
 */
export function formatFactoid(copyTemplate, n) {
    return copyTemplate.replace(/\{([^}]+)\}/g, (whole, inner) => {
        const parts = inner.split(':.');
        const expr = parts[0].replace(/n/g, String(n));
        if (!/^[0-9.*/+\-() ]+$/.test(expr)) return whole;

        let value;
        try {
            // eslint-disable-next-line no-new-func -- expr is character-class-validated above
            value = Function('"use strict"; return (' + expr + ');')();
        } catch {
            return whole;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return whole;

        if (parts.length > 1) {
            const digits = parseInt(parts[1], 10) || 0;
            return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        }
        return Math.round(value).toLocaleString();
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/equiv-format.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/equiv-format.js tests/unit/equiv-format.test.js
git commit -m "feat(dashboard): extract formatFactoid() as a shared, tested module"
```
