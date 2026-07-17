# Dashboard Styles — Selector Ownership

This directory contains two stylesheets. This document records which file owns
which selectors so duplicated definitions are not silently maintained in two
places.

## Loaded stylesheet

`dashboard/index.html` links **only `main.css`** (see the `<link>` with
`/dashboard/styles/main.css?v=11`). `design-v2.css` is **not** linked by the
running app as of this writing.

## Ownership policy

| Selector group      | Documented owner     | Notes |
| ------------------- | -------------------- | ----- |
| `pricing-source-badge`, `.openrouter`, `.local` | `design-v2.css` | Full component def duplicated in `main.css`. |
| `top-model-name`    | `design-v2.css`      | Full component def duplicated in `main.css`. |
| `hero-section`, `hero-stat`, `hero-stat.primary`, `hero-label`, `hero-value` | `design-v2.css` | Redesign defs duplicated in `main.css`. `main.css` also defines `hero-spark` / `hero-spark svg`, which are unique to it. |
| `scale-hero`, `scale-grid` | `design-v2.css` (polish only) | `design-v2.css` adds border-radius polish; the base layout is defined only in `main.css`. No full duplicate exists for layout. |
| `insights-section`, `insights-section h2`, `insights-grid` | `design-v2.css` | Redesign defs duplicated in `main.css`. |

## Migration note (important)

`design-v2.css` is the *intended* owner for the selectors above, but it is not
yet loaded. Until `index.html` is switched to load `design-v2.css` (or both, in
the correct order), **do not delete the base component definitions from
`main.css`** — doing so would remove styling from the live dashboard because
nothing would load the `design-v2.css` replacement.

When the stylesheet link is migrated to `design-v2.css`, the duplicate base
definitions for `pricing-source-badge`, `top-model-name`, `hero-*`,
`insights-*`, and `scale-*` may be removed from `main.css`, keeping only the
`hero-spark` rules and any genuinely `main.css`-only styles.

## Header comments

Both `main.css` and `design-v2.css` carry an `Owner:` comment at the top of the
file stating this policy.
