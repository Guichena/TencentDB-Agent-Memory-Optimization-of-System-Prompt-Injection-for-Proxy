import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rest = args.filter((x) => x !== "--apply");
if (rest.length > 1 || rest.some((x) => x.startsWith("--"))) {
  throw Error("Usage: node linux-reproduction/strip-claude-dotfiles.mjs [workspaces] [--apply]");
}
const bundle = resolve(root, rest[0] ?? "workspaces");
const sources = join(bundle, "sources");
if (!existsSync(join(bundle, "bundle.json")) || !existsSync(sources)) {
  throw Error("Expected workspaces/bundle.json and workspaces/sources; pass the bundle root if it is not ./workspaces");
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) {
      if (name === ".claude") out.push(path);
      else walk(path, out);
    } else if (name === "CLAUDE.md") out.push(path);
  }
}

const hits = [];
walk(sources, hits);
hits.sort();
for (const path of hits) {
  console.log(JSON.stringify({ path: relative(root, path).replaceAll("\\", "/"), apply }));
  if (apply) rmSync(path, { recursive: true, force: true });
}
console.log(JSON.stringify({
  bundle: relative(root, bundle).replaceAll("\\", "/") || ".",
  matched: hits.length,
  removed: apply ? hits.length : 0,
  note: apply
    ? "Removed .claude/ and CLAUDE.md from source snapshots. Baseline and V4 both bind these trees. Start a new RUN; do not treat this as the official first-250 table."
    : "Dry run. Re-run with --apply to delete. Official scoring keeps these files; this is an optional ablation.",
}));
