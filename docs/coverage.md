# Coverage Artifacts

Coverage reports are generated automatically on every CI run and published as
downloadable artifacts so contributors and reviewers can inspect regressions
at the file, function, and branch level.

## Viewing coverage in CI

1. Open the **Actions** tab on the repository.
2. Select any CI run (coverage runs alongside the test job).
3. Scroll to **Artifacts** and download **coverage-report**.
4. Unzip and open `coverage/index.html` in a browser for the full HTML report.

Artifacts are retained for **30 days**.

For pull requests targeting `main` or `develop`, a summary comment is posted
automatically showing line, branch, function, and statement percentages.

## Running locally

```bash
npm run test:coverage
```

This writes reports to `./coverage/`:

| File | Format | Use |
|------|--------|-----|
| `index.html` | HTML | Interactive drill-down by file |
| `coverage-summary.json` | JSON | Machine-readable totals (used by CI comment) |
| `lcov.info` | LCOV | Editor integrations (VS Code Coverage Gutters, etc.) |

## Coverage thresholds

Thresholds are enforced in `vitest.config.ts` and block CI when breached:

| Metric | Threshold |
|--------|-----------|
| Lines | 80% |
| Functions | 76% |
| Branches | 75% |
| Statements | 80% |

These cover only production source files under `src/` (excluding test files,
the `testing/` mock helpers, and the `examples/` directory).

## Adding coverage for new behaviour

When a PR introduces or changes behaviour, add a focused test file under
`src/tests/` that:

1. Imports only the module(s) changed.
2. Exercises each new code path, including at least one failure or boundary case.
3. Does **not** rely on network calls — use mocks or in-memory implementations.

The existing `src/tests/coverageArtifacts.test.ts` illustrates this pattern
for `MemoryCursorStore`, `PersistentEventDeduplicationStore`, and
`validateTelemetryConfig`.
