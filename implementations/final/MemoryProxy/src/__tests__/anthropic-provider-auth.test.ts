import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { handleAnthropicMessages } from "../anthropicHandler.js";
import { DEFAULT_CONFIG } from "../config.js";
const auth = vi.hoisted(() => vi.fn(async () => ({ rejected: false, userId: "memory-user" })));
vi.mock("../auth.js", () => ({ verifyUserKey: auth, isAuthEnabled: () => true }));
it("authenticates Memory with its own header, not the provider credential", async () => {
  const app = new Hono();
  app.post("/claude-code/space/v1/messages", c => handleAnthropicMessages(c, structuredClone(DEFAULT_CONFIG)));
  const response = await app.request("/claude-code/space/v1/messages", { method: "POST", headers: {
    "x-api-key": "provider-secret", "x-tdai-user-key": "memory-secret", "content-type": "application/json",
  }, body: "invalid-json" });
  expect(response.status).toBe(400);
  expect(auth).toHaveBeenLastCalledWith("memory-secret", "space");
});
it("retains legacy single-key authentication", async () => {
  const app = new Hono();
  app.post("/claude-code/space/v1/messages", c => handleAnthropicMessages(c, structuredClone(DEFAULT_CONFIG)));
  await app.request("/claude-code/space/v1/messages", { method: "POST", headers: { "x-api-key": "legacy-key" }, body: "invalid-json" });
  expect(auth).toHaveBeenLastCalledWith("legacy-key", "space");
});
