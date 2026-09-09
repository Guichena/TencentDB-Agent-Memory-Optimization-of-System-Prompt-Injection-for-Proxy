# Frozen Evaluation Contracts

`runtime-tool-contracts.ts` is the fixed tool specification used by Gold compilation and offline trace scoring. It contains API facts only, with no prompt rendering, injection or capability-selection implementation.

The file was extracted from the evaluation specification before removing the product source copy. `runtime-tool-contracts.sha256` records the SHA-256 of `JSON.stringify(RUNTIME_TOOL_CONTRACTS)` in declaration order. The contract test rejects accidental changes.

Do not regenerate this specification from the current final implementation during a run. A deliberate scoring-specification change requires a new evaluation version, an updated digest and new results. Baseline/final product tests import their implementations directly.
