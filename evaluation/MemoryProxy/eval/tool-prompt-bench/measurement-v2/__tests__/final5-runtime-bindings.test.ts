import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadFinal5RuntimeBindings } from "../../final5-runtime-bindings.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function write(teams: unknown[], digest = "digest", verified = true) {
  const directory = mkdtempSync(join(tmpdir(), "final5-bindings-test-"));
  directories.push(directory);
  const path = join(directory, "bindings.json");
  writeFileSync(path, JSON.stringify({ teams, datasetDigest: digest, verified }));
  return path;
}
const team = { datasetTeamId: "a", spaceId: "space", teamId: "team-a", agentId: "agent-a" };
it("loads actual per-team identity mappings", () => {
  expect(loadFinal5RuntimeBindings(write([team]), "digest", ["a"]).get("a")).toEqual({ spaceId: "space", teamId: "team-a", agentId: "agent-a" });
});
it("rejects all teams mapped onto a shared identity", () => {
  expect(() => loadFinal5RuntimeBindings(write([team, { ...team, datasetTeamId: "b" }]), "digest", ["a", "b"])).toThrow(/share one/);
});
it("rejects a stale or unverified import", () => {
  expect(() => loadFinal5RuntimeBindings(write([team], "old"), "digest", ["a"])).toThrow(/verified restore/);
  expect(() => loadFinal5RuntimeBindings(write([team], "digest", false), "digest", ["a"])).toThrow(/verified restore/);
});
it("rejects incomplete team coverage", () => {
  expect(() => loadFinal5RuntimeBindings(write([team]), "digest", ["a", "b"])).toThrow(/coverage incomplete/);
});
it("quick mode accepts old restore metadata while retaining actual identities", () => {
  expect(loadFinal5RuntimeBindings(write([team], "old", false), "digest", ["a"], false).get("a")?.teamId).toBe("team-a");
});
