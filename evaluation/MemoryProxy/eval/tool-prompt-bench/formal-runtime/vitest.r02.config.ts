import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const memoryProxyRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.ts",
      "packages/**/src/__tests__/**/*.test.ts",
      "packages/**/src/**/__tests__/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@context-proxy/cost-guard": resolve(
        memoryProxyRoot,
        "packages/cost-guard/src/index.ts",
      ),
    },
  },
});
