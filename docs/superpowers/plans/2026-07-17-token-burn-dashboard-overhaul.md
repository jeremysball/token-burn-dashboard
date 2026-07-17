# Token Burn Dashboard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix math correctness (pricing regex, time normalization, reasoning totals, cache 0.1x arbitrary, cost heatmap $2/M), unify provider parsing first-slash, fix UI overflows (scale 17B, heatmap dates, daily/model overflow, mobile subnav), add cost/token heatmap metric toggle, redesign spike detective wall of text, add engineering ROI KPIs (LOC vs tokens, cost/commit, session file refs) while keeping token burn main, and harden security (shell injection, XSS, path traversal).

**Architecture:** Node HTTP server + cache poller + API routes + vanilla JS dashboard. Unify provider parsing via shared `parseModelKey` returning `{routingProvider, vendor, modelId, canonical, originalKey}` with first-slash semantics, canonical=`vendor/modelId` if vendor else `modelId`. Centralize pricing source of truth via `pricing.json` build or parity test between `lib/pricing.js` and `dashboard/js/config.js`. Fix `normalizeTimeMs` to distinguish seconds (<1e10) vs ms, include reasoning in all totals (`total = input+output+cache_read+cache_write+reasoning`), replace deep insights arbitrary 0.1x with real pricing ratio, replace cost heatmap hardcoded $2/M with per-bucket `calculateCost`. Split 1709-line analytics.js into `tabs/` modules progressively, combine UI overflow CSS (scale, heatmap, mobile) into single batch to avoid conflicts, add metric toggle (tokens|cost) orthogonal to dimension (hourly/daily/model). Spike detective redesign to cards + collapsible details + source pills. Engineering ROI limited to insights extension (no new main nav) with disclaimer heuristic. Security hardening moved early (spawnSync, hash validation, HTML escaping, path guard). Add Playwright overflow scan with tolerance 0 for critical selectors.

**Tech Stack:** Node.js CommonJS, ESM dashboard/js, Plotly 2.35.2, Jest, Playwright, SQLite3 via spawnSync, JetBrains Mono, CSS custom properties, SSE.

## Global Constraints
- `npm run lint` clean and `npm test` pass per task.
- Server port 7071, dashboard static `dashboard/`.
- `fmtNum` supports B, `fmtMultiple` comma grouping like `64,827×`.
- Provider parsing first-slash: `openrouter/tencent/hy3:free` => routing=openrouter vendor=tencent modelId=hy3:free canonical=tencent/hy3:free.
- Pricing badge (OpenRouter/Local) distinct from provider badge (anthropic/openai).
- `/workspace/openclaw-files` NOT included (0 JSONL, only docs) – document, allow via `EXTRA_SESSION_DIRS`.
- Cost heatmap must use real pricing, not $0.000002.
- Scale `17.02B` short with full `title=fmtInt`, multiples comma grouped, CSS ellipsis `clamp()`.
- Heatmap x-labels show actual dates, not indexes.
- Mobile subnav wrap 33% grid, not hidden scrollbar only.
- Spike cards with ratio badges, collapsible sessions.
- Engineering file refs allowlist `/workspace` + `.js|.ts|.py` etc.

---

### Task 0: Security hardening early (path traversal, hash validation, shell injection, XSS prep)

**Files:**
- Modify: `lib/opencode-discovery.js:26-46`
- Modify: `lib/git-blame.js` hash validation + execFileSync
- Modify: `lib/routes/static.js` traversal guard
- Modify: `lib/config.js` add constants
- Test: `tests/unit/lib/security.test.js`

**Interfaces:**
- Produces: queryJsonSafe via spawnSync, isValidCommitHash, safeStaticPath

- [ ] **Step 1: Write failing test for traversal and hash injection**

```js
const { isValidCommitHash } = require('../../lib/git-blame');
test('reject malicious hash', () => {
  expect(isValidCommitHash('HEAD; rm -rf /')).toBe(false);
  expect(isValidCommitHash('abc1234')).toBe(true);
});
test('path traversal blocked', () => {
  const path = require('path');
  const root = '/workspace/dashboard';
  const bad = path.resolve('/workspace/dashboard/../etc/passwd');
  expect(bad.startsWith(root)).toBe(false);
});
```

- [ ] **Step 2: Fix opencode-discovery to spawnSync**

```js
const { spawnSync } = require('child_process');
function queryJsonSafe(sql, timeoutMs=15000){
  if (!dbExists()) return [];
  const res = spawnSync('sqlite3',['-readonly','-json', OPENCODE_DB_PATH], {input: sql, encoding:'utf-8', timeout: timeoutMs, maxBuffer: 50*1024*1024});
  if (res.error) { console.error(res.error.message); return []; }
  if (!res.stdout?.trim()) return [];
  try { return JSON.parse(res.stdout); } catch { return []; }
}
```

- [ ] **Step 3: Fix git-blame hash validation + execFileSync**

```js
const { execFileSync } = require('child_process');
function isValidCommitHash(h){ return /^[0-9a-f]{7,40}$/i.test(h); }
function getCommitFiles(hash,cwd){
  if (!isValidCommitHash(hash)) throw new Error('Invalid commit hash');
  return execFileSync('git',['show','--name-only','--pretty=format:',''+hash],{cwd, encoding:'utf-8'});
}
```

