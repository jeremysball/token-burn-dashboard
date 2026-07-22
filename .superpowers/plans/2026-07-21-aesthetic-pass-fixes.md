# Aesthetic Pass Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the aesthetic-pass findings from `.superpowers/specs/2026-07-21-fable-design-aesthetic-review-findings.md` (Fable 5's frontend-design review) — decorative emoji, the Plotly theme-toggle resize bug, the Timeline tab's empty default state, toast placement, background particles, and small polish items (pills, native select, mobile header row).

**Architecture:** Every task edits `dashboard/` (the live token_burn dashboard app), never `dist/` (a separate, unrelated bundle — do not touch it). Emoji removal is verified by a new regex-based jest guard test (`tests/unit/no-decorative-emoji.test.js`) that grows across Tasks 1–3. Logic changes (Plotly resize, toast positioning, timeline range fallback) land as small pure/testable functions in `dashboard/js/utils.js` or `dashboard/js/views/analytics.js`, following the existing `tests/unit/utils.test.js` / `tests/unit/config.test.js` jest+jsdom pattern. Pure CSS/markup polish (pills, select chevron, mobile header, particles) has no jest coverage in this codebase and is verified by running `npm run dev` (serves on `http://localhost:7071/dashboard/`, per `lib/config.js`) and checking the browser directly — each such task's steps say exactly what to look at.

**Tech Stack:** Vanilla JS ES modules (`dashboard/js/`), Plotly.js (loaded via CDN `<script>` in `dashboard/index.html`, global `Plotly`), jest 30 + jsdom + babel (`jest.config.js`, `tests/unit/`), plain CSS custom properties (`dashboard/styles/main.css`).

## Global Constraints

- Never touch `dist/` — it's a separate, pre-existing, unrelated bundle (confirmed out of scope for this session).
- Conventional Commits format for every commit: `<type>(<scope>): <description>`.
- Only commit when this plan's execution flow reaches a commit step — don't batch beyond what each task specifies.
- Excluded from this plan (tracked separately, do not implement here): the hero-grid dead-quadrant fix (finding 7 — belongs to the Blocking IA plan) and the light theme's overall direction/fate (finding 2 — a bigger call than a "quick win", not yet decided by the user).
- Decorative emoji replacement scope is the **full inventory** found by `rg -nP '[\x{1F000}-\x{1FFFF}\x{2600}-\x{27BF}\x{2190}-\x{21FF}\x{2B00}-\x{2BFF}]' dashboard/ --glob '!*.map'` (confirmed with the user), **except** the plain-text status glyphs `✓ ✗ ⚠ ↻` (functional indicators, not decorative color emoji — confirmed with the user to leave alone).
- Background particles direction (finding 6): **commit to the ember motif** (raise visibility, keep motion, gate behind `prefers-reduced-motion`) — confirmed with the user, not "remove".
- Theme-toggle glyph (currently static `🌓`, never updates): swap to plain-text Unicode `☾` (dark) / `☀` (light), updated dynamically in `toggleTheme()` and on init — confirmed with the user.

---

## Task 1: Emoji sweep — `dashboard/index.html` + theme-toggle dynamic glyph

**Files:**
- Create: `tests/unit/no-decorative-emoji.test.js`
- Modify: `dashboard/index.html` (title, subnav tab labels, section headers, LLM icon span, git-directory default option)
- Modify: `dashboard/js/main.js:169-174` (`toggleTheme`), `:232-259` (`init`)

