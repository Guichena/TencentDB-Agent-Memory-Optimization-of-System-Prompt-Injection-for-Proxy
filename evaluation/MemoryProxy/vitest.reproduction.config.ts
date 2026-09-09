import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The submitted Final5 workflow. Historical formal-world tests require a separate frozen repository.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "eval/tool-prompt-bench/__tests__/**/*.test.ts",
      "eval/tool-prompt-bench/measurement-v2/__tests__/final5-*.test.ts",
      "eval/tool-prompt-bench/measurement-v2/__tests__/case-chain-scorer.test.ts",
      "eval/tool-prompt-bench/measurement-v2/__tests__/aggregate.test.ts",
      "eval/tool-prompt-bench/measurement-v2/__tests__/artifacts.test.ts",
    ],
    testTimeout: 15000,
    maxWorkers: 2,
  },
});
