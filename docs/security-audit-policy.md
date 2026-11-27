# Security Audit Policy

## Severity Threshold

Sorokit Core uses a two-tier audit strategy in CI so that actionable dependency
risks are always visible without blocking the build on low-priority advisories.

| Severity | CI behaviour |
|---|---|
| **critical** | Blocking – CI fails |
| **high** | Blocking – CI fails |
| **moderate** | Non-blocking – reported as artifact |
| **low** | Non-blocking – reported as artifact |

## How it works in CI

The `security` job in `.github/workflows/ci.yml` runs two steps:

1. **Blocking check** (`npm audit --audit-level=high`)
   Fails the job when any `high` or `critical` vulnerability is found.
   This is the step that protects every pull request and merge to `main`.

2. **Advisory report** (`npm audit --json > audit-advisory-report.json || true`)
   Always succeeds. Writes a full JSON report (including `moderate` and `low`
   findings) and uploads it as a GitHub Actions artifact called
   `audit-advisory-report` retained for 30 days. The report is accessible from
   the **Actions** summary of every run so reviewers can triage lower-severity
   findings without being blocked.

## Remediation process

1. When the blocking step fails, resolve or override the high/critical
   vulnerability before the PR can be merged.
2. Review the advisory artifact on each run for moderate/low findings and
   open a tracking issue for any that require action.
3. If a vulnerability has no available fix and must be temporarily accepted,
   add an `npm audit` override in `package.json` under the `overrides` or
   `auditConfig.ignoreCves` field (npm ≥ 9) with a comment explaining the
   decision and a planned review date.

## Local audit commands

```bash
# Mirror the blocking CI check locally
npm audit --audit-level=high

# Full advisory report (all severities)
npm audit --json > audit-advisory-report.json

# Human-readable full report
npm audit
```
