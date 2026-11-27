# Release and Deprecation Policy

This document defines the release versioning categories, deprecation lifecycle expectations, notice channels, and dependency management policy for `sorokit-core`.

---

## 1. Versioning Scheme

`sorokit-core` adheres strictly to [Semantic Versioning 2.0.0](https://semver.org/):

$$\text{Version} = \text{MAJOR}.\text{MINOR}.\text{PATCH}$$

### Release Categories

| Category | Frequency | Scope & Backward Compatibility |
|:---|:---|:---|
| **Major (`X.0.0`)** | Planned / Cadence-based (6–12 months) | **Breaking changes**. Removal of previously deprecated APIs, changes to public type contracts, and major runtime requirement bumps (e.g., dropping EOL Node.js versions). |
| **Minor (`X.Y.0`)** | Regular feature cadence (monthly / bi-weekly) | **Backward-compatible features**. New modules, functions, client methods, performance improvements, and introduction of new deprecation notices. |
| **Patch (`X.Y.Z`)** | As needed / immediate for critical fixes | **Backward-compatible fixes**. Bug fixes, security patches, documentation updates, and internal refactorings. No breaking changes or new deprecations. |

---

## 2. Deprecation Lifecycle

When an API, method, configuration option, or type descriptor is superseded by a newer design, it enters the **Deprecation Lifecycle**:

```
[ Active API ]
      │
      ▼  (Minor release)
[ Deprecated API ] ─── JSDoc @deprecated tag + IDE warnings
      │            ─── Runtime console.warn (deduplicated per process)
      │            ─── Migration path in docs/migration-guide.md
      │            ─── Kept functional for at least 1 full minor cycle
      ▼  (Next Major release)
[ Removed API ]    ─── Compiler / runtime error with link to migration guide
```

### Deprecation Rules

1. **Advance Notice Period**:
   - An API must remain deprecated for **at least one full minor release cycle** before being eligible for removal in the next major version.
   - For example, an API deprecated in `v0.3.0` will remain functional throughout all `v0.x` releases and is only removed in `v1.0.0`.
   - APIs will never be removed in patch or minor releases.

2. **Notice Channels**:
   - **Type System / JSDoc**: Marked with `@deprecated` including the recommended replacement so editors (VSCode, WebStorm) show strikethrough styling and migration recommendations.
   - **Runtime Warning**: The SDK invokes `emitDeprecationWarning({ name, since, removalVersion, alternative })`, which logs a deduplicated `[sorokit-core:DEPRECATED]` warning to `console.warn` on first invocation.
   - **Release Notes / Changelog**: Every release changelog includes a dedicated `### Deprecations` section detailing the deprecated symbol, the rationale, and the drop-in replacement.
   - **Migration Guide**: [`docs/migration-guide.md`](migration-guide.md) documents step-by-step code comparisons between legacy patterns and modern replacements.

---

## 3. Runtime and Peer Dependency Policy

### Node.js Support Policy
- We support **active LTS and maintenance LTS** releases of Node.js (Node 18+, Node 20+, Node 22+).
- Dropping an end-of-life (EOL) Node.js version is treated as a **major release** milestone or accompanied by clear advance deprecation notices in preceding minor releases.

### Browser Support Policy
- `sorokit-core` targets modern ECMAScript environments supporting standard Web APIs (`crypto.subtle`, `fetch`, `AbortController`).
- Polyfills or custom adapters for legacy browsers are the responsibility of the consumer application.

### Peer Dependencies
- Peer dependencies (such as `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk`):
  - Minor version updates to peer dependencies are compatible across minor SDK releases.
  - Breaking changes or major version bumps in peer dependencies that require consumer code changes are released only in major SDK versions.

---

## 4. Disabling or Enforcing Deprecation Warnings

Developers can control runtime deprecation warning behavior through environment variables or SDK configuration:

### Disabling Warnings (Production / Quiet Mode)
```bash
# Via environment variable:
export SOROKIT_DISABLE_DEPRECATION_WARNINGS=1
```
Or via code:
```ts
import { setDeprecationPolicy } from "sorokit-core";

setDeprecationPolicy({ silenceWarnings: true });
```

### Enforcing Strict Migration (CI / Linter Mode)
To catch any usage of deprecated APIs in test suites or CI pipelines, enable strict error throwing:
```ts
import { setDeprecationPolicy } from "sorokit-core";

setDeprecationPolicy({ throwOnDeprecated: true });
```
When enabled, calling any deprecated API throws a runtime `Error` with migration instructions rather than logging a warning.
