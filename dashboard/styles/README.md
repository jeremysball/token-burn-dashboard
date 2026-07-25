# Dashboard Styles — Selector Ownership

This directory contains two stylesheets. This document records which file owns
which selectors so duplicated definitions are not silently maintained in two
places.

## Loaded stylesheets

`dashboard/index.html` links, in order:

1. `main.css` (`?v=12`) — base variables and the styles not owned by design-v2.
2. `design-v2.css` (`?v=14`) — the v2 redesign, loaded after main.css so it wins
   the cascade for the selectors it owns.

## Ownership policy

| Selector group | Owner | Notes |
| --- | --- | --- |
| `:root` base variables and `[data-theme="light"]` | `main.css` (base) + `design-v2.css` (override) | Both files define `:root` and `[data-theme="light"]`. `main.css` (`dashboard/styles/main.css` lines 9 and 29) provides the base/fallback token set; `design-v2.css` (lines 13 and 56) is loaded afterward and intentionally overrides the theme tokens with a darker palette plus its own radius/shadow/source-color variables. **However, `design-v2.css` actually contains a second `:root` + `[data-theme="light"]` pair starting around line 1709 — see the "Second theme block" section below.** The first override is deliberate, not a stray duplicate — do not "consolidate" it or the live theme regresses. |
| `pricing-source-badge`, `.openrouter`, `.local` | `design-v2.css` | Base definitions removed from `main.css`. |
| `top-model-name` | `design-v2.css` | Base definition removed from `main.css`. |
| `top-model-header`, `.top-model-emoji`, `.top-model-value`, `.top-model-spark` | duplicated: `main.css` + `design-v2.css` (design-v2 wins per-property on load order) | These four selectors are defined in both files and were NOT cleaned up when the rest of the top-model consolidation happened. `main.css` defines them at lines 281, 288, 291, 296 (standalone rules in the `.top-model-card` group, not inside any `@media` block — the `.top-models-grid` responsive blocks end at line 271) and `design-v2.css` defines them at lines 451, 458, 528, 543. `design-v2.css` wins the cascade only for properties it actually redeclares; `main.css`'s `.top-model-header` also sets `flex-wrap: wrap`, which `design-v2.css` never sets, so that declaration is still live on the page. Not dead code — treat `main.css` as still contributing here, not just a stale leftover. |
| `hero-section`, `hero-stat`, `hero-stat.primary`, `hero-label`, `hero-value` | `design-v2.css` | Base definitions removed from `main.css`. `main.css` retains `hero-spark` / `hero-spark svg`, which are unique to it. |
| `insights-section`, `insights-section h2`, `insights-grid` | `design-v2.css` | Base and responsive definitions removed from `main.css`; design-v2.css owns the complete base and responsive insights grid. Also note `.hero-stat.burn-rate` is owned by design-v2.css (including its `display:flex`/`flex-direction:column` behavior). |
| `scale-hero`, `scale-grid` | `main.css` (layout, both selectors) + `design-v2.css` (border-radius polish, `.scale-hero` only) | `design-v2.css` only polishes `.scale-hero`'s border-radius (line 1699) — `.scale-grid` does not appear in `design-v2.css` at all. The full layout for both selectors is defined only in `main.css`, so this is NOT a duplicate. **Note: `design-v2.css` also re-overrides `.scale-hero` (and `.code-summary-grid`, `.code-breakdown`, `.heatmaps-container` — never `.scale-grid`) at line 1955 inside the second theme block — see below.** |
| Deep-insights tab: `.insights-header`, `.refresh-insights-btn` | `main.css` only | Defined only in `main.css` (lines 1883, 1912, and the hover/active rules around them). `design-v2.css` does not redefine these. Retained in main.css. |
| Deep-insights tab: `.deep-insights-grid`, `.insight-card--deep` | duplicated: `main.css` + `design-v2.css` (design-v2 wins per-property on load order) | Defined in **both** files. `main.css` defines `.deep-insights-grid` at line 1941 (`display: grid`, `grid-template-columns`, `margin-bottom`) and `.insight-card--deep` at lines 1948 and 1957 (including `animation: cardIn`). `design-v2.css` defines `.deep-insights-grid` at lines 820 (`gap` only) and 1563 (responsive column override), and `.insight-card--deep` at lines 824, 835, 845 (border/shadow/hover, no `animation`), plus an ambient-update suppression rule at line 1632. `design-v2.css` only wins the properties it redeclares — `main.css`'s `display: grid`, `grid-template-columns`, and `animation: cardIn` are never overridden and remain live. Not dead code. |

## Second theme block (Experimental-compute fieldbook)

`design-v2.css` contains **two** `:root` + `[data-theme="light"]` theme blocks, not one:

- **First block** — `:root` at line 13, `[data-theme="light"]` at line 56. This is the one the rest of this document refers to.
- **Second block** — comment `/* ===== Experimental-compute fieldbook ===== */` at line 1706, followed by a fresh `:root` at line 1709 and a fresh `[data-theme="light"]` at line 1737. This second block runs through roughly line 2075 (about 370 lines, ~40 rules) and ends just before the file's `@media` responsive overrides. It is a self-contained visual re-skin ("fieldbook" aesthetic — readings prominent, hard borders, ruled background) that intentionally overrides large parts of the first block.