- [ ] **Step 4: Static path guard**

```js
const resolved = path.resolve(path.join(rootDir, decodeURIComponent(urlPath)));
if (!resolved.startsWith(path.resolve(rootDir))) { res.writeHead(403); res.end('Forbidden'); return; }
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/lib/security.test.js && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add lib/opencode-discovery.js lib/git-blame.js lib/routes/static.js lib/config.js tests/unit/lib/security.test.js
git commit -m "fix(security): spawnSync sqlite, validate commit hash, guard path traversal"
```

---

### Task 1: Unify formatters, model key parser, sparkline and pricing wrapper DRY

**Files:**
- Modify: `dashboard/js/utils.js`
- Modify: `dashboard/js/main.js:10-60`
- Modify: `dashboard/js/config.js:133-150`
- Modify: `dashboard/js/views/dashboard.js:303-335` createTopModelCard
- Modify: `lib/pricing.js:81-84`
- Test: `tests/unit/utils.test.js`

**Interfaces:**
- Produces: `splitModelKey`, `displayModel`, `parseModelKey`, `fmtNum` B, `fmtMultiple`, `getPricingForModel`, `formatModelPrice`, unified `createSparkline`

- [ ] **Step 1: Write failing tests**

```js
import { fmtNum, splitModelKey, displayModel, parseModelKey, fmtMultiple } from '../../dashboard/js/utils.js';
test('fmtNum billions', () => {
  expect(fmtNum(17021653100)).toBe('17.02B');
  expect(fmtNum(1000000000)).toBe('1.00B');
});
test('splitModelKey first-slash preserves vendor', () => {
  expect(splitModelKey('openrouter/tencent/hy3:free')).toEqual({provider:'openrouter', model:'tencent/hy3:free'});
  expect(splitModelKey('anthropic/claude-sonnet-5')).toEqual({provider:'anthropic', model:'claude-sonnet-5'});
  expect(splitModelKey('gpt-4o')).toEqual({provider:'', model:'gpt-4o'});
});
test('parseModelKey canonical', () => {
  const r1 = parseModelKey('openrouter/tencent/hy3:free');
  expect(r1.routingProvider).toBe('openrouter');
  expect(r1.vendor).toBe('tencent');
  expect(r1.modelId).toBe('hy3:free');
  expect(r1.canonical).toBe('tencent/hy3:free');
  const r2 = parseModelKey('anthropic/claude-sonnet-5');
  expect(r2.routingProvider).toBeNull();
  expect(r2.vendor).toBe('anthropic');
  expect(r2.canonical).toBe('anthropic/claude-sonnet-5'); // vendor/modelId
  const r3 = parseModelKey('openrouter/claude-3-haiku');
  expect(r3.vendor).toBe('');
  expect(r3.canonical).toBe('claude-3-haiku');
});
test('fmtMultiple comma grouping', () => {
  expect(fmtMultiple(64827)).toBe('64,827×');
  expect(fmtMultiple(9.5)).toBe('9.5×');
});
```

- [ ] **Step 2: Run fail**

Run: `npm test -- tests/unit/utils.test.js`

- [ ] **Step 3: Implement utils.js**

