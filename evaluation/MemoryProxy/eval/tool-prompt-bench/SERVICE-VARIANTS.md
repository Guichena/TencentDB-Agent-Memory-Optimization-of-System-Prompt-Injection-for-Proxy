# Current service pair

This file is the source of truth for the next baseline-versus-final experiment.

| Role | Revision | Working branch or state |
| --- | --- | --- |
| Baseline | `97f94654280b2932c35ba4806a491999ed244cc9` | detached, original `work/server-team` snapshot |
| Final | `95339ab9137c04363969ee9c490f485f2b72ffb4` | `codex/task1-v4-architecture-upgrade` |
| Shared evaluation | recorded by each run manifest | `codex/task1-final-evaluation` |

The baseline and final revisions are service code only. Datasets, runners,
scorers, experiment manifests, traces, and archived evidence live on the shared
evaluation branch. A run must record all three exact revisions and must not use
a service-tree label as a substitute for a Git commit.

## Compatibility note

The old V0-V3 profile workflow, its `5299c00` freeze, stage reports, and captured
Variant artifacts have been removed. Do not reconstruct or report that output
as the `97f9465` baseline or the final V4 result.

The current formal preflight expects evaluation-only health fields and profile
switching from its integration code line. Raw `97f9465` and raw final service
revisions do not expose the same interface. Before launching the model campaign,
the shared runner needs a service-pair adapter that observes both services from
outside their production trees, or equivalent temporary evaluation overlays for
each revision. Until that adapter passes a one-case paired smoke, dataset and
scoring validation alone do not make the service-pair experiment runnable.