The second block does three things that any newcomer editing the file must know about:

1. **Redefines the entire token palette** in its own `:root` / `[data-theme="light"]`. The `--mono-*` color tokens, `--radius-sm/md/lg`, `--shadow-sm/md/lg`, and several `--fieldbook-*` vars are all reset here. Any later overrides downstream of this block will pick up these values, not the values from the first block at the top of the file.
2. **Re-overrides many of the same selectors the first block owns**, including `.dashboard-header`, `.mono-title`, `.mono-subtitle`, `.main-nav`, `.nav-btn`, `.hero-section`, `.hero-stat`, `.hero-stat.primary`, `.hero-stat.burn-rate`, `.hero-label`, `.hero-value`, `.burn-rate-value`, `.burn-rate-badge`, `.chart-section`, `.top-model-card`, `.insight-card`, `.analytics-subnav`, `.subnav-btn`, `.analytics-content`, `.llm-insights-section`, `.git-section`, `.live-indicator`, `.real-time-badge`, `.theme-toggle`, `.last-update`, `.badge`, `.pricing-source-badge`, `.model-provider-badge`, `.top-models-section`, `.insights-section`, `.top-models-grid`, `.insights-grid`, and more. Roughly 55 distinct selectors are touched.
3. **Flips `.scale-hero`'s `border-radius` back to `0`** (line 1955), undoing the earlier `border-radius: var(--radius-lg)` it set at line 1699. Same for `.code-summary-grid`, `.code-breakdown`, and `.heatmaps-container` — all four are listed in *both* override blocks, with the second block's `border-radius: 0` winning because it comes later in source order.

**Editing guidance:** if you need to change the look of a selector that appears in *both* the first block and the fieldbook block, the fieldbook block wins. If you only want your change to apply to the fieldbook aesthetic, put it inside the second block (or below it). If you want it to apply everywhere, put it *below* both blocks. Do not assume the top of `design-v2.css` is authoritative — the file has a layered structure where the bottom section redoes much of what the top section set up. The fieldbook block is referenced internally as "the dashboard is a personal instrument: readings are prominent, while boundaries, labels, and accents explain how to read the evidence."

## Duplicated selectors (summary)

For quick reference, these selector groups are defined in BOTH `main.css` and
`design-v2.css`. Because `design-v2.css` is loaded after `main.css`, design-v2
wins the cascade in every case (for selectors with equal specificity).

1. `:root` and `[data-theme="light"]` — token palette overrides (and the second
   "fieldbook" `:root`/`[data-theme="light"]` is its own internal duplication
   within design-v2.css — see above).
2. `scale-hero` only (not `scale-grid`, which design-v2 never touches) — design-v2
   only adds a `border-radius` polish on top of the layout owned by main.css.
3. `top-model-header`, `top-model-emoji`, `top-model-value`, `top-model-spark`
   — partially duplicate; design-v2 wins per-property, but main.css's
   `flex-wrap: wrap` on `.top-model-header` is never overridden and stays live.
4. `deep-insights-grid`, `insight-card--deep` — partially duplicate; design-v2
   wins per-property, but main.css's base `display: grid`/`grid-template-columns`/
   `animation: cardIn` stay live outside two edge cases: design-v2 narrows
   `grid-template-columns` to `1fr` under `@media (max-width: 768px)`, and
   disables `animation: cardIn` via `.is-ambient-update .insight-card--deep`.
5. `real-time-badge` — defined twice in each file (main.css: 210, 1143;
   design-v2.css: 369, 1825, 2014); the later definition in each file mostly
   overrides the earlier one, and design-v2's later definitions win the
   cascade for color/background/border/padding since design-v2 loads last.
   Only `font-weight: 700` and `gap: 6px` from main.css's first block still
   contribute (both are also set the same way further down, so no visible
   difference, but the selector is genuinely still live, not dead).
6. `llm-insights-section` — partially duplicate; main.css's `margin-top: 24px`
   (line 2061) is never overridden by design-v2.css (line 895) and stays live.

## History

Originally both files defined the badge / top-model / hero / insights component
styles. Task 6 consolidated ownership: `design-v2.css` became the loaded owner for
those selectors and the duplicate base definitions were removed from `main.css`.
The migration guard that previously warned against deleting them (because
design-v2 was not yet linked) is now resolved — `design-v2.css` is linked in
`index.html`.

The `.top-model-header` / `.top-model-emoji` / `.top-model-value` /
`.top-model-spark` and `.deep-insights-grid` / `.insight-card--deep` duplicates
were missed during that consolidation and remain in `main.css`, still
contributing properties design-v2.css never redeclares (see the summary
above) — not dead code, despite being an unintentional leftover duplicate.
The "Experimental-compute fieldbook" second theme block was added later as an
internal re-skin of `design-v2.css` and is documented above.

## Header comments

Both `main.css` and `design-v2.css` carry an `Owner:` comment at the top of the
file stating this policy.