**Interfaces:**
- Produces: `updateThemeToggleGlyph(theme)` in `dashboard/js/main.js` (module-private, not exported — used later by Task 4's `toggleTheme` edit).

- [ ] **Step 1: Write the failing guard test**

```js
// tests/unit/no-decorative-emoji.test.js
const fs = require('fs');
const path = require('path');

// Decorative color emoji Fable flagged as breaking the mono system.
// Excludes plain-text status glyphs (already in the mono spirit) and the
// theme-toggle's plain-text moon/sun, which stay.
const DECORATIVE_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]️?/gu;
const ALLOWED = new Set(['✓', '✗', '⚠', '↻', '☾', '☀']);

const readSource = (relPath) => fs.readFileSync(path.join(__dirname, '../../', relPath), 'utf8');

const expectNoDecorativeEmoji = (relPath) => {
  const content = readSource(relPath);
  const matches = (content.match(DECORATIVE_EMOJI) || []).filter((m) => !ALLOWED.has(m));
  expect(matches).toEqual([]);
};

describe('decorative emoji sweep', () => {
  it('dashboard/index.html has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/index.html');
  });

  it('dashboard/js/main.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/main.js');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/no-decorative-emoji.test.js`
Expected: FAIL — both `it` blocks report leftover matches (`🔥`, `🔍`, `📚`, `💻`, `🎉`, `💰`, `🔮`, `🧠`, `📁`, `🌓`, etc.)

- [ ] **Step 3: Sweep `dashboard/index.html`**

Apply these exact replacements (all are emoji-prefix-plus-space removals unless noted):

```html
<!-- line 6 -->
<title>token_burn // live</title>

<!-- line 26 -->
<span class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">☾</span>

<!-- line 82 -->
<h2>insights</h2>

<!-- lines 96-101 -->
<button class="subnav-btn" data-tab="insights" onclick="setAnalyticsTab('insights')">Insights</button>
<button class="subnav-btn" data-tab="scale" onclick="setAnalyticsTab('scale')">Scale</button>
<button class="subnav-btn" data-tab="code" onclick="setAnalyticsTab('code')">Code</button>
<button class="subnav-btn" data-tab="heatmaps" onclick="setAnalyticsTab('heatmaps')">Heatmaps</button>
<button class="subnav-btn" data-tab="git" onclick="setAnalyticsTab('git')">Git Blame</button>
<button class="subnav-btn" data-tab="spikes" onclick="setAnalyticsTab('spikes')">Spikes</button>

<!-- line 165 -->
<h3>Deep Pattern Analysis</h3>

<!-- line 178 — remove the whole line, the span is purely decorative -->
<!-- delete: <span class="llm-icon">🧠</span> -->

<!-- line 194 -->
<h3>Git Blame for AI</h3>

<!-- line 197 -->
<option value="">Current Directory</option>

<!-- line 223 -->
<h4>Most Expensive Commits</h4>

<!-- line 229 -->
<h4>Detected Projects</h4>

<!-- line 240 -->
<h4>Commit Session Details</h4>

<!-- line 253 -->
<h3>Token Scale Visualization</h3>

<!-- line 265 -->
<h3>Code Statistics</h3>

<!-- line 277 -->
<h3>Usage Heatmaps</h3>

<!-- line 294 -->
<h3>Spike Detective</h3>

<!-- line 305 -->
<h4>Investigation Results</h4>
```

- [ ] **Step 4: Add the dynamic theme-toggle glyph to `dashboard/js/main.js`**

Add just above `toggleTheme` (currently `main.js:168-174`):

```js
// ===== THEME =====
const THEME_GLYPHS = { dark: '☾', light: '☀' };

const updateThemeToggleGlyph = (theme) => {
    const toggle = document.querySelector('.theme-toggle');
    if (toggle) toggle.textContent = THEME_GLYPHS[theme] || THEME_GLYPHS.dark;
};

const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tokenBurnTheme', next);
    updateThemeToggleGlyph(next);
};
```

Then update `init()` (currently `main.js:232-236`) to set the glyph on load:

```js
const init = () => {
    // Load theme
    const savedTheme = localStorage.getItem('tokenBurnTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeToggleGlyph(savedTheme);
```

- [ ] **Step 5: Sweep the remaining `main.js` emoji (milestone toasts, `main.js:99-126`)**

```js
        notify(`Milestone Reached: ${tokenBillions}B Tokens!`, 'success');
```

```js
        notify(`Milestone Reached: $${costHundreds * 100} Total Spent!`, 'success');
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/no-decorative-emoji.test.js`
Expected: PASS (2 passed)

- [ ] **Step 7: Commit**

```bash
git add tests/unit/no-decorative-emoji.test.js dashboard/index.html dashboard/js/main.js
git commit -m "fix(dashboard): strip decorative emoji from shell markup and add dynamic theme-toggle glyph"
```

---

## Task 2: Emoji sweep — `dashboard/js/config.js` + `dashboard/js/views/dashboard.js`

**Files:**
- Modify: `dashboard/js/config.js:10-21` (`emojis` map, `getEmoji`)
- Modify: `dashboard/js/views/dashboard.js:296-334` (insight icons), `:268` (top-model badge, unchanged call site — only `getEmoji`'s return values change)
- Modify: `tests/unit/config.test.js` (update expected `getEmoji` return values)
- Modify: `tests/unit/no-decorative-emoji.test.js` (add 2 files to the sweep)

**Interfaces:**
- Consumes: `getEmoji(name)` signature unchanged (still takes a model name string, still returns a single string) — only the returned glyphs change from color emoji to single uppercase letters.

- [ ] **Step 1: Extend the failing guard test**

```js
  it('dashboard/js/config.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/config.js');
  });

  it('dashboard/js/views/dashboard.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/views/dashboard.js');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/no-decorative-emoji.test.js`
Expected: FAIL — 2 new failures for `config.js` and `dashboard.js`

- [ ] **Step 3: Replace the provider emoji map with mono letter badges**

`dashboard/js/config.js:10-21`:

```js
// ===== PROVIDER BADGES =====
export const emojis = {
    kimi: 'K', claude: 'C', gpt: 'O', openai: 'O',
    gemini: 'G', glm: 'Z', zai: 'Z', llama: 'L', deepseek: 'D'
};

export const getEmoji = name => {
    for (const [k, v] of Object.entries(emojis)) {
        if (name.toLowerCase().includes(k)) return v;
    }
    return '?';
};
```

- [ ] **Step 4: Update the existing `getEmoji` unit tests to match**

`tests/unit/config.test.js:16-42`:

```js
  describe('getEmoji', () => {
    it('returns correct badge for kimi models', () => {
      expect(getEmoji('kimi-coding/k2p5')).toBe('K');
      expect(getEmoji('KIMI-PRO')).toBe('K');
    });

    it('returns correct badge for claude models', () => {
      expect(getEmoji('claude-3.5-sonnet')).toBe('C');
      expect(getEmoji('anthropic/claude')).toBe('C');
    });

    it('returns correct badge for gpt models', () => {
      expect(getEmoji('gpt-4o')).toBe('O');
      expect(getEmoji('openai/gpt-4')).toBe('O');
    });

    it('returns correct badge for gemini models', () => {
      expect(getEmoji('gemini-1.5-pro')).toBe('G');
      expect(getEmoji('google/gemini')).toBe('G');
    });

    it('returns default badge for unknown models', () => {
      expect(getEmoji('unknown-model')).toBe('?');
      expect(getEmoji('')).toBe('?');
    });
  });
```

- [ ] **Step 5: Replace `dashboard.js` insight icons**

`dashboard/js/views/dashboard.js:296-334` (`generateInsights`), four `insights.push` calls:

```js
        insights.push({
            icon: '#',
            title: 'Top Model',
            value: `${top[0].split('/').pop()}`,
            detail: `${pct}% of total usage`
        });
```

```js
    insights.push({
        icon: cacheRate > 0.5 ? '▲' : '▽',
        title: 'Cache Efficiency',
        value: `${(cacheRate * 100).toFixed(1)}%`,
        detail: cacheRate > 0.5 ? 'Great cache hit rate!' : 'Consider more caching'
    });
```

```js
        insights.push({
            icon: '$',
            title: 'Lifetime Cost',
            value: `$${cost.toFixed(2)}`,
            detail: `${(cost / (total_tokens / 1e6)).toFixed(2)} per 1M tokens`
        });
```

```js
        insights.push({
            icon: 'Δ',
            title: 'Current Velocity',
            value: `${fmtNum(avg)}/hr`,
            detail: 'Average over last 5 data points'
        });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/no-decorative-emoji.test.js tests/unit/config.test.js`
Expected: PASS (4 + existing config tests all green)

- [ ] **Step 7: Commit**

```bash
git add dashboard/js/config.js dashboard/js/views/dashboard.js tests/unit/config.test.js tests/unit/no-decorative-emoji.test.js
git commit -m "fix(dashboard): replace provider emoji and insight-card icons with mono glyphs"
```

---

## Task 3: Emoji sweep — `dashboard/js/views/analytics.js`

**Files:**
- Modify: `dashboard/js/views/analytics.js` (timeline empty state, deep-insight icons, scale comparisons, code stats, git blame empty states + directory selector, project-scale header)
- Modify: `tests/unit/no-decorative-emoji.test.js` (add the last file to the sweep)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SCALE_COMPARISONS` entries no longer carry an `icon` field (Task 3 is the only place that reads it, so this is a self-contained removal).

- [ ] **Step 1: Extend the failing guard test**

```js
  it('dashboard/js/views/analytics.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/views/analytics.js');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/no-decorative-emoji.test.js`
Expected: FAIL — 1 new failure for `analytics.js`

- [ ] **Step 3: Timeline empty state (`analytics.js:260-265`)**

```js
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 40px; color: var(--mono-text-muted);">
                <div style="font-size: 2rem; margin-bottom: 16px;">∅</div>
                <div style="margin-bottom: 8px;">Not enough data for the last <strong>${currentRange}</strong></div>
                <div style="font-size: 0.85rem; opacity: 0.7;">Try selecting a wider time range above</div>
            </div>`;
```

- [ ] **Step 4: Deep-insight icons (`analytics.js:441-587`)**

Replace each `icon:` line in `calculateDeepInsights`:

```js
        insights.push({
            icon: '#',
            title: 'Most Efficient Model',
```

```js
    insights.push({
        icon: cacheRate > 0.5 ? '▲' : '▽',
        title: 'Cache Efficiency',
```

```js
        insights.push({
            icon: change >= 20 ? '»' : change >= 0 ? '▲' : change >= -20 ? '→' : '▼',
            title: 'Usage Trend',
```

```js
        insights.push({
            icon: concentration > 0.8 ? '!' : concentration > 0.5 ? 'Δ' : '○',
            title: 'Cost Concentration',
```

```js
        insights.push({
            icon: tokensPerLine > 500 ? 'Δ' : tokensPerLine > 100 ? '·' : '▽',
            title: 'Token Productivity',
```

```js
        const timeLabel = peakHour >= 5 && peakHour < 12 ? 'morning' :
                         peakHour >= 12 && peakHour < 17 ? 'afternoon' :
                         peakHour >= 17 && peakHour < 21 ? 'evening' : 'night';

        insights.push({
            icon: '·',
            title: 'Peak Hour',
```

```js
    insights.push({
        icon: inputRatio > 0.8 ? '←' : outputRatio > 0.5 ? '→' : '○',
        title: 'I/O Pattern',
```

- [ ] **Step 5: Scale tab — drop decorative icons entirely (`analytics.js:1195-1206`, `:1240`, `:1248`)**

```js
const SCALE_COMPARISONS = [
    { name: 'Tweet', tokens: 280, desc: 'A single tweet' },
    { name: 'Paragraph', tokens: 200, desc: 'Average paragraph' },
    { name: 'Page', tokens: 500, desc: 'Single typed page' },
    { name: 'Short Story', tokens: 7500, desc: 'Short story (15 pages)' },
    { name: 'Novel Chapter', tokens: 25000, desc: 'One book chapter' },
    { name: 'Novel', tokens: 100000, desc: 'Full novel (200 pages)' },
    { name: 'Shakespeare Play', tokens: 300000, desc: 'Complete Shakespeare play' },
    { name: 'Bible', tokens: 4000000, desc: 'The entire Bible' },
    { name: 'Encyclopedia', tokens: 40000000, desc: 'Full encyclopedia set' },
    { name: 'Codebase', tokens: 100000000, desc: 'Large software codebase' }
];
```

Line 1240 (`achieved-state` message):

```js
        ` : '<div class="scale-achieved">All milestones achieved!</div>'}
```

Line 1248 — delete the icon `<div>` from the card template entirely:

```js
                    <div class="scale-card ${achieved ? 'achieved' : ''}">
                        <div class="scale-name">${comp.name}</div>
                        <div class="scale-desc">${comp.desc}</div>
                        <div class="scale-tokens">${fmtInt(comp.tokens)} tokens</div>
                        ${achieved ? `<div class="scale-multiple">${multiple}×</div>` : ''}
                    </div>
```

- [ ] **Step 6: Code stats — drop decorative icons entirely (`analytics.js:1291-1332`)**

Remove all four `<div class="code-stat-icon">...</div>` lines from the `code-summary-grid` template (lines 1294, 1299, 1304, 1309), leaving each `.code-stat-card` with just its value and label:

```js
    summaryContainer.innerHTML = `
        <div class="code-summary-grid">
            <div class="code-stat-card primary">
                <div class="code-stat-value">${fmtNum(totalLines)}</div>
                <div class="code-stat-label">Lines of Code Processed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(filesProcessed)}</div>
                <div class="code-stat-label">Files Analyzed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(totalTokens / (filesProcessed || 1))}</div>
                <div class="code-stat-label">Avg Tokens per File</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(totalTokens / (totalLines || 1))}</div>
                <div class="code-stat-label">Avg Tokens per Line</div>
            </div>
        </div>
    `;
```

And the two headers further down (lines 1317, 1332):

```js
        <h4>Equivalent Code Volume by Language</h4>
```

```js
            <h4>Project Scale Comparison</h4>
```

- [ ] **Step 7: Git blame empty states + directory selector (`analytics.js:868-881`, `:892`)**

```js
    } catch (err) {
        document.getElementById('git-commits-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">!</div>
                <h4>Unable to load git data</h4>
                <p>${err.message}</p>
            </div>
        `;
        document.getElementById('git-files-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">∅</div>
                <h4>No project data</h4>
                <p>Could not load project cost analysis</p>
            </div>
        `;
    }
```

```js
    selector.innerHTML = directories.map(dir => {
        const icon = dir.isGitRepo ? '▪' : '▫';
        const selected = dir.path === currentValue ? 'selected' : '';
        return `<option value="${dir.path}" ${selected}>${icon} ${dir.name}</option>`;
    }).join('');
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/unit/no-decorative-emoji.test.js`
Expected: PASS (4 passed — all four files clean)

- [ ] **Step 9: Run the full suite to catch any incidental breakage**

Run: `npm test`
Expected: PASS — all existing suites green, no regressions from the `SCALE_COMPARISONS` shape change or the icon removals (nothing else reads `comp.icon`, confirmed via `rg -n "\.icon" dashboard/js/views/analytics.js` returning only the write sites just edited).

- [ ] **Step 10: Commit**

```bash
git add dashboard/js/views/analytics.js tests/unit/no-decorative-emoji.test.js
git commit -m "fix(dashboard): replace remaining decorative emoji in analytics view with mono glyphs"
```

---

## Task 4: Fix Plotly resize-on-theme-toggle

**Files:**
- Modify: `dashboard/js/utils.js` (add `resizeVisiblePlots`)
- Modify: `dashboard/js/main.js:1-5` (import), `toggleTheme` (from Task 1)
- Test: `tests/unit/utils.test.js`

**Interfaces:**
- Produces: `export const resizeVisiblePlots = () => {}` in `dashboard/js/utils.js` — no args, no return value. Calls `Plotly.Plots.resize(el)` for every known chart container that has already been plotted (Plotly sets `.data` directly on the target DOM node when `Plotly.newPlot`/`Plotly.react` runs on it — that's the "already plotted" signal this function checks).
- Consumes: global `Plotly` (already used elsewhere in `utils.js`, e.g. `getPlotlyLayout`), and the 5 known chart container ids: `dashboard-live-chart` (`dashboard.js`), `compare-chart-container`, `timeline-chart-container`, `calendar-container`, `distribution-chart-container` (all four in `analytics.js`).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/utils.test.js — add inside the existing describe('Utils Module', ...) block
  describe('resizeVisiblePlots', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="dashboard-live-chart"></div>
        <div id="timeline-chart-container"></div>
        <div id="compare-chart-container"></div>
        <div id="calendar-container"></div>
        <div id="distribution-chart-container"></div>
      `;
      global.Plotly.Plots = { resize: jest.fn() };
    });

    it('resizes only containers that have already been plotted', () => {
      document.getElementById('dashboard-live-chart').data = [{}];
      document.getElementById('timeline-chart-container').data = [{}];

      resizeVisiblePlots();

      expect(global.Plotly.Plots.resize).toHaveBeenCalledTimes(2);
      expect(global.Plotly.Plots.resize).toHaveBeenCalledWith(document.getElementById('dashboard-live-chart'));
      expect(global.Plotly.Plots.resize).toHaveBeenCalledWith(document.getElementById('timeline-chart-container'));
    });

    it('does nothing for containers that were never plotted', () => {
      resizeVisiblePlots();
      expect(global.Plotly.Plots.resize).not.toHaveBeenCalled();
    });

    it('does nothing when Plotly is unavailable', () => {
      const original = global.Plotly;
      global.Plotly = undefined;
      expect(() => resizeVisiblePlots()).not.toThrow();
      global.Plotly = original;
    });
  });
