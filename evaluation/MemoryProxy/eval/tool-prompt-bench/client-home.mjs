import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const allowed = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMDATA", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "TERM", "COLORTERM", "NO_COLOR", "LANG", "LC_ALL", "TZ",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS",
  "CLAUDE_CODE_GIT_BASH_PATH",
]);

export function clientRuntimeEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => allowed.has(name.toUpperCase())));
}

export function isolatedClientEnvironment(source, home, client) {
  if (!["codex", "claude-code"].includes(client)) throw new Error("Unknown CLI client");
  const root = resolve(home);
  const paths = {
    HOME: root, USERPROFILE: root,
    APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
    XDG_CONFIG_HOME: join(root, "xdg", "config"), XDG_DATA_HOME: join(root, "xdg", "data"),
    XDG_STATE_HOME: join(root, "xdg", "state"), XDG_CACHE_HOME: join(root, "xdg", "cache"),
    TEMP: join(root, "tmp"), TMP: join(root, "tmp"), TMPDIR: join(root, "tmp"),
    ...(client === "codex"
      ? { CODEX_HOME: join(root, "codex"), CODEX_SQLITE_HOME: join(root, "codex", "sqlite") }
      : { CLAUDE_CONFIG_DIR: join(root, "claude-config") }),
  };
  // Windows environment names are case-insensitive; remove inherited aliases too.
  const overridden = new Set(Object.keys(paths));
  const environment = Object.fromEntries(Object.entries(clientRuntimeEnvironment(source))
    .filter(([name]) => !overridden.has(name.toUpperCase())));
  return { ...environment, ...paths };
}

// Claude Code asks Git for repository status during startup. Evaluation
// workspaces may be nested under the harness repository without containing
// their own `.git`, so Git would otherwise walk upward and expose the harness
// status as paths such as `../../..`. Keep discovery inside the case workspace.
export function limitGitDiscoveryToWorkspace(environment, workspace) {
  // Git ignores a ceiling equal to its starting directory. Stop before the
  // parent instead; a real repository at the workspace root remains usable.
  environment.GIT_CEILING_DIRECTORIES = dirname(resolve(workspace)).replaceAll("\\", "/");
  return environment;
}

export function prepareClientHome(environment) {
  for (const name of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME",
    "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TEMP", "TMP", "TMPDIR",
    "CODEX_HOME", "CODEX_SQLITE_HOME", "CLAUDE_CONFIG_DIR"]) {
    if (environment[name]) mkdirSync(environment[name], { recursive: true });
  }
}
