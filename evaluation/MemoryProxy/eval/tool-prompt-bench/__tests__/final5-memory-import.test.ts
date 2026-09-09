import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importFinal5Memory, makeFinal5MemoryImportRoutes } from "../../../../../implementations/final/MemoryCore/src/gateway/final5-memory-import.js";

const payload = () => ({
  id: "experiment-memory", layer: "l1", memory_type: "episodic", content: "Frozen text",
  content_sha256: createHash("sha256").update(JSON.stringify("Frozen text")).digest("hex"),
  team_id: "team", agent_id: "agent", user_id: "user", session_id: "restore",
});

function fixture(dropWrite = false, writeAccepted = true) {
  let row: Record<string, unknown> | undefined;
  let writes = 0;
  const deps = {
    getStore: () => ({
      queryL1Records: async () => row ? [row] : [],
      upsertL1: async (value: Record<string, unknown>) => {
        writes++;
        await Promise.resolve();
        if (!dropWrite) row = { record_id: value.id, content: value.content, type: value.type,
          team_id: value.teamId, agent_id: value.agentId, user_id: value.userId };
        return writeAccepted;
      },
    }),
    getEmbedding: () => undefined,
  };
  return { run: (body: unknown) => importFinal5Memory(body, {} as never, "request", deps as never), writes: () => writes };
}

describe("Final5 Memory restore", () => {
  it("does not expose import routes when disabled", () => {
    expect(makeFinal5MemoryImportRoutes(false)).toEqual({});
  });
  it("reads back content and reuses identical retry without writing again", async () => {
    const f = fixture();
    expect((await f.run(payload())).code).toBe(0);
    expect((await f.run(payload())).code).toBe(0);
    expect(f.writes()).toBe(1);
  });
  it("rejects digest mismatch before writing", async () => {
    const f = fixture();
    expect((await f.run({ ...payload(), content: "changed" })).code).toBe(400);
    expect(f.writes()).toBe(0);
  });
  it("refuses to overwrite a different owner", async () => {
    const f = fixture();
    await f.run(payload());
    expect((await f.run({ ...payload(), agent_id: "other" })).code).toBe(409);
    expect(f.writes()).toBe(1);
  });
  it("does not certify a write that cannot be read back", async () => {
    expect((await fixture(true).run(payload())).code).toBe(500);
  });
  it("waits for an asynchronous write result and rejects a failed write", async () => {
    expect((await fixture(false, false).run(payload())).code).toBe(500);
  });
  it.each(["team_id", "user_id", "memory_type"])("rejects an existing record with a different %s", async (field) => {
    const f = fixture();
    expect((await f.run(payload())).code).toBe(0);
    expect((await f.run({ ...payload(), [field]: field === "memory_type" ? "instruction" : "other" })).code).toBe(409);
    expect(f.writes()).toBe(1);
  });
});
