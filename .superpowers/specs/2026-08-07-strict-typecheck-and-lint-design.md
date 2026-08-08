# Tightening tsc and sonarjs

Date: 2026-08-07
Status: draft, not scheduled

## What is actually true today

The premise "enable tsc" is already satisfied, so this spec is about coverage and depth rather than turning something on.

`tsconfig.json` today:

```json
{
  "allowJs": true,
  "checkJs": true,
  "noEmit": true,
  "strict": true,
  "skipLibCheck": true,
  "target": "ES2022",
  "module": "commonjs",
  "moduleResolution": "node",
  "include": ["lib/**/*.js", "server.js", "dashboard/**/*.js"],
  "exclude": ["node_modules", "tests", "coverage", "dist"]
}
```

`checkJs` and `strict` are both on, `bun run typecheck` runs `tsc --noEmit`, and the pre-commit hook runs it. The current tree reports **0 errors**. There is no backlog to burn down before tightening, which is the good case.

`eslint.config.mjs` loads the sonarjs recommended set and rewrites every rule to `warn`:

```js
const sonarjsRecommendedWarnings = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).map(([ruleId, setting]) => {
    if (setting === 'off' || setting === 0) return [ruleId, setting];
    return [ruleId, Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn'];
  })
);
```

That is 279 rules, 62 off by default, 217 active and all demoted to advisory. The tree reports 0 errors and 267 warnings.

Enforcement today comes from `scripts/lint-baseline.mjs`, which buckets warnings by `filePath|ruleId` and fails on any new or increased bucket. So warnings cannot grow, but they also never have to shrink, and a whole file can be rewritten around its existing warning count without anyone noticing.

## Measured cost of each change

Every number below came from running the flag against the current tree, not from estimation.

### tsc flags, measured one at a time

| Flag | Errors introduced |
|---|---|
| `noImplicitReturns` | 0 |
| `noFallthroughCasesInSwitch` | 0 |
| `skipLibCheck: false` | 0 |
| `noUnusedLocals` | 1 |
| `exactOptionalPropertyTypes` | 2 |
| `noUnusedParameters` | 6 |
| `noUncheckedIndexedAccess` | 113 |
| `noPropertyAccessFromIndexSignature` | 209 |

Three of those are free. Three more cost under ten fixes combined. Two are large projects on their own.

### tsc coverage

Extending `include` to `scripts/**/*.mjs` and `tests/**/*.js` produces **1427 errors**. Test files are almost all of it. Adding only `scripts/**/*.mjs` produces **38**, which puts tests at roughly 1389 on their own. They were written with no type checking in view and Bun's test globals are not declared.

So the two are worth separating. Scripts are a stage-3 sized job; tests are their own project.

### sonarjs, by warning count

```
 68  complexity
 41  max-statements
 30  max-lines-per-function
 29  sonarjs/prefer-specific-assertions
 18  sonarjs/no-nested-conditional
 16  sonarjs/cognitive-complexity
 11  sonarjs/assertions-in-tests
 11  no-unused-vars
 11  max-depth
  9  sonarjs/no-os-command-from-path
  9  sonarjs/no-floating-point-equality
  9  max-lines
  8  sonarjs/unused-import
  8  sonarjs/pseudo-random
  5  sonarjs/super-linear-regex
  5  sonarjs/no-nested-template-literals
  3  sonarjs/no-fixed-wait-in-tests
  2  max-params
  1  each: todo-tag, no-unused-vars, no-unenclosed-multiline-block,
     no-nested-functions, no-dead-store, duplicates-in-character-class,
     code-eval
```

The shape here matters more than the totals. Of 217 active sonarjs rules, only 21 fire at all. The other 196 are already clean and can be promoted to `error` today at zero cost, which locks in every class of defect the project has never committed.

The three biggest buckets are size and complexity limits on a handful of known-gnarly functions, not a diffuse problem. `lib/session-discovery.js` alone accounts for a large share.

## Proposed sequence

Four stages, each independently shippable and each one PR. Nothing here depends on a later stage.

### Stage 1: free tsc flags

Add `noImplicitReturns`, `noFallthroughCasesInSwitch`, and set `skipLibCheck` to `false`. Zero errors, so this is pure ratchet. Land it first because it costs nothing and it forecloses regressions immediately.

### Stage 2: promote the 196 clean sonarjs rules to error

Replace the blanket `warn` rewrite with an explicit split: rules currently at zero occurrences become `error`, the 21 that fire stay `warn`. Generate the list rather than hand-maintaining it, but commit the resulting explicit map so the config states what it enforces instead of computing it at load.

This is the highest value change in the spec. It converts 196 latent rules from advisory to enforced without fixing a single line, and it makes the remaining 21 the visible, finite backlog.

### Stage 3: the cheap tsc flags, `scripts/`, and the small sonarjs buckets

`noUnusedLocals` (1), `exactOptionalPropertyTypes` (2), `noUnusedParameters` (6), plus `scripts/**/*.mjs` coverage (38). Then the sonarjs singletons and small buckets: `code-eval`, `no-dead-store`, `duplicates-in-character-class`, `no-unenclosed-multiline-block`, `no-nested-functions`, `unused-import`, `no-nested-template-literals`, `super-linear-regex`.

`sonarjs/code-eval` and `sonarjs/no-os-command-from-path` deserve to jump the queue regardless of count. They are security rules, and nine occurrences of the latter is small enough to fix in the same PR.

### Stage 4: the two large projects

`noUncheckedIndexedAccess` (113) and `noPropertyAccessFromIndexSignature` (209) each need their own plan. Neither is a mechanical fix. Take them one file at a time behind a per-directory override rather than repo-wide, so partial progress is enforceable.

Test-directory type checking (1427 errors) belongs here too, and probably wants Bun's own type declarations wired up before anything else is attempted.

## What this spec deliberately does not propose

Raising `complexity`, `max-statements`, or `max-lines-per-function` to `error`. Those 139 warnings are concentrated in functions that need restructuring, not annotation, and forcing them to error blocks unrelated work in those files. They stay warnings under the existing baseline ratchet until someone refactors them on purpose. #66 and #67 already cover part of that ground.

Removing the baseline ratchet. It stays as the backstop for whatever remains at `warn` after every stage.

## Open questions

Whether promoting 196 rules to `error` in one PR is reviewable, or whether it should be split by rule category. The diff is config-only and touches no source, which argues for one PR.

Whether the 196 promoted rules should be regenerated periodically as new rules land in sonarjs releases, and if so whether that regeneration is a manual chore or a check that fails when a newly clean rule is still sitting at `warn`.
