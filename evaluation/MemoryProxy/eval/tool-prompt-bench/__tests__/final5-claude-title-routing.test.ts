import { describe, expect, it } from "vitest";
import { classifyCcRequest as classifyBaseline } from "../../../../../implementations/baseline/MemoryProxy/src/common/cc-request-classifier.js";
import { classifyCcRequest as classifyV4 } from "../../../../../implementations/final/MemoryProxy/src/common/cc-request-classifier.js";

const classifiers = [classifyBaseline, classifyV4];

describe("Claude session-title routing", () => {
  it("keeps current Claude title requests outside the main session state", () => {
    const title = {
      tools: [],
      stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "<session>Case</session>" }] }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
      },
    };
    for (const classify of classifiers) expect(classify(title)).toBe("sidequery");
  });

  it("does not misclassify an ordinary no-tool main request", () => {
    const main = {
      stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "Implement the task" }] }],
    };
    for (const classify of classifiers) expect(classify(main)).toBe("main");
  });
});