```

Add `resizeVisiblePlots` to the existing import on line 5:

```js
import { fmtNum, fmtCur, fmtDate, createSparkline, notify, setText, hide, show, getPlotlyLayout, resizeVisiblePlots } from '../../dashboard/js/utils.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/utils.test.js`
Expected: FAIL with "resizeVisiblePlots is not a function" / not exported

- [ ] **Step 3: Implement `resizeVisiblePlots` in `dashboard/js/utils.js`**

Add after `getPlotlyConfig` (end of the file):

```js
// ===== PLOTLY RESIZE =====
const LIVE_PLOT_CONTAINER_IDS = [
    'dashboard-live-chart',
    'compare-chart-container',
    'timeline-chart-container',
    'calendar-container',
    'distribution-chart-container'
];

export const resizeVisiblePlots = () => {
    if (typeof Plotly === 'undefined' || !Plotly.Plots) return;
    LIVE_PLOT_CONTAINER_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.data) Plotly.Plots.resize(el);
    });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/utils.test.js`
Expected: PASS (3 new tests + all existing utils tests green)

- [ ] **Step 5: Wire it into `toggleTheme` in `dashboard/js/main.js`**

Update the import (`main.js:1`):

```js
import { fmtNum, notify, resizeVisiblePlots } from './utils.js';
```

