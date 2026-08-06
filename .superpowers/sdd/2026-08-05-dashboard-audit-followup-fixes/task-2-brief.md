### Task 2: Odometer keeps the newest requested value during a same-value rollback

**Files:**
- Modify: `dashboard/js/odometer.js:192-198`
- Test: `tests/unit/odometer.test.js`

**Interfaces:**
- Consumes: `state.pendingValueStr` (already defined on the `OdoState` returned by `renderOdometer`, set in `drain()` at line 100/165 — no new field).
- Produces: `updateOdometer(el, valueStr)` — same exported signature, no callers elsewhere need to change.

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/odometer.test.js`, inside `describe('odometer', ...)`, after the existing "settles the newest of rapid updates" test:

```js
it('settles a same-value rollback requested while a transition is still in flight', () => {
    const timers = captureTimers();
    try {
      renderOdometer(el, '1,001');
      updateOdometer(el, '1,002');
      updateOdometer(el, '1,001');
      timers.runAll();
      expect(el.textContent).toContain('1,001');
    } finally {
      timers.restore();
    }
});
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `bun test tests/unit/odometer.test.js`
Expected: FAIL — `el.textContent` contains `1,002` instead of `1,001`, because the second `updateOdometer` call returns early without recording the rollback.

- [ ] **Step 3: Implement the fix.**

In `dashboard/js/odometer.js`, change the early-return guard in `updateOdometer`:

```js
export function updateOdometer(el, valueStr) {
    const state = odometerState.get(el);
    if (!state) {
        renderOdometer(el, valueStr);
        return;
    }
    if (valueStr === state.valueStr && state.pendingValueStr == null) return;
    // ... rest of the function is unchanged
```

No other line in `updateOdometer` or `drain` changes — the existing busy-column `pendingDigit` and non-busy `startRoll` branches already handle rolling a column back to an earlier digit once this guard stops blocking the call.

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js`
Expected: PASS, including the pre-existing "ignores a call with an unchanged value (no-op...)" test — that test calls `updateOdometer(el, '1,234')` right after `renderOdometer(el, '1,234')` with no transition in flight, so `state.pendingValueStr` is `null` and the no-op path still applies.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/odometer.js tests/unit/odometer.test.js
git commit -m "fix(dashboard): settle odometer rollback requested mid-transition"
```

---

