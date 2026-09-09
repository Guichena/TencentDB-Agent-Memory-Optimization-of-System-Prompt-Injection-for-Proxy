import { afterEach, expect, it, vi } from "vitest";
import { runClientStages, runFinal5Dual, assertExecutionOutcome } from "../eval/tool-prompt-bench/run-final5-dual.js";
import { resolveConfigPath } from "../eval/tool-prompt-bench/dual-client-plan.js";
import { resolve } from "node:path";

it("fails single-case execution while allowing batch diagnostics to remain available", () => {
  expect(() => assertExecutionOutcome(1, true)).toThrow(/Single-case execution failed/);
  expect(() => assertExecutionOutcome(0, true)).not.toThrow();
  expect(() => assertExecutionOutcome(1, false)).not.toThrow();
});

it("resolves both relative path separator formats from the configuration directory", () => {
  const base = resolve("relocated repo", "runs", "trial");
  expect(resolveConfigPath(base, "inputs\\campaign.json")).toBe(resolve(base, "inputs/campaign.json"));
  expect(resolveConfigPath(base, "../../evaluation/.env")).toBe(resolve(base, "../../evaluation/.env"));
});

afterEach(() => vi.unstubAllEnvs());

it.each([[true, false, ["server_team"]], [false, true, ["V4"]], [false, false, ["server_team", "V4"]]] as const)(
  "selects the requested stages baseline=%s V4=%s", async (baseline, v4, expected) => {
    const seen: string[] = [];
    await runClientStages("codex", async (_, variant) => { seen.push(variant); }, baseline, v4);
    expect(seen).toEqual(expected);
  });

it("quick preview skips source inspection and chooses a fresh output directory", async () => {
  vi.stubEnv("FINAL5_QUICK", "1");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const config = new URL("../../../scripts/final5-evaluation.example.json", import.meta.url);
    await runFinal5Dual((await import("node:url")).fileURLToPath(config), "preview", false, true, false, "codex");
    const result = JSON.parse(log.mock.calls.at(-1)![0]);
    expect(result.sourceChecks).toBe("skipped");
    expect(result.phasesPerClient).toEqual(["server_team"]);
    expect(Object.keys(result.clients)).toEqual(["codex"]);
    expect(result.outputRoot).toMatch(/quick-[0-9a-f-]+$/);
  } finally { log.mockRestore(); }
});
