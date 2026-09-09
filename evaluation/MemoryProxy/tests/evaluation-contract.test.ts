import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { RUNTIME_TOOL_CONTRACTS } from "../contracts/runtime-tool-contracts.js";
import { final5RuntimeContracts } from "../eval/tool-prompt-bench/final5-gold-compiler.js";

it("keeps the frozen scoring specification independent of product prompt changes", () => {
  const expected = readFileSync(new URL("../contracts/runtime-tool-contracts.sha256", import.meta.url), "utf8").trim();
  expect(createHash("sha256").update(JSON.stringify(RUNTIME_TOOL_CONTRACTS)).digest("hex")).toBe(expected);
  expect(final5RuntimeContracts).toEqual(RUNTIME_TOOL_CONTRACTS.map(contract => ({
    contractId: contract.id, family: contract.family, tool: contract.id, endpoint: contract.path,
    method: contract.method, operation: { kind: "none" }, acceptedStatusCodes: [200],
  })));
});
