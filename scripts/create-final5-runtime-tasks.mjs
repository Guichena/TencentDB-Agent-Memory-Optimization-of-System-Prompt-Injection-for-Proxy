import fs from "node:fs";
import path from "node:path";

const runRoot = process.argv[2] && path.resolve(process.argv[2]);
const coreUrl = process.argv[3];
if (!runRoot || !coreUrl) throw new Error("Usage: create-final5-runtime-tasks.mjs <run-root> <core-url>");

const identity = JSON.parse(fs.readFileSync(path.join(runRoot, "runtime-core", "identity.json"), "utf8"));
const bindingsPath = path.join(runRoot, "runtime-bindings.json");
const bindings = JSON.parse(fs.readFileSync(bindingsPath, "utf8"));
const journalPath = path.join(runRoot, "runtime-core", "task-restore.jsonl");
const journal = fs.existsSync(journalPath)
  ? fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${process.env.FINAL5_RESTORE_AUTH_TOKEN ?? "sdk-e2e-token"}`,
  "x-tdai-service-id": identity.serviceId,
  "x-tdai-user-key": identity.userKey,
};

async function post(pathname, body) {
  const response = await fetch(new URL(pathname, coreUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw new Error(`${pathname}: HTTP ${response.status}, code ${result.code}`);
  return result.data;
}

for (const binding of bindings.teams) {
  const key = `task:${binding.datasetTeamId}`;
  let task = journal.find((row) => row.key === key)?.value;
  if (!task) {
    task = await post("/v3/meta/task/create", {
      team_id: binding.teamId,
      creator_user_id: identity.receipt.data.user_id,
      agent_id: binding.agentId,
      title: `Final5 ${binding.datasetTeamId}`,
      description: "Frozen formal evaluation task binding",
      status: "running",
    });
    fs.appendFileSync(journalPath, JSON.stringify({ key, value: task }) + "\n");
  }
  const actual = await post("/v3/meta/task/get", { task_id: task.task_id });
  if (actual.team_id !== binding.teamId || actual.task_id !== task.task_id) {
    throw new Error(`Task readback mismatch for ${binding.datasetTeamId}`);
  }
  binding.taskId = task.task_id;
}

fs.writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2));
fs.appendFileSync(journalPath, JSON.stringify({ key: "task-restore-complete", value: { count: bindings.teams.length } }) + "\n");
console.log(JSON.stringify({ tasks: bindings.teams.length, bindingsPath }));
