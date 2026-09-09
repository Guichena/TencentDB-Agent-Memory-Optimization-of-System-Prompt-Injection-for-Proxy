import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GitValidationCache { directory: string; inputFingerprint: string }
interface Probe { isGit: boolean; commits: string[] }
const sha = /^[0-9a-f]{40}$/i;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// Only ordinary, self-contained repositories can reuse results. Linked worktrees,
// alternates and custom Git environments are checked live instead.
function repositoryStamp(path: string): string | undefined {
  if (Object.keys(process.env).some((key) => key.startsWith("GIT_") && key !== "GIT_PAGER")) return undefined;
  const root = join(path, ".git");
  try {
    if (!lstatSync(root).isDirectory() || existsSync(join(root, "commondir")) || existsSync(join(root, "objects/info/alternates"))) return undefined;
    const entries: unknown[] = [];
    const walk = (item: string): void => {
      const stat = lstatSync(item, { bigint: true });
      if (stat.isSymbolicLink() || entries.length > 4096) throw new Error("uncacheable repository");
      // Per-slot worktree bookkeeping and reflogs do not change object availability.
      // Ignore their effect on the root directory timestamps as well.
      entries.push(item === root ? [item, String(stat.dev), String(stat.ino)]
        : [item, String(stat.dev), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]);
      if (stat.isDirectory()) for (const name of readdirSync(item).sort()) {
        if (item === root && (name === "worktrees" || name === "logs")) continue;
        walk(join(item, name));
      }
    };
    walk(root);
    return hash(JSON.stringify(entries));
  } catch { return undefined; }
}

export function createWorkspaceGitProbe(rows: readonly unknown[], cache?: GitValidationCache) {
  const revisions = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    if (typeof value.repositoryPath !== "string" || typeof value.baseSha !== "string" || !sha.test(value.baseSha.trim())) continue;
    const path = resolve(value.repositoryPath.trim());
    const commits = revisions.get(path) ?? new Set<string>();
    commits.add(value.baseSha.trim().toLowerCase());
    revisions.set(path, commits);
  }
  const probes = new Map<string, Probe>();
  return (repositoryPath: string): Probe => {
    const path = resolve(repositoryPath);
    const previous = probes.get(path);
    if (previous) return previous;
    const requested = [...(revisions.get(path) ?? [])].sort();
    const result: Probe = { isGit: false, commits: [] };
    // Always ask Git to enforce current repository discovery and safe.directory rules.
    try {
      result.isGit = execFileSync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
    } catch { /* fail closed */ }
    const before = cache && result.isGit ? repositoryStamp(path) : undefined;
    const key = hash(JSON.stringify([1, cache?.inputFingerprint, path, requested, before]));
    const cachePath = cache && before ? join(cache.directory, key + ".json") : undefined;
    if (cachePath) {
      try {
        const saved = JSON.parse(readFileSync(cachePath, "utf8"));
        if (saved.key === key && JSON.stringify(saved.commits) === JSON.stringify(requested)) {
          result.commits = requested;
          probes.set(path, result);
          return result;
        }
      } catch { /* absent or damaged cache is a miss */ }
    }
    if (result.isGit && requested.length) {
      try {
        const output = execFileSync("git", ["-C", path, "cat-file", "--batch-check=%(objectname) %(objecttype)"], {
          input: requested.map((revision) => `${revision}^{commit}\n`).join(""), encoding: "utf8", windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"], maxBuffer: Math.max(1024 * 1024, requested.length * 256),
        }).trim().split(/\r?\n/);
        if (output.length === requested.length) result.commits = requested.filter((_, index) => /^[0-9a-f]{40} commit$/i.test(output[index]!));
      } catch { /* fail closed */ }
    }
    if (cachePath && cache && result.commits.length === requested.length && before === repositoryStamp(path)) {
      const temporary = cachePath + "." + randomUUID() + ".tmp";
      try {
        mkdirSync(cache.directory, { recursive: true });
        writeFileSync(temporary, JSON.stringify({ key, commits: result.commits }), { flag: "wx" });
        renameSync(temporary, cachePath);
      } catch { /* cache persistence must not change validation correctness */ }
      finally { try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best effort */ } }
    }
    probes.set(path, result);
    return result;
  };
}
