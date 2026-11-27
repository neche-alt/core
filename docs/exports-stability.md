# Public Package Export Stability & Policy

This document defines the supported root and subpath exports for `sorokit-core`, their semantic stability guarantees, and the automated validation workflow that enforces them.

---

## 1. Supported Package Exports

`sorokit-core` uses Node.js conditional export maps in `package.json` (`exports` field). Each subpath exports dual ESM (`import`) and CommonJS (`require`) builds along with TypeScript declaration files (`types`).

| Export Path | Source Entrypoint | Stability Tier | Purpose / Scope |
| :--- | :--- | :--- | :--- |
| `.` | `src/index.ts` | **Stable** | Canonical root entrypoint. Client creation, common wallet adapters, result helpers, and core error codes. |
| `./wallet` | `src/wallet/index.ts` | **Stable** | Wallet adapters (`FreighterAdapter`, `LobstrAdapter`, etc.), connection state, event emitters, and signing. |
| `./account` | `src/account/index.ts` | **Stable** | Account loading, balance inspection, balance alerts, and sequence management. |
| `./transaction` | `src/transaction/index.ts` | **Stable** | Transaction building, fee estimation, multi-sig helpers, and submission. |
| `./soroban` | `src/soroban/index.ts` | **Stable** | Soroban smart contract interaction, event decoding, simulation, and deployment. |
| `./network` | `src/network/index.ts` | **Stable** | Network configurations, network defaults, and passphrase resolution. |
| `./shared` | `src/shared/public.ts` | **Stable** | Public validation functions (`validateStellarAddress`, `validateAmount`), stroop conversions, and mainnet safety limits. |
| `./testing` | `src/testing/index.ts` | **Testing** | Mock clients (`createMockClient`), mock wallet adapters (`createMockWalletAdapter`), and test stubs. *Do not bundle in production.* |
| `./core` | `src/core.ts` | **Stable** | Minimal core bundle for client creation without heavy optional adapters. |
| `./compliance` | `src/compliance/index.ts` | **Stable** | Operation audit trail tracking, compliance reports, and tamper-evident audit logs. |
| `./utility` | `src/utility/index.ts` | **Stable** | Standalone address/amount validation and rate limiter utilities. |
| `./integration` | `src/integration/index.ts` | **Beta** | High-level protocol integrations (e.g. SEP-10 authentication). |
| `./lazy` | `src/lazy/index.ts` | **Beta** | Dynamic / lazy-loaded modules for optimized cold-start bundle sizes. |

---

## 2. Stability Expectations & SemVer Rules

`sorokit-core` strictly adheres to [Semantic Versioning 2.0.0](https://semver.org/):

1. **Stable Tier**:
   - **Zero Breaking Changes**: Public API signatures, return types, and error codes are guaranteed stable across minor (`0.x.0`) and patch (`0.0.x`) releases.
   - **Deprecation Lifecycle**: If a symbol is scheduled for deprecation, it will be marked `@deprecated` in JSDoc for at least one minor release before removal in a major release.
   - **No Internal Leaks**: Internal modules (such as private caches, raw RPC fetch wrappers, and test runners) are deliberately excluded from export maps and cannot be imported by consumers.

2. **Testing Tier (`sorokit-core/testing`)**:
   - Designed strictly for test runners (`vitest`, `jest`).
   - Mock stubs match stable runtime shapes. Changes mirror additions to the runtime API.

3. **Beta Tier (`sorokit-core/integration`, `sorokit-core/lazy`)**:
   - Fully functional and tested, but signatures may be refined across minor releases in response to evolving ecosystem standards (e.g., Stellar SEP revisions).

---

## 3. Export Validation Workflow

To guarantee that breaking changes, unexported symbols, or leaked internals never reach npm releases, export stability is enforced in CI:

- **Validation Script**: [`scripts/validate-exports.js`](file:///C:/Users/HP/Downloads/core/scripts/validate-exports.js)
- **Execution Command**:
  ```bash
  npm run validate:exports
  ```
- **Automated CI Step**: Runs as part of the `build` and `typecheck` jobs in GitHub Actions on every pull request.
- **Verification Checks**:
  1. Compiles dual CJS and ESM distributions via `tsup` and `tsc --emitDeclarationOnly`.
  2. Loads each bundle in a fresh Node.js runtime and validates the presence of all expected symbols.
  3. Verifies that internal implementation files (e.g. `src/shared/cache.ts`) are **not** leaked into `dist/shared/public.js`.
  4. Validates that package metadata `exports` targets exist and match declaration outputs.
