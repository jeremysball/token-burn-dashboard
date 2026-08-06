### Task 3: Equivalence ticker clears the fade class on invalidation

**Files:**
- Modify: `dashboard/js/equiv-ticker.js:179-188`
- Test: `tests/unit/dashboard-equiv-ticker.test.js`

**Interfaces:**
- Consumes: nothing new — `clearTicker(el)` already receives the mounted ticker element.
- Produces: `clearTicker(el)` — same signature, called from the same two sites (`updateEquivTickers`'s `else` branch, `resetEquivTickersForTest`'s equivalent inline cleanup does not call `clearTicker` and is unaffected).

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/dashboard-equiv-ticker.test.js`, after the existing "clears interval, fade timeout, lines, and visible text when the value goes invalid" test:

```js
it('removes a stuck fade class when invalidated mid-fade, so a later restart is visible', () => {
    setCurrentData({
      total_tokens: 100,
      total_cost: { total: 5 },
      total_cache_read: 0,
      total_input: 0,
      tokens_by_model: { 'm': { total: 100 } },
      files_processed: 1,
      total_lines: 10
    });

    const timers = captureTimers();
    try {
      renderDashboard(true);

      const ticker = document.querySelector('[data-equiv-category="tokens"]');
      const textEl = ticker.querySelector('.equiv-text');

      timers.fireRotation();
      expect(textEl.classList.contains('fade')).toBe(true);

      updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });
      expect(textEl.classList.contains('fade')).toBe(false);

      updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
      expect(textEl.classList.contains('fade')).toBe(false);
      expect(textEl.textContent).not.toBe('');
    } finally {
      timers.restore();
    }
});
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js`
Expected: FAIL on `expect(textEl.classList.contains('fade')).toBe(false)` right after `updateEquivTickers({ tokens: 0, ... })` — the class is still present because `clearTicker` never removes it.

- [ ] **Step 3: Implement the fix.**

In `dashboard/js/equiv-ticker.js`, add one line to `clearTicker`:

```js
function clearTicker(el) {
    el._equivLastValue = undefined;
    if (el._equivIntervalId) clearInterval(el._equivIntervalId);
    el._equivIntervalId = null;
    if (el._equivFadeTimeout) clearTimeout(el._equivFadeTimeout);
    el._equivFadeTimeout = null;
    el._equivLines = [];
    el._equivRotationIndex = 0;
    const textEl = el.querySelector('.equiv-text');
    if (textEl) {
        textEl.textContent = '';
        textEl.classList.remove('fade');
    }
}
```

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js tests/unit/equiv-ticker.test.js`
Expected: PASS, including the pre-existing invalidation and restart tests in both files.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/equiv-ticker.js tests/unit/dashboard-equiv-ticker.test.js
git commit -m "fix(dashboard): clear stuck fade class on ticker invalidation"
```

---

