# test100 execution

## Current status (2026-09-08)

Data preparation and native workspace preview pass. Formal execution has **not
started**. A restore bundle is an import input, not an import receipt. The
HTTP evidence capture, binding compilation and provider usage aggregation are
implemented and connected to the dual runner. They pass local HTTP/fixture
integration tests, not a live model campaign. Runtime asset import and the older
service history/catalog readiness integration remain blocking.

Current prepared directory: `runs/final5-test100-20260908-v2/`.
The earlier directory is superseded because the live neighbor descriptions
were updated during preparation. No execution receipts were produced there.

- `inputs/campaign.json`: 100 keep IDs, repeats=1, 200 slots per client.
- `inputs/workspaces.json`: 100 original workspace bindings, unchanged base SHA.
- `inputs/evaluation.json`: both clients, `server_team` then `V4`.
- `inputs/test100/`: frozen copy of the selected author data and catalog; later
  edits of live author files do not change these experiment inputs.
- `inputs/restore-bundle.json`: 66 Memory records, the declared 240 searchable
  Skills (including neighbor distractors), 20 resource files. No Cases/Gold.
- Native preview: all 100 Git workspaces and all 100 catalogs ready.
- Execute attempt: rejected before running cases because service snapshots do
  not implement the existing runner's evaluation input/capture integration.

The existing services on 8096 and 8097 both reported `v4-compact`; neither is
silently reused as baseline. They were not stopped or changed.

## Prepare a new run

From the submission root:

```powershell
.\scripts\prepare-final5-test100.ps1 -OutputRoot .\runs\final5-test100-new
.\scripts\run-final5-evaluation.ps1 -Config .\runs\final5-test100-new\inputs\evaluation.json -Mode preview
```

The preparation wrapper synchronizes descriptions from current test100 assets,
validates the author dataset, computes `loadFinal5Dataset(test100/teams)` digest,
filters the workspace manifest, and prepares the asset-only bundle. It does not
modify the original 1560 dataset or its catalog. The sync script no longer
rewrites author assets from a hardcoded description table. Changed catalog
content gets a new digest.

Dual `preview` displays the service/config checks. For the actual workspace
preview, invoke `run-final5-native-campaign.ts` with `FINAL5_PREVIEW=1` and the
`FINAL5_PLAN`, `FINAL5_WORKSPACE_MANIFEST`, `FINAL5_TEAMS_ROOT`, and
`FINAL5_SKILL_CATALOG_BINDINGS` paths from the generated config.

## Runtime import still required

The old `formal-assets/build-frozen-restore-plan.ts` consumes the old frozen
world schema; it cannot consume this new bundle directly. Neither
`memory-bridge` nor `skill-bridge` is a dataset import API.

Required adapter steps, not yet implemented end to end:

1. Create experiment-specific runtime identities and persist actual returned
   team/agent/task IDs. Do not invent runtime IDs from dataset IDs.
2. Import all 66 Memory records into the runtime store. Current Core has no
   `/v3/formal-bench/import-memory` implementation; `atomic/update` cannot create
   missing L1 records. This needs a common store import adapter, not a bypassed
   health check.
3. Create Skills through `/v3/skill/create` with entry content and `resources`.
   Source `files[]` become `{path, content, encoding: "utf-8"}` resources.
   Preserve listing names/descriptions and declared neighbor visibility.
4. Read back every Skill body and resource and verify exact bytes. Record real
   returned IDs; replace `runtime-default:...` listing IDs with those IDs and
   recompute catalog hashes. A prepared bundle does not prove this happened.
5. Write verified runtime bindings for the dataset digest. Point config
   `runtimeBindings` to that file; the dual runner passes it as
   `FINAL5_RUNTIME_BINDINGS`. Each `teams[]` row needs `datasetTeamId`, `spaceId`,
   `teamId`, `agentId`, and optional `taskId`; the root needs `datasetDigest` and
   `verified: true`. That flag must reflect actual restore/readback, not be
   manually asserted to bypass import.
6. Install the same history/catalog input and passive observation adapter for
   both service snapshots. Record actual provider injection, completions, full
   bound tool attempts/responses, and unbound malformed intents. Maintain equal
   asset state between cases and variants.

The native runner now refuses test100 execution without verified per-team
bindings; it no longer silently maps ten teams onto one environment identity.
No additional CLI execution permission restrictions were added.

## Metric implementation

`final5-metrics-report.ts` consumes normalized evidence plus compiled chain Gold
and runtime contracts. It checks dataset/client/case identity and author label
and sequence, scores the entire episode, and produces per-case facts,
ECR/FCR/TSR, Complete/Strict, BSA/Pair Exact, Overcall, ToolSPL details, Wilson
intervals, and paired Team bootstrap for selected binary metrics. Missing
evidence remains unknown; usage absence does not remove behavior evidence.
Pair Exact requires intent coverage on both variants.

The existing frozen scorer keeps its old default for compatibility; only
`observationWindow: "full-episode"` implements this campaign's observation
window. The new report always selects that mode.

`collect-final5-evidence.ts` now reads per-attempt HTTP artifacts, compiles Gold
itself, and writes normalized evidence, Case/Pair scores, comparison JSON and
Markdown. It is called automatically after both stages of a client finish.
The observer is preloaded before server imports and enabled only for managed
experiment processes. Both snapshots have the same opt-in middleware hook.
Incoming model attempts and Core fanout are separate; scoring uses the incoming
attempt once and the actual response returned to the client.

Bindings check search-result ID membership, version from the same search item,
the viewed Skill ID, manifest resource path, and any explicit resource version.
The compiler supports all six sequence shapes in the frozen 100-case dataset.
Provider usage supports Responses, Chat Completions and Anthropic JSON/SSE.
Cumulative usage updates are merged, never added as separate requests.

Main usage counts successful provider requests on paired, behavior-complete
Cases. Failed upstream requests are excluded from main totals. Raw failures and
counts are retained for diagnosis; `costAllAttempts` is a separate diagnostic,
not the primary comparison. Exhausted infrastructure failures remain unknown,
not no-call. Wrong tool/arguments from normal model execution are not excluded.

Still missing: target identity scoring, static-text token ledger, and remaining
diagnostic aggregates. HTTP-only capture cannot certify the absence of malformed
CLI intentions, so Pair Exact remains unavailable on this input. External
Knowledge calls outside the instrumented Proxy need their own observer before
claiming full-family coverage. Full runner typechecking also still encounters
the older tiktoken/harness/profile problems; focused capture/scoring checks pass.
The output explicitly marks these gaps. Do not fill them with zero or claim the
old diagnostic `final5-batch-report.ts` supplies them.

Offline recalculation (use a fresh report output directory):

```powershell
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs evaluation/MemoryProxy/eval/tool-prompt-bench/collect-final5-evidence.ts runs/final5-test100-20260908-v2/inputs/test100/teams runs/final5-test100-20260908-v2/codex codex runs/final5-test100-20260908-v2/codex/report
```

This requires actual `execution.json` and `attempt-capture.json` /
`http-events.jsonl` artifacts. It cannot recover missing observations from old
runs. The prepared run directory currently has no execution receipts.

Only start the full campaign after import/readback and a fixed small paired
collection can be recalculated from raw evidence. Do not change Gold or select
best attempts based on model performance.
