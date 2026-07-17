# Dashboard Styles — Selector Ownership

This directory contains two stylesheets. This document records which file owns
which selectors so duplicated definitions are not silently maintained in two
places.

## Loaded stylesheets

`dashboard/index.html` links, in order:

1. `main.css` (`?v=12`) — base variables and the styles not owned by design-v2.
2. `design-v2.css` (`?v=12`) — the v2 redesign, loaded after main.css so it wins
   the cascade for the selectors it owns.

## Ownership policy

| Selector group | Owner | Notes |
| --- | --- | --- |
| `:root` base variables and `[data-theme="light"]` | `main.css` (base) + `design-v2.css` (override) | Both files define `:root` and `[data-theme="light"]`. `main.css` provides the base/fallback token set; `design-v2.css` is loaded afterward and intentionally overrides the theme tokens with a darker palette plus its own radius/shadow/source-color variables. This override is deliberate, not a stray duplicate — do not "consolidate" it or the live theme regresses. |
| `pricing-source-badge`, `.openrouter`, `.local` | `design-v2.css` | Base definitions removed from `main.css`. |
| `top-model-name` | `design-v2.css` | Base definition removed from `main.css`. |
| `hero-section`, `hero-stat`, `hero-stat.primary`, `hero-label`, `hero-value` | `design-v2.css` | Base definitions removed from `main.css`. `main.css` retains `hero-spark` / `hero-spark svg`, which are unique to it. |
| `insights-section`, `insights-section h2`, `insights-grid` | `design-v2.css` | Base definitions removed from `main.css`. `main.css` keeps its responsive `@media` overrides for `.insights-grid`. |
| `scale-hero`, `scale-grid` | `main.css` (layout) + `design-v2.css` (border-radius polish) | `design-v2.css` only polishes border-radius; the full layout is defined only in `main.css`, so it is NOT a duplicate and stays in `main.css`. |
| Deep-insights tab (`.insights-header`, `.refresh-insights-btn`, `.deep-insights-grid`, `.insight-card--deep`, etc.) | `main.css` | Not defined in design-v2; retained. |

## History

Originally both files defined the badge / top-model / hero / insights component
styles. Task 6 consolidated ownership: `design-v2.css` became the loaded owner for
those selectors and the duplicate base definitions were removed from `main.css`.
The migration guard that previously warned against deleting them (because
design-v2 was not yet linked) is now resolved — `design-v2.css` is linked in
`index.html`.

## Header comments

Both `main.css` and `design-v2.css` carry an `Owner:` comment at the top of the
file stating this policy.
