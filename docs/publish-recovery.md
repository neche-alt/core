# Package Publishing Recovery Guide

This guide documents the failure states a release can enter, the safe procedure for recovering from each, and how to validate credentials and package contents before retrying.

---

## Failure States

### 1. Tag created, publish did not start

The git tag exists and may have been pushed, but no publish command ran or it was interrupted before the registry received anything.

**Symptoms**
- The tag appears in `git tag` or on the GitHub releases page
- The version does not appear in `npm info sorokit-core versions` or `yarn npm info sorokit-core versions`

**Risk level**: Low — the registry is unaffected.

---

### 2. Publish succeeded, GitHub release draft not created

The package is live on the registry but the GitHub release (and its notes) was never created or remains a draft.

**Symptoms**
- `npm info sorokit-core` shows the new version
- No published release on the GitHub releases page, or it is in Draft state

**Risk level**: Low for consumers; the package is usable. The release notes are missing.

---

### 3. Publish partially uploaded

The registry received the tarball but the publish did not complete (network interruption, registry timeout).

**Symptoms**
- `npm info sorokit-core versions` may not list the new version yet
- The publish command exited with a non-zero code or a network error message

**Risk level**: Medium — retrying immediately may succeed or produce a 409 conflict.

---

### 4. Wrong version published

The tarball was published but the `version` field in `package.json` was incorrect (e.g. the wrong branch was checked out, or the version was bumped but not committed).

**Symptoms**
- `npm info sorokit-core` shows an unexpected version
- `npm deprecate` or a patch release may be needed (see recovery below)

**Risk level**: High — consumers may install the wrong code.

---

### 5. Tag and publish are out of sync

The tag points to a different commit than the one that was published.

**Symptoms**
- `git show <tag>:package.json` shows a different version than what is live on the registry

**Risk level**: Medium — provenance is broken; audit trails are unreliable.

---

## Recovery Procedures

> **Rule**: Never retry a publish blindly. Always confirm the current state of the registry and git history before acting.

### Step 1 — Confirm current registry state

```bash
# npm registry
npm info sorokit-core versions --json

# Yarn 4
yarn npm info sorokit-core versions --json
```

Decide whether the version you intended to publish is already live before doing anything else.

---

### Step 2 — Confirm current git state

```bash
# List recent tags
git tag --list 'v*' | sort -V | tail -10

# Verify the tag points to the right commit
git log --oneline -1 <tag>
git show <tag>:package.json | grep '"version"'
```

---

### Step 3 — Recovery by failure state

#### State 1: Tag exists, nothing published

The tag is safe to delete and recreate after fixing the problem.

```bash
# Delete local tag
git tag -d v<VERSION>

# Delete remote tag (requires push access)
git push origin :refs/tags/v<VERSION>

# Fix the problem, then re-tag and publish via the normal release process
```

---

#### State 2: Publish succeeded, release draft missing

Create the GitHub release manually or promote the existing draft:

```bash
# Create a release from the existing tag
gh release create v<VERSION> \
  --title "v<VERSION>" \
  --notes "Release notes for v<VERSION>" \
  --latest
```

Alternatively, go to **GitHub → Releases → Edit draft → Publish release**.

---

#### State 3: Partial upload / registry conflict

Wait at least 5 minutes (registries cache 404 responses), then run a dry-run to validate the tarball:

```bash
npm publish --dry-run
# or with Yarn 4
yarn npm publish --dry-run
```

If dry-run succeeds, retry the publish. If you receive a 409 (conflict), the version is already registered — treat it as State 2.

---

#### State 4: Wrong version published

Deprecate the bad version immediately so consumers are warned:

```bash
npm deprecate sorokit-core@<BAD_VERSION> \
  "Published in error — do not use. See v<CORRECT_VERSION>."
```

You cannot overwrite a published version on the npm registry. Bump to a new patch version, fix the content, and publish the corrected version via the normal process.

```bash
# 1. Remove the bad tag
git tag -d v<BAD_VERSION>
git push origin :refs/tags/v<BAD_VERSION>

# 2. Bump version in package.json, commit, re-tag, publish normally
```

---

#### State 5: Tag and publish are out of sync

Move the tag to the commit that was actually published:

```bash
# Delete existing tag
git tag -d v<VERSION>
git push origin :refs/tags/v<VERSION>

# Re-create the tag at the correct commit
git tag v<VERSION> <CORRECT_COMMIT_SHA>
git push origin v<VERSION>
```

Document the correction in a GitHub release comment or pinned issue so there is a clear audit trail.

---

## Dry-Run Validation

Always validate credentials and package contents before a live publish:

```bash
# 1. Confirm you are authenticated
npm whoami
# or
yarn npm whoami

# 2. Inspect what files would be included in the tarball
npm pack --dry-run
# or
yarn pack --dry-run

# 3. Inspect the actual packed contents (creates a local .tgz — delete after)
npm pack
tar -tzf sorokit-core-*.tgz
rm sorokit-core-*.tgz

# 4. Full publish dry-run (validates the whole publish flow without uploading)
npm publish --dry-run
# or
yarn npm publish --dry-run
```

The `scripts/publish-preflight.sh` script runs all of these checks in sequence and exits non-zero on the first failure.

---

## Checklist Before Retrying a Failed Publish

- [ ] Confirm the version is not already live (`npm info sorokit-core`)
- [ ] Confirm `package.json` version matches the intended release
- [ ] Confirm the git tag points to the correct commit (`git show <tag>:package.json | grep version`)
- [ ] Run `npm pack --dry-run` and verify the file list looks correct
- [ ] Run `npm publish --dry-run` and confirm it exits cleanly
- [ ] Verify registry credentials (`npm whoami`)
- [ ] Check for outstanding GitHub release drafts and clean them up

Or run the preflight script which covers all of the above automatically:

```bash
bash scripts/publish-preflight.sh
```

---

## References

- [npm publish docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [Yarn npm publish docs](https://yarnpkg.com/cli/npm/publish)
- [npm deprecate](https://docs.npmjs.com/cli/v10/commands/npm-deprecate)
- [gh release create](https://cli.github.com/manual/gh_release_create)
