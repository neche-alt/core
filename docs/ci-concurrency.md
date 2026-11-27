# CI Concurrency Controls (#124)

Pushing new commits to a pull request automatically cancels the superseded CI run on that PR, freeing runners for the latest commit. Push runs to `main` or `develop` (releases, hotfixes) are never cancelled.

## Configuration

The workflow uses a single top-level `concurrency` block:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

## Trigger matrix

| Trigger | Concurrency group key | Cancels in-progress? |
|---|---|---|
| `pull_request` | `CI-<PR number>` | **Yes** — older commit's run is cancelled when a new commit is pushed |
| `push` to `main` / `develop` | `CI-refs/heads/main` | **No** — release runs always complete |

## Rules

- Each pull request has at most one active run per workflow at any time.
- Merges and direct pushes to `main` or `develop` always run to completion.
- No per-job concurrency groups are needed; the top-level group covers all jobs.
