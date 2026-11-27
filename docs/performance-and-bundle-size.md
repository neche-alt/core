# Performance and Bundle Size Measurement Guide

This guide describes how to run bundle size checks, execute performance benchmarks, record relevant environment metadata, and interpret results for Sorokit Core contributors.

---

## 1. Quick Command Reference

| Task | Command | Purpose | Gate vs Informational |
|---|---|---|---|
| **Bundle size check** | `npm run size:check` | Verifies gzip sizes of root and subpaths against budgets | **Release Gate (Blocking)** |
| **Comprehensive bundle analysis** | `npm run analyze:bundle` | Analyzes tree-shaking, dead exports, and breakdown | **Informational** (or `--ci` blocking) |
| **Micro-benchmarks** | `npm run bench` | Measures operations/sec and latency percentiles via Vitest | **Informational** |
| **Budget regression tests** | `npm run test -- src/tests/budget-regression.test.ts` | Asserts key operations stay within latency budgets | **Release Gate (Blocking)** |
| **Unused export scan** | `npm run analyze:unused` | Scans for unused internal declarations | **Informational** |

---

## 2. Release Gates vs. Informational Metrics

To maintain high throughput without blocking PRs on hardware variances, metrics are strictly classified into **release gates** and **informational metrics**:

### Release Gates (CI Blocking)
These checks run in continuous integration and **must pass** before code can merge:

1. **Root Package Gzip Budget (< 150 KiB)**:
   - Target: `dist/index.mjs`
   - Maximum allowed: `150 KiB` gzip.
   - Purpose: Prevents dependency inflation and keeps the full barrel import bounded.
2. **Subpath Package Budgets**:
   - `dist/wallet/index.mjs`: `< 50 KiB` gzip.
   - `dist/account/index.mjs`: `< 40 KiB` gzip.
   - `dist/lazy/index.mjs`: `< 5 KiB` gzip.
3. **Tree-Shaking Isolation**:
   - Standalone subpaths (`dist/wallet`, `dist/account`, `dist/lazy`) must not import or reference the root barrel (`dist/index`).
4. **Budget Regression Suite (`src/tests/budget-regression.test.ts`)**:
   - Core CPU and memory operations must execute within baseline bounds (on reference Node 20 environment with a maximum allowable regression margin of 20%):
     - `validateAssetCode` / `validateAssetIssuer`: `< 0.5ms` per call
     - `validateTokenAsset` / `normalizePairId`: `< 0.5ms` per call
     - `validateTransaction`: `< 10ms` per call
     - `createSorokitClient`: `< 50ms` per call

### Informational Metrics (Advisory / Trend Tracking)
These checks provide deep diagnostic visibility into performance characteristics but do not fail the build on incidental hardware fluctuations:

1. **Vitest Benchmarks (`npm run bench`)**:
   - Measures operations per second (ops/sec), p75, p99, and margin of error across XDR parsing, fee calculation, result type constructors, and client calls.
   - Tracked across releases to detect long-term macro trends.
2. **Dead Code and Export Health (`npm run analyze:bundle`)**:
   - Reports symbol distribution, export metadata, and unused exports across submodules.
3. **Heap & Memory Profiles**:
   - Evaluates baseline memory consumption and garbage collection impact under high iteration loops.

---

## 3. Running Size Checks

### Fast Budget Check
Run the budget validation script after building the project:

```bash
npm run build
npm run size:check
```

Output:
```text
PASS full SDK: 124.3 KiB gzip (budget 150 KiB)
PASS wallet: 38.1 KiB gzip (budget 50 KiB)
PASS account: 29.4 KiB gzip (budget 40 KiB)
PASS lazy loader: 2.1 KiB gzip (budget 5 KiB)
```

### In-Depth Bundle Analysis
To inspect individual symbol sizes, unminified bytes, and module breakdowns:

```bash
npm run analyze:bundle -- --threshold 5
```

Options:
- `--threshold <KB>`: Filter exports exceeding the given size in KiB (default: 5 KiB).
- `--json`: Output raw machine-readable JSON for CI artifact ingestion.
- `--verbose, -v`: Display full symbol breakdown.
- `--ci`: Exit with code 1 if dead code or budget violations are detected.

---

## 4. Running Benchmarks & Regression Tests

### Micro-Benchmarks
Execute the Vitest benchmarking suite:

```bash
npm run bench
```

This exercises pure computational operations (without network round-trips) using deterministic mocks.

### Budget Regression Suite
Run the regression test suite:

```bash
npm run test -- src/tests/budget-regression.test.ts --reporter=verbose
```

---

## 5. Recording Environment Details

Benchmark numbers and bundle checks are sensitive to runtime conditions. When recording benchmark results or proposing threshold adjustments in pull requests, contributors should capture the following environment details:

```ts
import { captureBenchmarkEnvironment } from "sorokit-core";

const env = captureBenchmarkEnvironment();
console.log(JSON.stringify(env, null, 2));
```

Expected environment payload:
```json
{
  "runtime": "node",
  "nodeVersion": "v20.18.0",
  "platform": "win32",
  "arch": "x64",
  "heapUsedBytes": 32541280,
  "heapTotalBytes": 45613056,
  "timestamp": "2026-11-26T18:00:00.000Z"
}
```

### Recommended Checklist for PR Benchmark Submissions:
- [ ] Node.js version (LTS recommended, e.g. Node 20.x or 22.x)
- [ ] Operating System and CPU architecture (e.g. Linux x86_64, macOS aarch64, Windows x64)
- [ ] Build status: compiled with `npm run build` prior to measurement
- [ ] Baseline vs PR comparison table for any modified operations