Update `toggleTheme` (written in Task 1) to call it after the theme attribute changes:

```js
const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tokenBurnTheme', next);
    updateThemeToggleGlyph(next);
    resizeVisiblePlots();
};
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev` (serves on `http://localhost:7071/dashboard/`, per `lib/config.js`'s `PORT` default)
Open the dashboard, wait for the Live Token Flow chart to render (needs ≥2 history points — reload once or twice if it shows "Collecting data..."), click the theme toggle, and confirm the chart redraws at full container width immediately (no half-width artifact, no need to resize the window to trigger a fix).

- [ ] **Step 7: Commit**

```bash
git add dashboard/js/utils.js dashboard/js/main.js tests/unit/utils.test.js
git commit -m "fix(dashboard): resize live Plotly charts after a theme toggle"
```

---

## Task 5: Timeline tab default-range fallback

**Files:**
- Modify: `dashboard/js/views/analytics.js` (`getCutoffTime`, `renderTimelineTab`)
- Modify: `dashboard/js/state.js` (no signature changes — `setAnalyticsRange` already exists and is reused)
- Test: `tests/unit/analytics.test.js` (new file — first test file for `analytics.js`)

**Interfaces:**
- Produces: `resolveAvailableRange(sourceData, requestedRange)` (module-private in `analytics.js`, but exported for the new test file) — takes the same `sourceData` array `renderTimelineTab` already filters (`{ time: number, ... }[]`) and the currently-requested range string (`'1h' | '24h' | '7d' | '30d' | 'all'`); returns whichever range in `['1h', '24h', '7d', '30d', 'all']` (starting from the requested one, then widening) is the narrowest with ≥2 matching points, or `'all'` if none qualify.
- Consumes: the existing `RANGE_DURATIONS` lookup currently inlined in `getCutoffTime` (`analytics.js:744-754`) — pulled out to a shared constant both `getCutoffTime` and `resolveAvailableRange` use, so the two stay in sync.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/analytics.test.js
/**
 * @jest-environment jsdom
 */
import { resolveAvailableRange } from '../../dashboard/js/views/analytics.js';

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const point = (msAgo) => ({ time: now - msAgo, total: 100 });

describe('resolveAvailableRange', () => {
  it('keeps the requested range when it already has enough data', () => {
    const data = [point(HOUR), point(2 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('24h');
  });

  it('widens from 24h to 7d when 24h has insufficient data', () => {
    const data = [point(3 * 24 * HOUR), point(5 * 24 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('7d');
  });

  it('widens all the way to "all" when nothing else qualifies', () => {
    const data = [point(60 * 24 * HOUR), point(90 * 24 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('all');
  });

  it('does not widen past the requested range if it is already "all"', () => {
    expect(resolveAvailableRange([], 'all')).toBe('all');
  });

  it('does not narrow — widening only ever moves to a wider range than requested', () => {
    const data = [point(HOUR), point(2 * HOUR)];
    expect(resolveAvailableRange(data, '7d')).toBe('7d');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/analytics.test.js`
Expected: FAIL — `resolveAvailableRange` is not exported from `analytics.js`

- [ ] **Step 3: Extract `RANGE_DURATIONS` and implement `resolveAvailableRange`**

Replace `getCutoffTime` (`analytics.js:744-754`) with:

```js
// ===== HELPERS =====
const RANGE_ORDER = ['1h', '24h', '7d', '30d', 'all'];
const RANGE_DURATIONS = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    'all': Infinity
};

const getCutoffTime = (range = analyticsRange) => {
    const now = Date.now();
    return now - (RANGE_DURATIONS[range] || RANGE_DURATIONS['24h']);
};

export const resolveAvailableRange = (sourceData, requestedRange) => {
    const startIndex = RANGE_ORDER.indexOf(requestedRange);
    const candidates = startIndex === -1 ? RANGE_ORDER : RANGE_ORDER.slice(startIndex);

    for (const range of candidates) {
        const cutoff = getCutoffTime(range);
        const count = sourceData.filter((h) => h.time > cutoff).length;
        if (count >= 2) return range;
    }
    return 'all';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/analytics.test.js`
Expected: PASS (5 passed)

- [ ] **Step 5: Wire it into `renderTimelineTab` (`analytics.js:248-286`)**

```js
const renderTimelineTab = () => {
    const container = document.getElementById('timeline-chart-container');
    if (!container || typeof Plotly === 'undefined') return;

    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;
    const resolvedRange = resolveAvailableRange(sourceData, analyticsRange);
    if (resolvedRange !== analyticsRange) {
        setAnalyticsRange(resolvedRange);
        document.querySelectorAll('.range-selector button').forEach((el) => {
            el.classList.toggle('active', el.textContent.toLowerCase() === resolvedRange.toLowerCase());
        });
    }

    const cutoff = getCutoffTime();
    const filtered = sourceData.filter(h => h.time > cutoff);

    // If even "all" has insufficient data, show the empty state.
    if (filtered.length < 2) {
        const rangeLabels = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', 'all': 'all time' };
        const currentRange = rangeLabels[analyticsRange] || analyticsRange;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 40px; color: var(--mono-text-muted);">
                <div style="font-size: 2rem; margin-bottom: 16px;">∅</div>
                <div style="margin-bottom: 8px;">Not enough data for the last <strong>${currentRange}</strong></div>
                <div style="font-size: 0.85rem; opacity: 0.7;">Try selecting a wider time range above</div>
            </div>`;
        return;
    }

    const mobile = isCompactViewport();
    const traces = [{
        x: filtered.map(d => new Date(d.time)),
        y: filtered.map(d => d.total || 0),
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: CHART_COLORS[0], width: 2 },
        fillcolor: 'rgba(251, 191, 36, 0.1)',
        name: 'Tokens/hour'
    }];

    Plotly.newPlot('timeline-chart-container', traces, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 16, b: 40, l: 52 } : { t: 20, r: 20, b: 40, l: 60 },
        yaxis: { title: 'Tokens', automargin: true }
    }, { displayModeBar: false });
};
```

Note: this only widens the range on the Timeline tab's own render — `analyticsRange` is otherwise read only by `getCutoffTime` (confirmed via `rg -n "analyticsRange" dashboard/js/views/analytics.js`), so this can't affect Models/Compare/Distribution/Calendar.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, open the Analytics → Timeline tab on a dataset where the last 24h is empty but 7d/30d/all have points. Confirm it lands directly on a range with data (no "Not enough data" message) and the matching range pill (`7d`, `30d`, or `All`) shows as active.

- [ ] **Step 8: Commit**

```bash
git add dashboard/js/views/analytics.js tests/unit/analytics.test.js
git commit -m "fix(dashboard): auto-widen Timeline tab to the narrowest range with data"
```

---

## Task 6: Toast placement — reposition below header, drop the redundant "Data refreshed" toast

**Files:**
- Modify: `dashboard/js/utils.js` (add `positionNotifications`)
- Modify: `dashboard/js/main.js` (call `positionNotifications` on init + window resize)
- Modify: `dashboard/js/api.js:59` (remove the redundant toast)
- Modify: `dashboard/styles/main.css:1331-1340` (`.notification-container`)
- Test: `tests/unit/utils.test.js`, `tests/unit/api.test.js`

**Interfaces:**
- Produces: `export const positionNotifications = () => {}` in `dashboard/js/utils.js` — reads `.dashboard-header`'s rendered bottom edge and sets the `#notifications` container's `top` inline style to `bottom + 12px`, clearing any `bottom` inline style. No return value.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/utils.test.js — new describe block
  describe('positionNotifications', () => {
    it('positions the container below the header', () => {
      document.body.innerHTML = `
        <header class="dashboard-header"></header>
        <div class="notification-container" id="notifications"></div>
      `;
      const header = document.querySelector('.dashboard-header');
      header.getBoundingClientRect = () => ({ bottom: 88 });

      positionNotifications();

      const container = document.getElementById('notifications');
      expect(container.style.top).toBe('100px');
      expect(container.style.bottom).toBe('');
    });

    it('does nothing when the header or container is missing', () => {
      document.body.innerHTML = '';
      expect(() => positionNotifications()).not.toThrow();
    });
  });
```

Add `positionNotifications` to the existing import:

```js
import { fmtNum, fmtCur, fmtDate, createSparkline, notify, setText, hide, show, getPlotlyLayout, resizeVisiblePlots, positionNotifications } from '../../dashboard/js/utils.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/utils.test.js`
Expected: FAIL — `positionNotifications` not exported

- [ ] **Step 3: Implement `positionNotifications` in `dashboard/js/utils.js`**

```js
// ===== NOTIFICATION POSITIONING =====
export const positionNotifications = () => {
    const header = document.querySelector('.dashboard-header');
    const container = document.getElementById('notifications');
    if (!header || !container) return;

    const bottom = header.getBoundingClientRect().bottom;
    container.style.top = `${Math.round(bottom) + 12}px`;
    container.style.bottom = '';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/utils.test.js`
Expected: PASS

- [ ] **Step 5: Update `.notification-container` CSS to a `top`-based default (`dashboard/styles/main.css:1331-1340`)**

```css
        /* ===== NOTIFICATIONS ===== */
        .notification-container {
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 1001;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
```

(The `80px` is a fallback for the instant before JS runs; `positionNotifications()` overrides it with the header's real height immediately on load.)

- [ ] **Step 6: Wire `positionNotifications` into `main.js`**

Update the import (`main.js:1`):

```js
import { fmtNum, notify, resizeVisiblePlots, positionNotifications } from './utils.js';
```

Call it in `init()` (after the theme/particles setup, before `refreshData()`):

```js
    // Position notifications below the header
    positionNotifications();
    window.addEventListener('resize', positionNotifications);
```

- [ ] **Step 7: Remove the redundant "Data refreshed" toast (`dashboard/js/api.js:59`)**

```js
export const refreshData = async () => {
    let tokens;

    try {
        tokens = await fetchTokens();
        updateData(tokens);
    } catch (err) {
        notify('Refresh failed: ' + err.message, 'error');
        return;
    }

    try {
        const historical = await fetchHistorical();

        // Use historical data for chart if available
        if (historical && historical.length > 0) {
            setFileHistoricalData(historical);
            // Convert to historyData format for live chart
            const chartData = historical.map(h => ({
                time: h.time,
                total: h.total || 0,
                total_input: h.input || 0,
                total_output: h.output || 0,
                total_cache_read: h.cache_read || 0,
                models: h.tokens_by_model || {}
            }));
            setHistoryData(chartData);
            saveCache(tokens);

            if (typeof window !== 'undefined' && window.renderAll) {
                window.renderAll();
            }
        }
    } catch (err) {
        console.warn('Historical refresh failed:', err.message);
    }
};
```

(The header's `#last-update` timestamp already communicates a successful refresh — this was the toast Fable flagged as redundant. The error and milestone toasts are untouched.)

- [ ] **Step 8: Check `tests/unit/api.test.js` for a now-obsolete assertion**

Run: `rg -n "Data refreshed" tests/unit/api.test.js`
If it finds an assertion expecting that `notify` call, update or remove it to match the new behavior (no success toast on refresh). If it finds nothing, skip this step.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Manually verify in the browser**

Run: `npm run dev`, trigger a milestone toast or an error toast (or temporarily lower a threshold to force one), and confirm it appears just below the header — not overlapping the Live Token Flow chart — on both desktop and a narrow (mobile-width) viewport.

- [ ] **Step 11: Commit**

```bash
git add dashboard/js/utils.js dashboard/js/main.js dashboard/js/api.js dashboard/styles/main.css tests/unit/utils.test.js tests/unit/api.test.js
git commit -m "fix(dashboard): reposition toasts below the header and drop the redundant refresh toast"
```

---

## Task 7: Background particles — commit to the ember motif + `prefers-reduced-motion`

**Files:**
- Modify: `dashboard/styles/main.css:1886-1922` (`.particles-container`, `.particle`, `@keyframes float`)

**Interfaces:**
- None — CSS-only, no exported functions change.

- [ ] **Step 1: Raise particle visibility and add the reduced-motion guard**

Replace `dashboard/styles/main.css:1886-1922`:

```css
        /* Ambient background embers */
        .particles-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: -1;
            overflow: hidden;
        }

        .particle {
            position: absolute;
            width: 4px;
            height: 4px;
            background: var(--mono-accent);
            border-radius: 50%;
            opacity: 0.35;
            box-shadow: 0 0 6px 1px var(--mono-accent);
            animation: float 20s infinite linear;
        }

        @keyframes float {
            0% {
                transform: translateY(100vh) translateX(0);
                opacity: 0;
            }
            10% {
                opacity: 0.35;
            }
            90% {
                opacity: 0.35;
            }
            100% {
                transform: translateY(-100px) translateX(100px);
                opacity: 0;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .particle {
                animation: none;
                opacity: 0.2;
            }
        }
```

(Opacity raised from `0.1` to `0.35` and a soft amber glow added so the dots read as intentional embers rather than dead pixels, per the "keep it, but commit to it" direction. Motion is fully disabled under `prefers-reduced-motion`, leaving a faint static glow instead.)

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, open the dashboard, and confirm the particles are clearly visible (small glowing embers drifting upward) without being distracting. Then, in your OS/browser accessibility settings, enable "reduce motion" (or use browser devtools' rendering panel to emulate `prefers-reduced-motion: reduce`) and confirm the particles stop animating but remain faintly visible rather than disappearing entirely.

- [ ] **Step 3: Commit**

```bash
git add dashboard/styles/main.css
git commit -m "fix(dashboard): commit to the ember particle motif and gate motion behind prefers-reduced-motion"
```

---

## Task 8: Pills active-fill — range selector + sort controls

**Files:**
- Modify: `dashboard/styles/main.css:481-500` (`.range-selector button.active`), `:456-478` (`.sort-controls button`)
- Modify: `dashboard/index.html:108-112` (sort buttons — add `data-col`)
- Modify: `dashboard/js/views/analytics.js` (`sortBy`)

**Interfaces:**
- Consumes: `sortCol` / `sortAsc` from `dashboard/js/state.js` (already imported in `analytics.js:3`) — no signature changes.

- [ ] **Step 1: Give the range-selector's active pill the same fill the tabs use (`main.css:496-500`)**

```css
        .range-selector button:hover,
        .range-selector button.active {
            border-color: var(--mono-accent);
            background: var(--mono-accent);
            color: var(--mono-bg);
        }
        .range-selector button:hover:not(.active) {
            background: transparent;
            color: var(--mono-accent);
        }
```

- [ ] **Step 2: Add an active-state rule for sort-controls buttons (`main.css:465-478`)**

```css
        .sort-controls button {
            padding: 4px 8px;
            border: 1px solid var(--mono-border);
            background: var(--mono-surface);
            color: var(--mono-text-muted);
            font-family: inherit;
            font-size: 0.75rem;
            cursor: pointer;
            border-radius: 4px;
        }
        .sort-controls button:hover {
            border-color: var(--mono-accent);
            color: var(--mono-text);
        }
        .sort-controls button.active {
            border-color: var(--mono-accent);
            background: var(--mono-accent);
            color: var(--mono-bg);
        }
```

- [ ] **Step 3: Add `data-col` to the sort buttons (`dashboard/index.html:108-112`)**

```html
                    <div class="sort-controls">
                        <span>Sort by:</span>
                        <button data-col="tokens" onclick="sortBy('tokens')">Tokens</button>
                        <button data-col="cost" onclick="sortBy('cost')">Cost</button>
                        <button data-col="cache" onclick="sortBy('cache')">Cache</button>
                    </div>
```

- [ ] **Step 4: Toggle `.active` in `sortBy` (`dashboard/js/views/analytics.js:794-802`)**

```js
export const sortBy = (col) => {
    if (sortCol === col) {
        setSortAsc(!sortAsc);
    } else {
        setSortCol(col);
        setSortAsc(false);
    }
    document.querySelectorAll('.sort-controls button').forEach((el) => {
        el.classList.toggle('active', el.dataset.col === col);
    });
    renderAnalytics(true);
};
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open Analytics → Models, click each of the 3 sort buttons and confirm the clicked one gets the amber fill (matching the main nav's active-tab look) and the others don't. Switch to the Timeline tab and click each range pill (1h/24h/7d/30d/All), confirming the same fill behavior there.

- [ ] **Step 6: Commit**

```bash
git add dashboard/styles/main.css dashboard/index.html dashboard/js/views/analytics.js
git commit -m "fix(dashboard): give range and sort pills the same active-fill style as tabs"
```

---

## Task 9: Native select styling + mobile header row collapse

**Files:**
- Modify: `dashboard/styles/main.css:2905-2914` (`.heatmap-controls select`), `:1544-1549` (`.dashboard-header__right` mobile override), `:95-101` (`.theme-toggle`, mobile-only margin fix)

**Interfaces:**
- None — CSS-only.

- [ ] **Step 1: Style the heatmap `<select>` with `appearance: none` and a custom chevron (`main.css:2905-2914`)**

```css
        .heatmap-controls select {
            padding: 10px 36px 10px 16px;
            background: var(--mono-surface);
            border: 1px solid var(--mono-border);
            border-radius: 8px;
            color: var(--mono-text);
            font-family: inherit;
            font-size: 0.9rem;
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%23fbbf24' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 14px center;
            background-size: 12px 8px;
        }

        [data-theme="light"] .heatmap-controls select {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%23d97706' d='M1 1l5 5 5-5'/%3E%3C/svg%3E");
        }
```

(The chevron's fill color is a data-URI SVG, so it can't reference the `--mono-accent` custom property directly — it's hardcoded to each theme's accent hex, matched with a `[data-theme="light"]` override, same pattern the rest of the stylesheet already uses for the two theme blocks.)

- [ ] **Step 2: Collapse the mobile header to a single status row (`main.css:1544-1549`)**

```css
            .dashboard-header__right {
                flex-direction: row;
                justify-content: flex-start;
                align-items: center;
                gap: 12px;
                width: 100%;
            }
```

- [ ] **Step 3: Remove the desktop-only vertical offset from the toggle on mobile (`main.css`, inside the same `@media (max-width: 768px)` block from Step 2, right after it)**

```css
            .theme-toggle {
                margin-bottom: 0;
            }
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, open devtools' device toolbar at a mobile width (e.g. 375px), and confirm: (a) the Heatmaps tab's "Hourly Patterns" select shows a custom amber chevron instead of native OS chrome, in both dark and light theme, and (b) the header's theme-toggle, LIVE chip, and clock now sit on one row ("toggle · LIVE · time") instead of the toggle appearing alone above the other two.

- [ ] **Step 5: Commit**

```bash
git add dashboard/styles/main.css
git commit -m "fix(dashboard): style the heatmap select control and collapse the mobile header status row"
```

---

## Self-Review

**Spec coverage** (against `.superpowers/specs/2026-07-21-fable-design-aesthetic-review-findings.md`'s aesthetic-pass findings 1, 3, 4, 5, 6, 8 — findings 2 and 7 are explicitly excluded, see Global Constraints):

- Finding 1 (emoji) → Tasks 1–3.
- Finding 3 (Plotly resize) → Task 4.
- Finding 4 (Timeline default range) → Task 5.
- Finding 5 (toast placement + redundancy) → Task 6.
- Finding 6 (particles) → Task 7.
- Finding 8 (pills, native select, mobile header) → Tasks 8–9. (Finding 8's 4th bullet, the heatmap legend/gradient ramp mismatch, is **not** covered — it wasn't part of the "quick wins" scope discussed with the user; flag as a follow-up if wanted.)

**Placeholder scan:** no TBD/TODO, every step has concrete code or a concrete manual-check description; no step says "similar to Task N" without repeating the code.

**Type consistency:** `resizeVisiblePlots()`, `positionNotifications()`, and `resolveAvailableRange(sourceData, requestedRange)` are each defined once (Tasks 4/6/5) and referenced with matching names and signatures everywhere else they're used (Task 4's `main.js` import, Task 6's `main.js` import, Task 5's `renderTimelineTab`).

## Execution Handoff

Plan complete and saved to `.superpowers/plans/2026-07-21-aesthetic-pass-fixes.md`. Three execution options:

1. **Subagent-Driven (recommended)** - fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
3. **Delegate to opencode** - same fresh-task-per-review loop as Subagent-Driven, but each task's implementer runs via the `opencode` CLI at zero session token cost per task.

Which approach?
