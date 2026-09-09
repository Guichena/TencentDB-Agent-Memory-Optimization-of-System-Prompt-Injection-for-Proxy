import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDualClientConfig } from "../eval/tool-prompt-bench/dual-client-plan.js";
import { managedEnvironment } from "../eval/tool-prompt-bench/managed-eval-config.js";

const submissionRoot = fileURLToPath(new URL("../../../", import.meta.url));
const evaluationRoot = join(submissionRoot, "evaluation");
const examplePath = join(submissionRoot, "scripts/final5-evaluation.example.json");
const temporaryRoots: string[] = [];
const sharedIdentity = {
  TDAI_MEMORY_USER_KEY: "memory-test-key",
  TDAI_SPACE_ID: "test-space",
  TDAI_TEAM_ID: "test-team",
  TDAI_AGENT_ID: "test-agent",
  TDAI_TASK_ID: "test-task",
};
const values = {
  ...sharedIdentity,
  TDAI_CODEX_UPSTREAM_URL: "https://codex.example.test/v1",
  TDAI_CODEX_PROVIDER_API_KEY: "codex-test-key",
  TDAI_CODEX_MODEL: "codex-test-model",
  TDAI_CODEX_PROXY_PORT: "18196",
  TDAI_CLAUDE_UPSTREAM_URL: "https://claude.example.test",
  TDAI_CLAUDE_PROVIDER_API_KEY: "claude-test-key",
  TDAI_CLAUDE_MODEL: "claude-test-model",
  TDAI_CLAUDE_PROXY_PORT: "18197",
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dual-client-config-"));
  temporaryRoots.push(root);
  const raw = JSON.parse(readFileSync(examplePath, "utf8"));
  const configPath = join(root, "experiment.json");
  writeFileSync(configPath, JSON.stringify({ ...raw, envFile: ".env" }));
  writeFileSync(join(root, ".env"), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  return readDualClientConfig(configPath);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shared evaluation env", () => {
  it("ships one template and points both clients at evaluation/.env", () => {
    const raw = JSON.parse(readFileSync(examplePath, "utf8"));
    expect(raw.envFile).toBe("../evaluation/.env");
    expect(raw).not.toHaveProperty("claudeEnvFile");
    expect(readdirSync(evaluationRoot).filter((name) => name.startsWith(".env") && name.endsWith(".example")))
      .toEqual([".env.example"]);
    const template = parseEnv(readFileSync(resolve(evaluationRoot, ".env.example"), "utf8"));
    expect(Object.keys(template).sort()).toEqual(Object.keys(values).sort());
  });

  it("loads both models and distinct ports from the same file", () => {
    const config = fixture();
    expect(config.clients.codex).toMatchObject({ model: values.TDAI_CODEX_MODEL, port: 18196 });
    expect(config.clients["claude-code"]).toMatchObject({ model: values.TDAI_CLAUDE_MODEL, port: 18197 });
  });

  it.each([
    ["codex", "TDAI_CODEX_PROVIDER_API_KEY", "TDAI_CODEX_UPSTREAM_URL"],
    ["claude-code", "TDAI_CLAUDE_PROVIDER_API_KEY", "TDAI_CLAUDE_UPSTREAM_URL"],
  ] as const)("selects %s credentials while sharing the Memory identity", (client, keyName, urlName) => {
    vi.stubEnv(keyName, "unrelated-inherited-key");
    vi.stubEnv(urlName, "https://unrelated.example.test");
    const env = managedEnvironment(fixture(), client);
    expect(env).toMatchObject({
      ...sharedIdentity,
      NODE_USE_ENV_PROXY: "1",
      FINAL5_PROVIDER_API_KEY: values[keyName],
      FINAL5_UPSTREAM_URL: values[urlName],
    });
    expect(process.env[keyName]).toBe("unrelated-inherited-key");
  });
});
