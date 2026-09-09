import fs from "node:fs";
import path from "node:path";

const runRoot = process.argv[2] && path.resolve(process.argv[2]);
const datasetDigest = process.argv[3];
if (!runRoot || !datasetDigest) {
  throw new Error("Usage: build-final5-runtime-bindings.mjs <run-root> <dataset-digest>");
}

const journalPath = path.join(runRoot, "runtime-core", "memory-restore.jsonl");
const rows = fs.readFileSync(journalPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const complete = rows.findLast((row) => row.key === "memory-restore-complete");
if (!complete || !Array.isArray(complete.value?.teams)) {
  throw new Error("Memory restore journal has no completion record");
}

const teams = complete.value.teams.map(({ datasetTeamId, spaceId, teamId, agentId }) => ({
  datasetTeamId,
  spaceId,
  teamId,
  agentId,
}));
if (teams.length !== 39 || new Set(teams.map((team) => team.datasetTeamId)).size !== teams.length) {
  throw new Error(`Expected 39 unique restored teams, received ${teams.length}`);
}

const output = path.join(runRoot, "runtime-bindings.json");
fs.writeFileSync(output, JSON.stringify({
  schemaVersion: "task1.final5-runtime-bindings.v1",
  datasetDigest,
  verified: true,
  teams,
}, null, 2));
console.log(JSON.stringify({ output, teams: teams.length }));
