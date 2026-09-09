import { describe, expect, it } from "vitest";
import { injectCodexAssets as baseline } from "../../../../../implementations/baseline/MemoryProxy/src/codexHandler.js";
import { injectCodexAssets as final } from "../../../../../implementations/final/MemoryProxy/src/codexHandler.js";

describe.each([["baseline", baseline], ["V4", final]] as const)("%s Codex input layout", (_name, inject) => {
  it("keeps additional_tools and injects into the following developer message", () => {
    const body = { input: [
      { type: "additional_tools", role: "developer", tools: [] },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Existing instructions" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Task" }] },
    ] };
    const before = JSON.stringify(body);
    const result = inject(body, { raw: "<available_skills>frozen</available_skills>" });
    const input = result.input as typeof body.input;
    expect(input[0]).toBe(body.input[0]);
    expect(input[2]).toBe(body.input[2]);
    expect(JSON.stringify(input[1])).toContain("frozen");
    expect(JSON.stringify(body)).toBe(before);
  });
});