```js
export const fmtNum = n => {
  if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(2)+'B';
  if (n >= 1_000_000) return (n/1_000_000).toFixed(2)+'M';
  if (n >= 1_000) return (n/1_000).toFixed(1)+'k';
  return Math.round(n).toString();
};
export const fmtInt = n => Number(n||0).toLocaleString();
export const fmtMultiple = n => {
  if (n < 10) return n.toFixed(1)+'×';
  return Math.floor(n).toLocaleString()+'×';
};
export const splitModelKey = (key) => {
  const str = String(key||'');
  const idx = str.indexOf('/');
  if (idx===-1) return {provider:'', model:str};
  return {provider: str.slice(0, idx), model: str.slice(idx+1)};
};
export const displayModel = (key) => {
  const {provider, model} = splitModelKey(key);
  return provider ? `${provider}/${model}` : model;
};
export const parseModelKey = (key) => {
  const routers = new Set(['openrouter','openpipe']);
  const {provider, model} = splitModelKey(key);
  let routingProvider = null;
  let vendor = provider;
  let modelId = model;
  let canonical;
  if (routers.has(provider)) {
    routingProvider = provider;
    const secondIdx = model.indexOf('/');
    if (secondIdx!==-1) {
      vendor = model.slice(0, secondIdx);
      modelId = model.slice(secondIdx+1);
      canonical = model;
    } else {
      vendor = '';
      modelId = model;
      canonical = model;
    }
  } else {
    canonical = provider ? `${provider}/${model}` : model;
  }
  return {routingProvider, vendor, modelId, canonical, originalKey:key, provider, model};
};
// Unified sparkline
export const createSparkline = (data, width=100, height=30, opts={gradient:false}) => {
  if (!data || data.length<2) return '';
  const max = Math.max(...data,1);
  const points = data.map((v,i)=>{
    const x = (i/(data.length-1))*width;
    const y = height - (v/max)*height*0.8 - height*0.1;
    return `${x},${y}`;
  }).join(' ');
  if (opts.gradient) {
    const gid = 'spark'+Math.random().toString(36).slice(2,7);
    return `<svg width="${width}" height="${height}" class="sparkline"><defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:var(--mono-accent);stop-opacity:0.3"/><stop offset="100%" style="stop-color:var(--mono-accent);stop-opacity:0"/></linearGradient></defs><polygon points="0,${height} ${points} ${width},${height}" fill="url(#${gid})"/><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg width="${width}" height="${height}" style="opacity:0.7"><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
export const getPricingForModel = (name, pricing_by_model) => {
  if (pricing_by_model && pricing_by_model[name]) return pricing_by_model[name];
  // dynamic import? fallback to local config getPricing
  return null; // to be filled by config.js wrapper
};
export const formatModelPrice = (pricing) => {
  if (!pricing) return 'Price unavailable';
  return `${(pricing.input||0).toFixed(2)} in / ${(pricing.output||0).toFixed(2)} out`;
};
export const escapeHtml = (text) => {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};
```

- [ ] **Step 4: Fix main.js animateNumber to use fmtNum fully**

```js
const animate = (currentTime) => {
  const elapsed = currentTime - startTime;
  const progress = Math.min(elapsed/duration,1);
  const easeOut = 1 - Math.pow(1-progress,3);
  const current = startNum + (endNum-startNum)*easeOut;
  element.textContent = prefix + fmtNum(current) + suffix;
  if (progress<1) requestAnimationFrame(animate);
  else { element.classList.remove('ticking'); element.textContent = prefix + fmtNum(endValue) + suffix; }
};
```

- [ ] **Step 5: Fix lib/pricing.js strip first-slash**

```js
function stripProviderPrefix(modelName){
  const name = normalizeModelName(modelName);
  const idx = name.indexOf('/');
  return idx===-1 ? name : name.slice(idx+1);
}
```

- [ ] **Step 6: Centralize getPricingForModel in config.js**

```js
// dashboard/js/config.js
import { splitModelKey } from './utils.js';
export const getPricingForModelWrapper = (name, pricing_by_model) => {
  return pricing_by_model?.[name] || getPricing(name);
};
```

- [ ] **Step 7: Run tests pass**

Run: `npm test -- tests/unit/utils.test.js && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add dashboard/js/utils.js dashboard/js/main.js dashboard/js/config.js dashboard/js/views/dashboard.js lib/pricing.js tests/unit/utils.test.js
git commit -m "fix(dashboard): unify fmtNum B, parseModelKey canonical, sparkline DRY, fmtMultiple commas"
```

---

### Task 2: Fix pricing regex breadth anchored

**Files:**
- Modify: `lib/pricing.js:12-75`
- Test: `tests/unit/server-pricing.test.js`

**Interfaces:**
- Produces: MODEL_PRICING anchored patterns

- [ ] **Step 1: Write failing tests for broad matches**

```js
const { findLocalPricing } = require('../../lib/pricing');
test('embed-m3 should not match minimax-m3', () => {
  const p = findLocalPricing('task-embed-m3-model');
  // should fallback to default 2.5/10, not minimax 0.5/2
  expect(p.input).toBe(2.5);
});
test('minimax-m3 matches', () => {
  const p = findLocalPricing('opencode-go/minimax-m3');
  expect(p.input).toBe(0.5);
});
test('k2 broad', () => {
  const p = findLocalPricing('task2');
  expect(p.input).toBe(2.5); // fallback
});
```

- [ ] **Step 2: Run fail**

Run: `npm test -- tests/unit/server-pricing.test.js`

- [ ] **Step 3: Fix regex anchored**

```js
// Replace /minimax-m3|m3/i with anchored
{ pattern: /(?:^|\/)minimax-m3(?:$|[-:])/i, input:0.5, output:2, cacheRead:0.1, cacheWrite:0 },
// Replace k2 patterns
{ pattern: /kimi-k2\.6|k2\.6/i, ... },
{ pattern: /kimi-k2\.5|k2p5|k2\.5/i, ... },
{ pattern: /(?:^|\/)kimi-k2(?:$|[-:.])|\/k2(?:$|[-.:])/i, input:1.5, output:6, cacheRead:0.375, cacheWrite:1.875 },
// Remove bare /k2/i, /m3/i, /o1/i broad
{ pattern: /\bo1-mini\b/i, input:1.1, output:4.4, cacheRead:0.55 },
{ pattern: /\bo3-mini\b/i, input:1.1, output:4.4, cacheRead:0.55 },
{ pattern: /\bo1\b/i, input:15, output:60, cacheRead:7.5 }, // only word boundary version, no /o1/ superset
```

- [ ] **Step 4: Fix mergePricing null fallback**

```js
// In lib/openrouter.js convert null cache fields to undefined
function normalizeOpenRouterRecord(rec){
  return {
    input: rec.input ?? rec.prompt ?? undefined,
    output: rec.output ?? rec.completion ?? undefined,
    cacheRead: rec.cache_read ?? rec.cached ?? undefined,
    cacheWrite: rec.cache_write ?? undefined,
    ...
  };
}
```

- [ ] **Step 5: Tests pass**

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add lib/pricing.js lib/openrouter.js tests/unit/server-pricing.test.js
git commit -m "fix(pricing): anchor m3/k2/o1 regex, null fallback"
```

---

### Task 3: Fix historical time normalization, token totals including reasoning, cache efficiency arbitrary

**Files:**
- Modify: `lib/historical-data.js:20-35`
- Modify: `lib/token-burn.js:133-170,50-70`
- Modify: `lib/session-parser.js:28-80` parsePiUsage parseClaudeUsage
- Modify: `dashboard/js/views/analytics.js:424-490` cache efficiency insight
- Test: `tests/unit/lib/historical.test.js`, `tests/unit/lib/session-parser.test.js`

**Interfaces:**
- Produces: normalizeTimeMs seconds vs ms correct, total includes reasoning

- [ ] **Step 1: Write failing tests**

```js
test('normalizeTimeMs 999999999999 stays ms', () => {
  const { normalizeTimeMs } = require('../../lib/historical-data'); // export it
  expect(normalizeTimeMs(999999999999)).toBe(999999999999);
  expect(normalizeTimeMs(1700000000)).toBe(1700000000000);
  expect(normalizeTimeMs(1700000000000)).toBe(1700000000000);
});
test('parsePiUsage includes reasoning', () => {
  const { parsePiUsage } = require('../../lib/session-parser');
  const u = parsePiUsage({input:1, output:1, reasoning:5, totalTokens:0});
  expect(u.total).toBe(7);
  expect(u.reasoning).toBe(5);
});
```

- [ ] **Step 2: Fix normalizeTimeMs**

```js
function normalizeTimeMs(time){
  if (typeof time!=='number' || isNaN(time)) return null;
  if (time < 1e10 && time > 1e9) return time*1000;
  return time;
}
module.exports.normalizeTimeMs = normalizeTimeMs;
```

- [ ] **Step 3: Fix parsePiUsage and parseClaudeUsage to include reasoning**

```js
function parseClaudeUsage(usage){
  const input = usage.input_tokens||0;
  const output = usage.output_tokens||0;
  const cacheRead = usage.cache_read_input_tokens||0;
  let cacheWrite = usage.cache_creation_input_tokens||0;
  if (!cacheWrite && usage.cache_creation) cacheWrite = (usage.cache_creation.ephemeral_5m_input_tokens||0)+(usage.cache_creation.ephemeral_1h_input_tokens||0);
  const reasoning = usage.reasoning_tokens|| usage.reasoning||0;
  const total = usage.totalTokens || (input+output+cacheRead+cacheWrite+reasoning);
  return {input, output, cacheRead, cacheWrite, reasoning, total};
}
function parsePiUsage(usage){
  const input = usage.input||usage.inputTokens||0;
  const output = usage.output||usage.outputTokens||0;
  const cacheRead = usage.cacheRead||0;
  const cacheWrite = usage.cacheWrite||0;
  const reasoning = usage.reasoning||usage.reasoning_tokens||0;
  const total = usage.totalTokens ?? usage.total ?? (input+output+cacheRead+cacheWrite+reasoning);
  return {input, output, cacheRead, cacheWrite, reasoning, total};
}
```

- [ ] **Step 4: Fix token-burn totals include reasoning**

```js
// In getOpenCodeSessions, total = input+output+cache_read+cache_write+(reasoning||0)
// In token-burn aggregation:
result.total_reasoning += s.reasoning||0;
result.total_tokens += s.input + s.output + s.cache_read + s.cache_write + (s.reasoning||0);
// For pi/claude files: fileData already includes reasoning in total_tokens
// Ensure historical-data addToBucket adds reasoning
```

- [ ] **Step 5: Fix cache efficiency insight arbitrary 0.1x**

```js
// analytics.js cache efficiency
const pricing = getPricingForModel(topModel) || {input:3, output:15, cacheRead:0.3};
const cacheDiscountRatio = pricing.cacheRead && pricing.input ? pricing.cacheRead / pricing.input : 0.1;
const avgInputCostPerToken = totalInput>0 && total_cost?.input ? total_cost.input/totalInput : 0.000003;
const avgCacheReadCostPerToken = cacheDiscountRatio * avgInputCostPerToken;
```

- [ ] **Step 6: Tests pass**

Run: `npm test`

- [ ] **Step 7: Commit**

```bash
git add lib/historical-data.js lib/token-burn.js lib/session-parser.js dashboard/js/views/analytics.js tests/unit/lib/historical.test.js tests/unit/lib/session-parser.test.js
git commit -m "fix(history): correct sec/ms threshold, include reasoning, cache ratio real pricing"
```

---

### Task 4: Session discovery hardening + EXTRA_SESSION_DIRS + caching note

**Files:**
- Modify: `lib/session-discovery.js:13-175`
- Modify: `lib/config.js` add MAX_FILE_BYTES, CLAUDE_MAX_DEPTH
- Test: `tests/unit/lib/session-discovery.test.js`

**Interfaces:**
- Produces: findAllSessionFiles respects env, excludes deleted, realpath Map

- [ ] **Step 1: Write failing tests**

```js
test('excludes .deleted. jsonl', () => {
  // create temp files and ensure findPiJsonlFiles ignores
});
```

- [ ] **Step 2: Implement fixes**

```js
const os = require('os');
const MAX_FILE_BYTES = parseInt(process.env.MAX_SESSION_BYTES||'' )||100*1024*1024;
const CLAUDE_MAX_DEPTH = 4;
const PI_SESSION_BASES = [
  '/workspace/.pi/sessions',
  path.join(os.homedir(), '.pi/sessions'),
  '/workspace/.pi/agent/sessions',
  path.join(os.homedir(), '.pi/agent/sessions'),
  '/workspace/openclaw-sessions/',
].filter(Boolean);
const extra = (process.env.EXTRA_SESSION_DIRS||'').split(/[:,]/).map(s=>s.trim()).filter(Boolean);
PI_SESSION_BASES.push(...extra);

function findPiJsonlFiles(){
  const seenReal = new Set();
  // ...
  if (entry.name.includes('.deleted.')) continue;
  const stat = fs.statSync(fullPath);
  if (stat.size > MAX_FILE_BYTES) { console.warn(`Skipping large ${fullPath}`); continue; }
  const real = safeReal(fullPath);
  if (seenReal.has(real)) continue;
  seenReal.add(real);
}
```

- [ ] **Step 3: Document openclaw-files exclusion in README or comment**

```js
// NOTE: /workspace/openclaw-files contains docs/portfolio, 0 JSONL sessions, intentionally not included. Use EXTRA_SESSION_DIRS to add custom.
```

- [ ] **Step 4: Add caching note for future async**

```js
// TODO: Convert to async fs.promises with mtime cache to avoid blocking poller every 5m. For now sync is OK <10k files.
```

- [ ] **Step 5: Tests pass**

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add lib/session-discovery.js lib/config.js tests/unit/lib/session-discovery.test.js
git commit -m "fix(discovery): exclude deleted, EXTRA_SESSION_DIRS, homedir, document openclaw-files exclusion"
```

---

### Task 5: Provider parsing consistency + pricing source centralization

**Files:**
- Modify: `lib/session-parser.js:85-111`
- Modify: `lib/openrouter.js:31-50`
- Modify: `dashboard/js/config.js` parity test
- Test: `tests/unit/lib/session-parser.test.js`, `tests/unit/pricing-parity.test.js`

**Interfaces:**
- Produces: consistent first-slash, parity test ensures MODEL_PRICING length similar

- [ ] **Step 1: Write parity test**

```js
test('frontend and backend pricing parity', () => {
  const backend = require('../../lib/pricing').MODEL_PRICING.length;
  const frontend = require('../../dashboard/js/config.js').MODEL_PRICING?.length || 0;
  // allow +/- 10 difference but warn
  expect(Math.abs(backend-frontend)).toBeLessThan(15);
});
```

- [ ] **Step 2: Fix parser as in Task1, ensure openrouter uses first-slash**

- [ ] **Step 3: Commit**

```bash
git add lib/session-parser.js lib/openrouter.js dashboard/js/config.js tests/unit/lib/session-parser.test.js tests/unit/pricing-parity.test.js
git commit -m "fix(parser): first-slash consistent, pricing parity test"
```

---

### Task 6: CSS duplication audit – consolidate main vs design-v2

**Files:**
- Modify: `dashboard/styles/main.css`, `dashboard/styles/design-v2.css`
- Create: `dashboard/styles/README.md` documenting ownership
- Test: `npm run lint`

**Interfaces:**
- Produces: single source of truth for overlapping selectors

- [ ] **Step 1: Audit duplicate selectors via `rg -n "pricing-source-badge|top-model-name|scale-grid"`**

- [ ] **Step 2: Keep design-v2 as owner for badges, top-model, hero, scale, insights; delete overlapping definitions from main.css**

Example: in main.css remove `.pricing-source-badge`, `.top-model-name` duplicates, keep only base variables.

- [ ] **Step 3: Add comment in both files header: /* Owner: design-v2.css for badges/cards */**

- [ ] **Step 4: Commit**

```bash
git add dashboard/styles/main.css dashboard/styles/design-v2.css dashboard/styles/README.md
git commit -m "refactor(css): consolidate duplicate selectors, document ownership"
```

---

### Task 7: UI overflow & mobile batch (scale, heatmap, subnav)

**Files:**
- Modify: `dashboard/js/views/analytics.js:1290-1700` scale, heatmaps
- Modify: `dashboard/styles/main.css:1536-1710,2612-2740,2920-3080`
- Modify: `dashboard/styles/design-v2.css:1101-1144,1224-1229,421-455`

**Interfaces:**
- Consumes: fmtNum, fmtInt, fmtMultiple, displayModel, splitModelKey

- [ ] **Step 1: Fix scale page as described in original Task7**

```js
<span class="scale-number" title="${fmtInt(totalTokens)}">${fmtNum(totalTokens)}</span>
<span class="scale-multiple">${fmtMultiple(rawMultiple)}</span>
```

- [ ] **Step 2: Fix heatmap daily/model overflow and dates as original Task8**

```js
<span class="daily-heatmap-val" title="${fmtInt(val)}">${fmtNum(val)}</span>
<div class="heatmap-y-label" title="${model}">${splitModelKey(model).model}</div>
const xLabelDisplay = timeLabels.map(t=>{ const dt=new Date(t); return isNaN(dt)?t.slice(11,16):dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+dt.getHours()+':00'; });
```

- [ ] **Step 3: CSS overflow guards**

```css
.scale-number { font-size:clamp(1.8rem,5vw,3rem); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.heatmap-y-label { width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; flex-shrink:0; }
.daily-heatmap-cell { overflow:hidden; }
.daily-heatmap-val { font-size:0.7rem; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
.heatmap-wrapper { overflow-x:auto; -webkit-overflow-scrolling:touch; min-width:0; }
```

- [ ] **Step 4: Mobile subnav wrap 33%**

```css
@media (max-width:768px){
  .analytics-subnav { display:flex; flex-wrap:wrap; gap:6px; overflow-x:visible; padding:6px; }
  .analytics-subnav .subnav-btn { flex:1 1 calc(33% - 6px); min-width:90px; }
  .controls-bar { flex-direction:column; align-items:stretch; }
  .search-box { width:100%; min-width:auto; }
  .range-selector { width:100%; display:flex; overflow-x:auto; }
  .heatmap-controls { flex-direction:column; gap:8px; }
}
```

- [ ] **Step 5: Manual playwright check scale and heatmaps no overflow**

- [ ] **Step 6: Commit**

```bash
git add dashboard/js/views/analytics.js dashboard/styles/main.css dashboard/styles/design-v2.css
git commit -m "fix(ui): scale B short + comma multiples, heatmap dates, overflow ellipsis, mobile subnav wrap"
```

---

### Task 8: Heatmap cost/token metric toggle with real calculateCost

**Files:**
- Modify: `dashboard/index.html:288-297`
- Modify: `dashboard/js/views/analytics.js:1416-1692`
- Modify: `dashboard/styles/design-v2.css:948-960`

**Interfaces:**
- Consumes: getPricingForModel, calculateCost, currentData
- Produces: setHeatmapMetric, heatmapMetric state

- [ ] **Step 1: Add HTML controls**

```html
<div class="heatmap-controls">
  <select id="heatmap-type" onchange="updateHeatmap()"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="model">Model</option></select>
  <div class="heatmap-metric-toggle" id="heatmap-metric-toggle">
    <button data-metric="tokens" class="active" onclick="setHeatmapMetric('tokens')">Tokens</button>
    <button data-metric="cost" onclick="setHeatmapMetric('cost')">Cost</button>
  </div>
</div>
```

- [ ] **Step 2: Implement JS**

```js
let heatmapMetric = 'tokens';
export const setHeatmapMetric = (m) => {
  heatmapMetric = m;
  document.querySelectorAll('#heatmap-metric-toggle button').forEach(b=>b.classList.toggle('active', b.dataset.metric===m));
  renderHeatmapsTab();
};
const renderHeatmapsTab = () => {
  const type = document.getElementById('heatmap-type')?.value || 'hourly';
  const sourceData = fileHistoricalData.length>0 ? fileHistoricalData : historyData;
  switch(type){
    case 'hourly': renderHourlyHeatmap(container, sourceData, heatmapMetric); break;
    case 'daily': renderDailyHeatmap(container, sourceData, heatmapMetric); break;
    case 'model': renderModelHeatmap(container, sourceData, heatmapMetric); break;
  }
};
const renderHourlyHeatmap = (container, data, metric='tokens') => {
  const matrix = Array(7).fill(null).map(()=>Array(24).fill(0));
  const avgCostPerToken = (currentData.total_cost?.total||0)/(currentData.total_tokens||1)||0.000002;
  data.forEach(d=>{
    const date = new Date(d.time);
    const day = date.getDay();
    const hour = date.getHours();
    let value = d.total||0;
    if (metric==='cost') {
      if (d.tokens_by_model) {
        let cost=0;
        for (const [k,tok] of Object.entries(d.tokens_by_model)){
          const pricing = getPricingForModel(k, currentData.pricing_by_model);
          // use calculateCost if input/output available else avg
          const costPerTok = pricing ? (pricing.input+pricing.output)/2/1e6 : avgCostPerToken;
          cost += tok*costPerTok;
        }
        value = cost;
      } else {
        // use d.input/output if available
        if (d.input||d.output) {
          // approximate via calculateCost
          value = (d.input||0)*avgCostPerToken + (d.output||0)*avgCostPerToken*3;
        } else {
          value = d.total*avgCostPerToken;
        }
      }
    }
    matrix[day][hour]+=value;
  });
  // render with fmtNum for tokens, fmtCur for cost
};
```

- [ ] **Step 3: CSS pill toggle**

```css
.heatmap-metric-toggle { display:inline-flex; gap:2px; background:var(--mono-surface); border:1px solid var(--mono-border); border-radius:9999px; padding:3px; }
.heatmap-metric-toggle button { padding:6px 12px; border-radius:9999px; border:1px solid transparent; font-size:0.78rem; font-weight:600; }
.heatmap-metric-toggle button.active { background:var(--mono-accent); color:#000; }
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html dashboard/js/views/analytics.js dashboard/styles/design-v2.css
git commit -m "feat(heatmap): tokens/cost metric toggle with real pricing"
```

---

### Task 9: Spike detective redesign

**Files:**
- Modify: `dashboard/js/views/analytics.js:1113-1240`
- Modify: `dashboard/styles/main.css` spike styles
- Test: manual

**Interfaces:**
- Consumes: /api/spikes, fmtNum, displayModel

- [ ] **Step 1: Rewrite renderSpikesList to cards**

As in original Task11 – cards with ratio badges high/medium/low, zScore, mean/std.

- [ ] **Step 2: Rewrite renderInvestigation to collapsible details with source pills**

As in original Task11 – summary grid, source pills, details accordion.

- [ ] **Step 3: Add CSS**

```css
.spike-card { background:var(--mono-surface); border:1px solid var(--mono-border); border-radius:10px; padding:14px; cursor:pointer; }
.spike-ratio-badge.high { background:rgba(239,68,68,0.15); color:#ef4444; }
.session-accordion { background:var(--mono-bg); border:1px solid var(--mono-border); border-radius:8px; margin-bottom:8px; }
.preview-card { border-left:3px solid var(--mono-border); padding:8px 12px; }
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/js/views/analytics.js dashboard/styles/main.css
git commit -m "feat(spikes): redesign cards with badges, collapsible sessions"
```

---

### Task 10a: Engineering ROI – file refs extraction and LOC parsing (split from Task12)

**Files:**
- Create: `lib/engineering.js`
- Test: `tests/unit/lib/engineering.test.js`

**Interfaces:**
- Produces: extractFileRefs(text) allowlist, getFileExtensionLang, parseShortStat

- [ ] **Step 1: Write failing tests**

```js
const { extractFileRefs } = require('../../lib/engineering');
test('extract workspace file refs only', () => {
  const text = 'Edited /workspace/foo/bar.js and /usr/bin and /home/jeremy/baz.ts and https://example.com';
  const refs = extractFileRefs(text);
  expect(refs).toContain('/workspace/foo/bar.js');
  expect(refs).not.toContain('/usr/bin');
});
```

- [ ] **Step 2: Implement lib/engineering.js allowlist**

```js
function extractFileRefs(text){
  if (!text) return [];
  // Only allow paths starting with /workspace, ./, or containing known extensions
  const regex = /(?:\/workspace\/[\w\-\/.]+|(?:^|[\s(])\.{0,2}\/[\w\-\/.]+\.\w+)/g;
  const exts = ['.js','.ts','.py','.go','.rs','.java','.rb','.css','.html','.json','.md'];
  const matches = [];
  let m;
  const re = /(?:\/[\w\-.]+)+\.\w+/g;
  while ((m=re.exec(text))!==null){
    const p=m[0];
    if (p.startsWith('/workspace/') || exts.some(e=>p.endsWith(e))) {
      if (p.length>5 && p.length<200) matches.push(p);
    }
  }
  return [...new Set(matches)].slice(0,20);
}
function parseShortStat(t){ /* ... */ }
```

- [ ] **Step 3: Commit**

```bash
git add lib/engineering.js tests/unit/lib/engineering.test.js
git commit -m "feat(eng): extractFileRefs allowlist, shortstat parser"
```

---

### Task 10b: Engineering ROI – git LOC vs tokens

**Files:**
- Modify: `lib/git-blame.js` add LOC via shortstat
- Modify: `lib/engineering.js` parseShortStat integration
- Test: `tests/unit/lib/git-blame.test.js`

**Interfaces:**
- Produces: getCommitLOC, commit stats with loc

- [ ] **Step 1: Implement getCommitLOC using execFileSync with shortstat**

```js
function getCommitLOC(hash,cwd){
  try {
    const out = execFileSync('git',['show','--shortstat','--format=',''+hash],{cwd, encoding:'utf-8'});
    return parseShortStat(out);
  } catch { return {filesChanged:0, insertions:0, deletions:0, loc:0}; }
}
```

- [ ] **Step 2: Integrate into getGitBlameRouteData – add loc to each commit**

- [ ] **Step 3: Commit**

```bash
git add lib/git-blame.js lib/engineering.js tests/unit/lib/git-blame.test.js
git commit -m "feat(eng): commit LOC via shortstat for tokens/LOC KPI"
```

---

### Task 10c: Engineering ROI – KPI cards in insights (no new main nav)

**Files:**
- Modify: `dashboard/js/views/analytics.js:424-650` calculateDeepInsights
- Modify: `dashboard/index.html` add disclaimer badge in insights header
- Test: manual

**Interfaces:**
- Consumes: currentData, git blame cache, engineering helpers

- [ ] **Step 1: Add KPI cards**

```js
// 9. Engineering Efficiency – tokens per LOC changed
if (currentData.total_tokens && gitBlameCache) {
  const totalLOC = gitBlameCache.commits?.reduce((s,c)=>s+(c.loc?.loc||0),0) || currentData.total_lines||0;
  const tokPerLOC = totalLOC ? currentData.total_tokens/totalLOC : 0;
  insights.push({
    icon:'🛠️',
    title:'Eng Efficiency',
    value: tokPerLOC ? `${fmtNum(tokPerLOC)} tok/LOC` : 'n/a',
    description:'Tokens per line changed – lower is more efficient. Heuristic.',
    detail:`${fmtNum(currentData.total_tokens)} tokens / ${fmtNum(totalLOC)} LOC (git shortstat)`,
    type:'info'
  });
}
// 10. Cost per commit
if (gitBlameCache?.commits?.length && currentData.total_cost?.total) {
  const avg = currentData.total_cost.total / gitBlameCache.commits.length;
  insights.push({icon:'💸', title:'Cost / Commit', value:`$${avg.toFixed(2)}`, description:'Avg spend per commit (session->commit heuristic)', detail:`${gitBlameCache.commits.length} commits`, type:'neutral'});
}
```

- [ ] **Step 2: Add disclaimer in insights header**

```html
<div class="insights-header"><h3>🔮 Deep Analysis <span class="badge experimental" title="Heuristic best-effort">experimental</span></h3></div>
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/js/views/analytics.js dashboard/index.html
git commit -m "feat(eng): KPI cards tokens/LOC, cost/commit, experimental badge"
```

---

### Task 11: Modularize analytics.js into tabs/ modules

**Files:**
- Create: `dashboard/js/views/analytics/tabs/models.js`, `compare.js`, `timeline.js`, `calendar.js`, `distribution.js`, `insights.js`, `scale.js`, `code.js`, `heatmaps.js`, `git.js`, `spikes.js`
- Modify: `dashboard/js/views/analytics.js` becomes router

**Interfaces:**
- Produces: each tab exports render(container, data, deps)

- [ ] **Step 1: Create tabs directory and move renderModelsTab to models.js**

```js
// dashboard/js/views/analytics/tabs/models.js
import { fmtNum, fmtCur, splitModelKey } from '../../../utils.js';
export function renderModelsTab(tbody, data, deps) { /* original logic */ }
```

- [ ] **Step 2: Update analytics.js to import and delegate**

```js
import { renderModelsTab } from './tabs/models.js';
import { renderCompareTab } from './tabs/compare.js';
// ...
export const renderAnalytics = () => {
  const tab = document.querySelector('.subnav-btn.active')?.dataset.tab || 'models';
  switch(tab){ case 'models': renderModelsTab(...); break; ... }
};
```

- [ ] **Step 3: Gradually move – start with 2 tabs (models, scale) to prove pattern, then remaining in follow-up commits to avoid huge diff**

- [ ] **Step 4: Tests pass (no logic change)**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/views/analytics.js dashboard/js/views/analytics/tabs/
git commit -m "refactor(analytics): split monolith into tabs/ modules"
```

---

### Task 12: Tests + lint + cache bust + stylelint max-lines

**Files:**
- Modify: `tests/unit/utils.test.js`, `server-pricing.test.js`, etc
- Modify: `dashboard/index.html` bump ?v=11->12
- Modify: `eslint.config.mjs` add max-lines warning

**Interfaces:**
- Produces: clean lint, passing tests

- [ ] **Step 1: Bump cache bust**

```html
<link rel="stylesheet" href="/dashboard/styles/main.css?v=12">
<link rel="stylesheet" href="/dashboard/styles/design-v2.css?v=4">
<script type="module" src="/dashboard/js/main.js?v=12"></script>
```

- [ ] **Step 2: Run lint fix and tests**

Run: `npm run lint:fix && npm test`

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html eslint.config.mjs
git commit -m "chore: bump cache bust v12, add max-lines lint"
```

---

### Task 13: Playwright overflow scan + screenshots

**Files:**
- Create: `tests/playwright/overflow.spec.js`
- Modify: `package.json` add script

**Interfaces:**
- Consumes: server on 7071

- [ ] **Step 1: Write overflow detection with tolerance 0 for critical**

```js
const { test, expect } = require('@playwright/test');
test('no horizontal overflow critical selectors', async ({ page }) => {
  await page.goto('http://localhost:7071/');
  await page.waitForSelector('#hero-tokens');
  const critical = ['.scale-number','.daily-heatmap-val','.heatmap-y-label','.top-model-name','.mono-dashboard'];
  for (const sel of critical) {
    const overflows = await page.$$eval(sel, els => els.map(el=>({cls:el.className, scroll:el.scrollWidth, client:el.clientWidth, text:el.textContent?.slice(0,50)})));
    for (const o of overflows) {
      expect(o.scroll, `overflow ${o.cls} ${o.text}`).toBeLessThanOrEqual(o.client+2);
    }
  }
});
test('screenshots desktop+mobile', async ({ page }) => {
  await page.goto('http://localhost:7071/');
  await page.screenshot({path:'test-results/dashboard.png', fullPage:true});
  await page.setViewportSize({width:375, height:800});
  await page.screenshot({path:'test-results/mobile.png', fullPage:true});
});
```

- [ ] **Step 2: Run playwright**

Run: `npx playwright test tests/playwright/overflow.spec.js --reporter=list`

- [ ] **Step 3: If overflows found, loop back to Task7 fixes**

- [ ] **Step 4: Commit**

```bash
git add tests/playwright/overflow.spec.js package.json
git commit -m "test(e2e): overflow scan tolerance 0, screenshots"
```

---
**Plan complete and saved to `docs/superpowers/plans/2026-07-17-token-burn-dashboard-overhaul.md`. Three execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**3. Delegate to opencode** - Same fresh-task-per-review loop as Subagent-Driven, but each task's implementer runs via the `opencode` CLI instead of the Agent tool (e.g. `opencode run --model <provider>/<model>`), so the implementation happens outside this session at zero session token cost per task. Task review and ledger tracking work the same way.

**Which approach?**
