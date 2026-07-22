# Fable Design + Aesthetic Review Findings — Token Burn Dashboard

Source: Claude Code session `abd14997-2978-4356-8883-984755909530`, 2026-07-21,
model switched to Fable 5 for the session and given `for-fable-<3.txt` (review
request pointer) plus `requesting-design-review.md`. Fable ran two passes —
a **design review** (against `requesting-design-review.md`'s brief) and an
**aesthetic pass** (via the `frontend-design` skill, requested directly by the
user mid-session) — against the live app (Playwright screenshots + source
read). The session ended after the aesthetic pass; **no code review was run**
in this session despite `requesting-code-review.md` existing in the repo —
that request is still open and out of scope for this spec.

This spec exists to carry every finding from that session into a trackable
form; it does not add new analysis beyond organizing and cross-referencing
Fable's own findings.

## Design review — overall decision: Request Changes

Reviewed: `review-desktop-dashboard.png`, `review-desktop-analytics.png`
(populated, 1440px dark), `fieldbook-desktop.png` / `fieldbook-mobile.png`
(loading/zero state), plus `dashboard/index.html`, `dashboard/styles/main.css`,
`dashboard/js/`.

**7 Blocking, 9 Advisory.** The blocking set clusters into three fixes: rework
the zero/loading state, add the accessibility layer (ARIA + focus rings +
shortcuts), and reconcile the doc's palette/shortcut claims with the shipped
app.

### Information architecture

- **[Blocking] Hero grid leaves a dead quadrant.** Total Tokens and Lifetime
  Cost share the top row; Burn Rate sits alone at half-width with empty space
  to its right (~x 950–1400 on the dashboard). Fix: make the hero a single
  3-across row (tokens / cost / burn rate) — matches the fieldbook variant's
  layout — or fill the fourth slot with cache-hit rate (currently buried below
  the fold in an insight card).
- **[Advisory] Insights duplicate the hero.** "Lifetime Cost $3959.51" repeats
  the hero stat ($4.0k) with more precision; "Current Velocity 8.73M/hr"
  overlaps Burn Rate (29.1k/min) in a different unit. Keep Top Model and Cache
  Efficiency; fold precise cost into the hero card's hover/tooltip and
  reconcile velocity vs. burn rate into one metric with one unit.
- **[Advisory] Burn Rate card reads as broken when sparse.** "29.1k/min" with
  a bare "-1h now" axis and no visible trend line looks like a render failure
  next to sibling cards' sparklines.

### Thematic consistency

- **[Blocking] The palette in the review doc is not the app.** The doc
  specifies GitHub-dark with accent `#58a6ff` (blue); the shipped UI is
  amber/gold on near-black. Fix the doc to the real tokens before circulating
  it — otherwise the review standard can't be applied by anyone.
- **[Advisory] Two divergent skins exist in the same repo.** The "fieldbook"
  variant (grid-paper background, `/ FIELD LOG` breadcrumb, teal REAL-TIME
  chip, teal top-border on the chart card) and the review variant (flat dark,
  amber) disagree on background texture, accent usage, and hero layout. If
  fieldbook is the direction, teal on LIVE/REAL-TIME chips is fine as the
  sole cool-hue "live" signal, but the chart card's teal top-border should go
  (it's decoration, not signal).
- **[Advisory] Per-model accent colors double as status colors.** Top Models
  cards use left-border color (amber/blue/purple/green) as model identity,
  but the same green/blue also read as status colors elsewhere. Reserve green
  strictly for live/success.

### Polish vs. noise

- **[Advisory] Hero sparkline gradients under giant numerals barely survive
  the removal test.** They encode real shape on the hero cards — keep those —
  but 3 of 4 Top Models cards render a flat-line sparkline that encodes
  nothing. Render the sparkline only when the series has variance; otherwise
  drop the row and tighten the card.
- **[Advisory] Analytics TREND column is ~91% empty ink.** 10 of 11 rows in
  the Models table show a flat dash. Collapse the column or switch to a
  numeric delta.

### State resilience

- **[Blocking] Zero state contradicts the spec and looks dead.** The brief
  promises "No session data found. Start a Pi agent session…" with a docs
  link. The fieldbook screenshots instead show `0 / $0.00 / 0/min`, an
  entirely empty Live Token Flow panel (~300px black), bare "TOP MODELS" /
  "INSIGHTS" headings with no content, and a lone lowercase "loading…" at the
  bottom — no way to tell "no data" from "broken." Implement the spec'd empty
  state; give the empty chart panel a centered placeholder message.
- **[Blocking] Header chip collision in loading state.** Both fieldbook
  screenshots show the LIVE chip overlapping another glyph, rendering as
  "■IVE" while "initializing…" sits beside it — two elements claiming the
  same slot during init. Show exactly one status chip that transitions
  initializing → live.
- **[Advisory] "Collecting data…" placement is ambiguous on mobile.** It
  appears inside the Burn Rate card on desktop but floats ambiguously in the
  mobile stack — anchor it to the component it describes.
- **[Not verifiable from screenshots]** Error banner, retry behavior,
  partial-failure isolation — no error-state screenshot was provided despite
  the doc's table promising one. Supply it before sign-off.

### Accessibility (measured from source, not screenshots — worst area)

- **[Blocking] No ARIA at all.** `rg "aria-|role=|tabindex" dashboard/index.html`
  returns zero matches across 321 lines. The doc's own requirements
  (aria-labels on stat blocks/charts, `role="tabpanel"`) are unimplemented;
  the tab bar is presumably divs/buttons with no tab semantics.
- **[Blocking] Focus rings effectively absent.** Only 2 `outline` occurrences
  in 3,238 lines of CSS; nothing matching the spec'd
  `outline: 2px solid var(--accent)` pattern. Keyboard users cannot see where
  they are across ~15 interactive controls per view.
- **[Blocking] Keyboard shortcuts appear unimplemented.** `keydown` handlers
  exist only in `dashboard/js/views/analytics.js`; nothing global handles the
  documented `1`–`5`/`R`/`T`/`/`/`?` shortcuts. Either implement them or strike
  them from the doc.
- **[Advisory] No `prefers-reduced-motion` guard** despite staggered
  fade-ins, pulses, and shimmer animations.
- **[Advisory] Contrast risks.** Secondary text (`#8b949e`-class gray) at
  small sizes in card labels ("$1.50 in / $6.00 out") and dimmed tick labels
  on the flow chart are near the 4.5:1 line; the amber-on-amber hero
  sparkline is fine (decorative). Run an axe pass once ARIA lands.

### Information density

- **[Advisory] Analytics table trailing zero-rows.** Five rows of
  `0 / $0.00 / 0` occupy the bottom half of the Models view. Collapse behind
  a "show 5 inactive models" toggle.
- **[Advisory] Duplicate model names without disambiguation.** `gpt-5.4` and
  `gpt-5.4-mini` each appear twice with different totals (different
  providers/sessions?). Append the disambiguating dimension to the label.
- Density on the populated dashboard is otherwise good — the footer
  `238 files · 91.4k lines` is a nice zero-cost signal (no action needed).

### Not covered — needs a live pass

Light theme, theme persistence, the other 10 Analytics tabs' rendering,
Plotly downsampling >5k points, Lighthouse/4G budget, SSE rate, and mobile
populated state (only mobile screenshot available was the zero state). The
screenshot set covered roughly a third of the brief's scope matrix — re-review
those once the blocking items land.

## Aesthetic pass (frontend-design skill, live app: dark + light, desktop + mobile)

**Verdict:** the dark theme has a real identity — amber-on-near-black with
JetBrains Mono reads as "flame on a terminal," the right metaphor for a
product called token_burn. The bones are good; what keeps it from feeling
finished is inconsistency at the edges: emoji leaking into a monospace
system, a light theme that's a downgrade rather than a sibling, and a few
live bugs that read as sloppiness.

Screenshots from this pass: `aes-desktop-dashboard.jpeg`, `aes-timeline.jpeg`,
`aes-heatmaps.jpeg`, `aes-theme2.jpeg` (light), `aes-mobile.jpeg` (repo root).

### What's working — keep it

- The amber monochrome ramp: the heatmap view (one hue, brightness =
  intensity, black field) is the signature element; the dashboard hero card
  (amber border + faint amber wash + sparkline) carries the same DNA. Protect
  it.
- Type discipline: all-mono with letterspaced uppercase labels vs. huge
  numerals gives clear hierarchy without a second typeface. `4210.94M` at
  display size is the hero thesis and it lands.
- The footer (`238 files · 91.4k lines`) — quiet, in-voice, informative.

### Findings

1. **[Highest-impact] Emoji are breaking the system.** Tab labels mix plain
   text (Models, Compare, Timeline…) with emoji-prefixed ones (🔍 Insights,
   📚 Scale, 💻 Code, 🔥 Heatmaps…); insight cards use 🏆⚡💰📈; the Timeline
   empty state uses a full-color 📊; the page title is "🔥 token_burn //
   live". Color emoji import someone else's palette into every screen.
   Replace with single-color glyphs from the mono face (`>`, `#`, `Δ`, `▲▼`,
   box-drawing) or drop them — the half-emoji tab row currently makes the
   nav look like two different apps' tabs interleaved.
2. **Light theme is a fallback, not a theme.** Toggling to light keeps the
   layout but loses the identity: the amber wash on the hero card turns
   peachy-pastel, the LIVE/REAL-TIME chips lose their glow, nothing replaces
   the "terminal" feel. Pick one direction: (a) "paper fieldbook" — warm
   off-white ground, ink text, amber as the sole accent at higher saturation,
   echo the fieldbook variant's grid-paper texture; or (b) declare the
   product dark-only (defensible for an operator tool) and remove the
   toggle. The current halfway state is the worst option.
3. **[Live bug] Theme switch leaves Plotly half-rendered.** After toggling
   themes, the Live Token Flow plot redraws at roughly half the container
   width (stops ~750px into a 1400px card) until something forces a
   relayout. Call `Plotly.relayout`/`Plotly.Plots.resize` after the theme
   swap.
4. **Timeline tab defaults to an empty state.** Landing on Timeline shows
   "Not enough data for the last 24 hours — try selecting a wider time
   range" even though 7d/30d/All have data. Fall back to the narrowest range
   that has data and highlight that range button (do-what-I-mean default).
5. **Toast placement.** "Data refreshed" pops over the bottom-right of the
   live chart, covering the newest data. Move toasts below the chart region
   or top-right under the clock; consider whether the persistent header
   timestamp already makes a refresh toast redundant.
6. **Background particle dots.** Faint scattered dots drift across the
   background on every view; at current opacity they read as dead
   pixels/JPEG artifacts rather than atmosphere. Either commit (more visible,
   clearly-intentional ember/spark motif, on-brand for "burn") or remove.
   Gate any motion behind `prefers-reduced-motion` either way.
7. **Hero grid still has the dead quadrant** (same root cause as the design
   review's IA finding above) — Burn Rate half-width with empty black to its
   right makes the composition top-heavy-left. Mobile stack proves each card
   works full-width; go 3-across on desktop, or promote Cache Efficiency into
   the fourth slot.
8. **Small polish items:**
   - Range pills (1h/24h/7d/30d/All) and sort pills (Tokens/Cost/Cache) look
     visually identical to inactive tab buttons — three control types share
     one style. Give the selected pill the amber fill the tabs use.
   - The native `<select>` ("Hourly Patterns ▾") on Heatmaps is the only
     unstyled control in the app — white OS chrome on the black field. Style
     it or replace with pills like other views.
   - Heatmap legend "Low ▬▬ High (107.85M tokens)" is good, but the gradient
     bar's ramp doesn't visually match the cell ramp's endpoints — sample
     both from the same scale.
   - Mobile: LIVE chip + clock wrap onto their own row below the subtitle,
     orphaning the theme-toggle icon at far left. Collapse to one status
     row: toggle · LIVE · time.

### Priority order (as given by Fable)

1. Strip/replace emoji (identity)
2. Fix Plotly resize on theme toggle (credibility)
3. Timeline default range + toast placement (do-what-I-mean)
4. Decide light theme's fate (direction)
5. Hero grid, pills, select styling, particles (polish)

## Not in scope for this spec

- **Code review** (`requesting-code-review.md`'s source-map/build-pipeline/
  server-stability/test-coverage checklist) was never run by Fable in this
  session — still open, tracked separately from these design/aesthetic
  findings.
- Anything under "Not covered — needs a live pass" above wasn't assessed at
  all; don't infer a verdict on it from this document.
