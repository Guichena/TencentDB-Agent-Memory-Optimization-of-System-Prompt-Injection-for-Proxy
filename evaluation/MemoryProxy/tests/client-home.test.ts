import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isolatedClientEnvironment, limitGitDiscoveryToWorkspace, prepareClientHome } from "../eval/tool-prompt-bench/client-home.mjs";
import { clientStagePaths, type DualClientConfig } from "../eval/tool-prompt-bench/dual-client-plan.js";

const testRoot = fileURLToPath(new URL("../../../runs/tests/client-home/", import.meta.url));
const attempts: string[] = [];
function attempt() {
  mkdirSync(testRoot, { recursive: true });
  const path = mkdtempSync(join(testRoot, "attempt-"));
  attempts.push(path);
  return path;
}
afterEach(() => {
  for (const path of attempts.splice(0)) {
    if (!resolve(path).startsWith(resolve(testRoot) + "/") && !resolve(path).startsWith(resolve(testRoot) + "\\")) throw new Error("Invalid test cleanup path");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("shared CLI runtime isolation", () => {
  it.each(["codex", "claude-code"] as const)("isolates every state directory for %s and can execute a child", (client) => {
    const root = attempt();
    const home = join(root, "runtime", "home");
    const source = { ...process.env, HOME: "parent-home", AppData: "parent-appdata", temp: "parent-temp",
      CODEX_HOME: "parent-codex", CLAUDE_CONFIG_DIR: "parent-claude", UNRELATED_SECRET: "do-not-inherit" };
    const env = isolatedClientEnvironment(source, home, client);
    prepareClientHome(env);
    expect(env.AppData).toBeUndefined();
    expect(env.temp).toBeUndefined();
    expect(env.UNRELATED_SECRET).toBeUndefined();
    expect(source.HOME).toBe("parent-home");
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
      ...(client === "codex" ? ["CODEX_HOME", "CODEX_SQLITE_HOME"] : ["CLAUDE_CONFIG_DIR"])]) {
      expect(env[key]?.startsWith(home)).toBe(true);
      expect(existsSync(env[key]!)).toBe(true);
    }
    expect(env[client === "codex" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"]).toBeUndefined();
    execFileSync(process.execPath, ["-e", "require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'child.txt'),'ok')"],
      { env, cwd: root, windowsHide: true });
    expect(readFileSync(join(home, "tmp", "child.txt"), "utf8")).toBe("ok");
    const retry = isolatedClientEnvironment(source, join(attempt(), "runtime", "home"), client);
    expect(retry.HOME).not.toBe(env.HOME);
  });

  it("preserves required transport and tool settings without provider credentials", () => {
    const env = isolatedClientEnvironment({ Path: "tool-path", HTTPS_PROXY: "http://proxy.test", NODE_EXTRA_CA_CERTS: "ca.pem",
      CLAUDE_CODE_GIT_BASH_PATH: "bash.exe", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret" }, join(attempt(), "home"), "claude-code");
    expect(env).toMatchObject({ Path: "tool-path", HTTPS_PROXY: "http://proxy.test", NODE_EXTRA_CA_CERTS: "ca.pem", CLAUDE_CODE_GIT_BASH_PATH: "bash.exe" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it.each(["codex", "claude-code"] as const)("keeps Git discovery inside an evaluation workspace for %s", (client) => {
    const parent = attempt();
    execFileSync("git", ["init", "--quiet", parent], { windowsHide: true });
    const workspace = join(parent, "workspace");
    mkdirSync(workspace, { recursive: true });
    const env = limitGitDiscoveryToWorkspace(isolatedClientEnvironment(process.env, join(attempt(), "home"), client), workspace);
    expect(env.GIT_CEILING_DIRECTORIES).toBe(resolve(parent).replaceAll("\\", "/"));
    const git = (cwd: string, environment: NodeJS.ProcessEnv) => spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, env: environment, encoding: "utf8", windowsHide: true });
    const unguarded = { ...env };
    delete unguarded.GIT_CEILING_DIRECTORIES;
    expect(resolve(git(workspace, unguarded).stdout.trim())).toBe(resolve(parent));
    expect(git(workspace, env).status).not.toBe(0);
    const nested = join(workspace, "src");
    mkdirSync(nested);
    expect(git(nested, env).status).not.toBe(0);
    execFileSync("git", ["init", "--quiet", workspace], { env, windowsHide: true });
    expect(resolve(git(workspace, env).stdout.trim())).toBe(resolve(workspace));
  });

  it("places managed workspaces inside the client and variant stage", () => {
    const outputRoot = attempt();
    const config = { outputRoot } as DualClientConfig;
    for (const client of ["codex", "claude-code"] as const) {
      for (const variant of ["server_team", "V4"] as const) {
        const paths = clientStagePaths(config, client, variant);
        expect(paths.workspaceRoot).toBe(join(outputRoot, client, variant, "workspaces"));
        expect(paths.receipt).toBe(join(outputRoot, client, variant, "execution.json"));
      }
    }
  });
});
