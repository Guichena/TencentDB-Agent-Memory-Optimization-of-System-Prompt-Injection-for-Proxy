# Experiment run directories

Generated data belongs under the submission's `runs/` directory, separate from
the sole input dataset in `evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/`
(39 teams, 1,140 cases).
Existing run directories are not moved or rewritten.

## Final5

From the submission root:

```powershell
.\scripts\run-final5-evaluation.ps1 -Config .\scripts\final5-evaluation.example.json -Mode preview
.\scripts\run-final5-evaluation.ps1 -Config .\scripts\final5-evaluation.example.json -Mode check
.\scripts\run-final5-evaluation.ps1 -Config .\scripts\final5-evaluation.example.json -Mode execute
```

The example selects four cases. Both clients run baseline and V4. Change
`outputRoot` for a new experiment; use `-Resume` only for the same inputs and
runner version. Runs created before the runtime-isolation change need a new
output root, not resume.

```text
runs/final5-small-compare/
  experiment.json
  workers/
  codex/                         # also claude-code/
    paired.json
    server_team/                 # also V4/
      execution.json
      execution.json.checkpoint/
      execution.json.evidence/
        attempt-<unique>/
          runtime/home/          # ephemeral CLI state
          <raw events and capture status>
      workspaces/                # ephemeral per-attempt task workspaces
      .cache/workspace-validation/
      proxy-<mode>-<unique>/
```

Each attempt, including retries, gets fresh CLI state. Both clients redirect
Home, AppData, XDG config/data/state/cache, and temporary directories. Codex
also redirects its configuration and SQLite directories. Only allowlisted
runtime variables are inherited; the runner adds the selected credentials.
Executables are resolved before the child environment is isolated.

Both case runners limit Git discovery at the workspace parent. Plain source
snapshots must not discover the submission repository above them or inject its
status and parent-relative paths into model requests. Real Git repositories at
the case workspace root remain available. This is a Git discovery boundary,
not a restriction on arbitrary file access by the CLI.

Final5 cleans per-attempt runtime and task workspace directories on normal
completion or handled failure, retaining raw evidence. An abrupt controller
or machine shutdown can leave temporary directories. They are never reused
as a new attempt's Home. Execution permissions are unchanged.

Standalone `run-final5-native-campaign.ts` defaults to repository-local inputs
and `runs/final5-native/`. Explicit `FINAL5_*` path overrides remain supported.

## CLI smoke

```powershell
node .\scripts\run-dual-cli-smoke.mjs
```

Smoke output is under `runs/cli-smoke/<UTC-date>/<run-id>/`. Each client has
its logs and `runtime/home/` inside its own directory. Smoke retains its Home
for diagnostics. It reuses the same isolation helper as Final5 but does not
create task workspaces or score answers. Existing Proxy services are required.
Duplicate run IDs are rejected rather than overwriting previous evidence.

`runs/` is Git-ignored. Runtime directories can contain sensitive CLI state;
do not publish them as evaluation results. This isolation is for reproducibility,
not an operating-system security boundary.
