# Final5 Evaluation

This package contains datasets, frozen scoring contracts, runners, capture, scoring and evaluation tests. The directory name is retained so existing configuration paths continue to work.

- Product services: `../../implementations/baseline/MemoryProxy` and `../../implementations/final/MemoryProxy`.
- Frozen Gold and scoring specification: [contracts/](contracts/README.md).
- Evaluation code and data: [eval/tool-prompt-bench/](eval/tool-prompt-bench/README.md).
- Evaluation-specific tests: `tests/`; product tests live with each implementation.
- `config.example.yaml` remains an input template used by the evaluation scripts.

There is no product source, Docker image or Proxy start command in this package. Runtime protocol helpers and offline prompt harnesses import the final implementation explicitly; comparison tests import baseline and final explicitly. Gold and trace scoring import the frozen contract, independent of product prompt changes.

From the repository root:

```powershell
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
./scripts/verify-reproduction.ps1
npm --prefix evaluation/MemoryProxy run typecheck:contracts
```

`npm --prefix evaluation/MemoryProxy test` runs the supported Final5 regression suite. Historical formal-world tests use separate configurations and are outside this submission's acceptance scope. `typecheck:contracts` checks the frozen specification only, not the entire evaluation stack.

Offline tests do not establish that real model execution is ready.
