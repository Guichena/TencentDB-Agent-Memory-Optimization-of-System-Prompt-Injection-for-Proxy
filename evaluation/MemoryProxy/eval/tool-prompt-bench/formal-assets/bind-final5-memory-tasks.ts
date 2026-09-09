import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(process.argv[2]);
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const bundle = read("inputs/restore-bundle.json");
const bindings = JSON.parse(readFileSync(resolve(process.argv[3] ?? resolve(root, "runtime-bindings.json")), "utf8"));
const db = new DatabaseSync(resolve(root, "runtime-core/data/vectors.db"));
const proofs = [];
try {
  db.exec("PRAGMA busy_timeout=10000; BEGIN IMMEDIATE");
  for (const asset of bundle.memories) {
    const binding = bindings.teams.find((team: any) => team.datasetTeamId === asset.teamId);
    if (!binding?.taskId) throw new Error("Runtime task missing");
    const id = `${binding.teamId}:${asset.logicalAssetId}`;
    if (asset.layer === "l0") {
      const rows = db.prepare("SELECT * FROM l0_conversations WHERE record_id LIKE ? ORDER BY record_id").all(`${id}:%`);
      if (rows.length !== asset.messages.length || rows.some((row: any, index: number) =>
        row.message_text !== asset.messages[index].content
        || row.role !== asset.messages[index].role
        || row.team_id !== binding.teamId
        || row.agent_id !== binding.agentId)) {
        throw new Error(`Unexpected L0 Memory identity/content: ${id}`);
      }
      for (const row of rows as any[]) {
        if (row.task_id && row.task_id !== binding.taskId) throw new Error(`L0 Memory already bound to another task: ${row.record_id}`);
        db.prepare("UPDATE l0_conversations SET task_id=? WHERE record_id=?").run(binding.taskId, row.record_id);
        db.prepare("UPDATE l0_fts SET task_id=? WHERE record_id=?").run(binding.taskId, row.record_id);
        const after = db.prepare("SELECT message_text, task_id FROM l0_conversations WHERE record_id=?").get(row.record_id) as any;
        const indexed = db.prepare("SELECT message_text_original, task_id FROM l0_fts WHERE record_id=?").all(row.record_id) as any[];
        if (after?.message_text !== row.message_text || after?.task_id !== binding.taskId
          || indexed.length !== 1 || indexed[0].message_text_original !== row.message_text || indexed[0].task_id !== binding.taskId) {
          throw new Error(`L0 task binding readback failed: ${row.record_id}`);
        }
      }
      proofs.push({ id, taskId: binding.taskId,
        contentSha256: createHash("sha256").update(JSON.stringify(asset.messages)).digest("hex") });
      continue;
    }
    const row = db.prepare("SELECT * FROM l1_records WHERE record_id=?").get(id);
    if (!row || row.content !== asset.content || row.team_id !== binding.teamId || row.agent_id !== binding.agentId) {
      throw new Error(`Unexpected Memory identity/content: ${id}`);
    }
    if (row.task_id && row.task_id !== binding.taskId) throw new Error(`Memory already bound to another task: ${id}`);
    db.prepare("UPDATE l1_records SET task_id=? WHERE record_id=?").run(binding.taskId, id);
    db.prepare("UPDATE l1_fts SET task_id=? WHERE record_id=?").run(binding.taskId, id);
    const after = db.prepare("SELECT content, task_id FROM l1_records WHERE record_id=?").get(id)!;
    if (after.content !== asset.content || after.task_id !== binding.taskId) throw new Error("Task binding readback failed");
    const indexed = db.prepare("SELECT content_original, task_id FROM l1_fts WHERE record_id=?").all(id);
    if (indexed.length !== 1 || indexed[0].content_original !== asset.content || indexed[0].task_id !== binding.taskId) {
      throw new Error("Search index task binding readback failed");
    }
    proofs.push({ id, taskId: binding.taskId,
      contentSha256: createHash("sha256").update(JSON.stringify(after.content)).digest("hex") });
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally { db.close(); }
writeFileSync(resolve(root, "runtime-core/memory-task-bindings.json"), JSON.stringify({
  bundleSha256: bundle.bundleSha256, verified: true, proofs,
}, null, 2) + "\n");
console.log(JSON.stringify({ memories: proofs.length, taskBindingsVerified: true }));
