import { expect, it } from "vitest";
import { createHttpCapture } from "../final5-http-capture.js";
import { encodeFrozenSkillCatalog } from "../../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";

it("exempts title requests but still validates main requests in the same session", async () => {
  const catalog = encodeFrozenSkillCatalog({
    caseId: "case", catalogId: "catalog", catalogSha256: "a".repeat(64),
    skills: [{ order: 0, runtimeSkillId: "skill", runtimeName: "frozen_skill", description: "Frozen description" }],
  });
  let calls = 0;
  const capture = createHttpCapture(() => {}, async () => {
    calls++;
    return new Response("ok");
  }, true);
  const run = async (content: string, tools: unknown[] = []) => {
    const body = JSON.stringify({ model: "test", stream: true, tools, messages: [{ role: "user", content }] });
    const ctx = {
      req: { path: "/v1/messages", method: "POST",
        header: (name: string) => name === "x-tdai-skill-catalog" ? catalog : "same-session",
        raw: new Request("http://localhost/v1/messages", { method: "POST", body }) },
      res: new Response(),
    };
    await capture.middleware(ctx, async () => {
      ctx.res = await capture.fetch("http://provider/v1/messages", { method: "POST", body });
    });
    return ctx.res.text();
  };
  const title = "Write the title in the predominant language of the session";
  await expect(run(title)).resolves.toBe("ok");
  await expect(run("Perform the case")).rejects.toThrow("FINAL5_INPUT_NOT_READY");
  await expect(run(title, [{ name: "eval_protocol_probe" }])).rejects.toThrow("FINAL5_INPUT_NOT_READY");
  await expect(run("available_skills tdai_memory_tools frozen_skill Frozen description")).resolves.toBe("ok");
  expect(calls).toBe(2);
});
