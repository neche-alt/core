# Release Automation

Two scripts help maintainers keep release metadata consistent and catch problems before cutting a release.

---

## `check-release-metadata` (#123)

**Purpose:** Non-destructive audit that flags inconsistencies between release branches, tags, and published package versions.

```bash
npm run check:release-metadata
# or directly:
node scripts/check-release-metadata.mjs
```

### What it checks

| Code | Problem detected | Maintainer action |
|---|---|---|
| `BRANCH_VERSION_DRIFT` | A `release/*` branch tip has a `package.json` version that does not match the branch name. | Update `package.json` on the branch to match, or rename/delete the branch. |
| `TAG_VERSION_MISMATCH` | A `vX.Y.Z` tag points at a commit whose `package.json` version differs from the tag name. | `git tag -d vX.Y.Z && git tag -a vX.Y.Z <correct-sha> -m "Release X.Y.Z"` |
| `TAG_WITHOUT_BRANCH` | A semver tag exists but no matching `release/X.Y.Z` branch does. | `git checkout -b release/X.Y.Z vX.Y.Z` — or delete the orphan tag if it was created in error. |
| `BRANCH_WITHOUT_TAG` | A `release/*` branch exists but no matching `vX.Y.Z` tag does. | `git tag -a vX.Y.Z -m "Release X.Y.Z" <sha>` — or delete the branch if the release was abandoned. |
| `TAG_NOT_ANNOTATED` | A release tag is lightweight instead of annotated. | `git tag -d vX.Y.Z && git tag -a vX.Y.Z <sha> -m "Release X.Y.Z"` |

The script exits `0` when no issues are found, `1` when any are detected.

### When to run

- In CI on any push to `main` or a `release/*` branch.
- Manually before creating a hotfix branch.

---

## `pre-release:check` (#118)

**Purpose:** Validates that the repository is in a consistent, release-ready state before tagging a release. All checks are read-only.

```bash
npm run pre-release:check
# with an explicit expected tag:
node scripts/pre-release-check.mjs --expected-tag v1.2.0
```

### What it checks

| Code | Problem detected | Maintainer action |
|---|---|---|
| `VERSION_TAG_CONSISTENCY` | `package.json` version does not match the most recent git tag (or `--expected-tag`). | Bump `package.json`, or create/update the tag: `git tag -a v<version> -m "Release <version>" HEAD` |
| `CHANGELOG_PRESENCE` | `CHANGELOG.md` is missing, or has no entry for the current version and no `[Unreleased]` section. | Add a section: `## [<version>] - YYYY-MM-DD` |
| `CLEAN_GENERATED_OUTPUTS` | `dist/` is absent, empty, or has uncommitted changes. | `npm run build && git add dist/ && git commit -m 'chore: regenerate dist'` |
| `EXPECTED_EXPORTS_PRESENT` | `package.json` is missing one or more required `exports` entries. | Add the missing entries to the `exports` map. Required entries: `.`, `./testing`, `./transaction`, `./wallet`, `./account`, `./network`, `./soroban`, `./shared`. |

The script exits `0` when all checks pass, `1` when any fail.

### When to run

Run this immediately before tagging a release:

```bash
npm run pre-release:check && git tag -a v$(node -p "require('./package.json').version") -m "Release $(node -p "require('./package.json').version")" HEAD
```

---

## Running the tests for these scripts

The helper-function tests for both scripts use only Node's built-in `assert` module:

```bash
node scripts/check-release-metadata.test.mjs
node scripts/pre-release-check.test.mjs
```
