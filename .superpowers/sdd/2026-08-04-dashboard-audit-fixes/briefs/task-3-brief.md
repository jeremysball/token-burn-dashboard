### Task 3: Queue odometer targets and make locale digits animatable

**Files:**
- Modify: `dashboard/js/odometer.js:1-95`
- Modify: `dashboard/js/views/dashboard.js:42-55`
- Test: `tests/unit/odometer.test.js`
- Test: `tests/unit/dashboard-odometer.test.js`

**Interfaces:**
- `renderOdometer(el, valueStr)` builds columns using a locale digit codec and stores the currently displayed string plus a nullable newest pending target.
- `updateOdometer(el, valueStr)` records the newest requested string even when one or more columns are busy, animates eligible columns, and drains the latest pending target after each transition settles. It may rebuild immediately for a layout change (digit count or static separator layout).
- The codec must recognize the glyphs produced by the active `Intl.NumberFormat` locale and emit the same glyph for the next row. Iterate formatted strings by code point (`Array.from`), not by ASCII range comparison.
- `heroTokens.dataset.value` is the newest requested numeric total. The dashboard may skip submitting the same requested value twice, but it must not use the dataset as proof that the DOM has already settled.

- [ ] **Step 1: Add locale and queue regression tests.**

Use an Arabic locale formatter in the test setup (or temporarily stub `Intl.NumberFormat`) and assert that `renderOdometer(el, '١٬٢٣٤')` creates four `.odo-digit` columns, preserves `٬` as a static separator, and that a subsequent `١٬٢٣٥` update appends the Arabic `٥` glyph.

Add a rapid-update test:

```js
renderOdometer(el, '1,001');
updateOdometer(el, '1,002');
updateOdometer(el, '1,003');
await settleTransitions();
expect(el.textContent).toContain('1,003');
```

`settleTransitions()` must use the existing 650 ms fallback timing or fake timers, not a production-only delay.

- [ ] **Step 2: Add a dashboard gate test for three rapid totals.**

Render `1001`, then call `renderDashboard(false)` with `1002` and immediately with `1003` while the last column is busy. After the transition fallback settles, assert that the hero displays `1,003`, `dataset.value` is `1003`, and a repeated render of `1003` does not append another transition row.

- [ ] **Step 3: Implement the shared locale digit codec.**

Create a small module-local codec that maps each digit value to the glyph returned by `Intl.NumberFormat(undefined, {useGrouping: false}).format(digit)` and maps those glyphs back to numeric values. Keep non-digit code points as static spans. When a digit changes, append the target glyph rather than `String(digit)`.

- [ ] **Step 4: Implement newest-target replay.**

Store `pendingValueStr` at the odometer level and `pendingGlyph`/`pendingDigit` as needed per busy column. A settle callback must atomically set the displayed row, clear the busy flag, and call a drain function that compares the displayed string with the newest pending target. A later update replaces an older pending target rather than queuing an unbounded sequence. Handle `999 -> 1,000` by rebuilding because the static layout changes.

- [ ] **Step 5: Keep the dashboard gate request-based.**

Set `dataset.value` only as the newest requested total, then call `updateOdometer`. Do not reintroduce a gate that marks a value as settled before `updateOdometer` has accepted/queued it. The odometer’s replay state, not `dataset.value`, guarantees eventual display.

- [ ] **Step 6: Run focused odometer tests.**

Run:

```bash
bun test tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js
```

Expected: PASS for first paint, same-value no-op, separator preservation, Arabic glyphs, digit-count rebuild, and rapid newest-target settlement.

- [ ] **Step 7: Commit odometer changes.**

```bash
git add dashboard/js/odometer.js dashboard/js/views/dashboard.js tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js
git commit -m "fix(dashboard): queue locale-aware odometer updates"
```

---
