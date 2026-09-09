import type { Final5Record } from "./final5-formal-datasource.js";
import { RUNTIME_TOOL_CONTRACTS } from "../../contracts/runtime-tool-contracts.js";
import type { GoldChainStepV2, PrivateChainGoldV2, RuntimeToolContractV2 } from "./measurement-v2/types.js";

export const FINAL5_GOLD_COMPILER_VERSION = "final5-gold-binding-v1";
export const final5RuntimeContracts: RuntimeToolContractV2[] = RUNTIME_TOOL_CONTRACTS.map(contract => ({
  contractId: contract.id, family: contract.family, tool: contract.id, endpoint: contract.path,
  method: contract.method, operation: { kind: "none" }, acceptedStatusCodes: [200],
}));
const supported = new Set(["tdai_memory_search", "skill_search", "skill_view", "skill_view_by_id", "skill_files_read"]);

/** Author Gold is compiled offline; response membership is evaluated on actual trace bytes. */
export function compileFinal5Gold(row: Final5Record): PrivateChainGoldV2 {
  if (typeof row.gold.should_call !== "boolean" || !Array.isArray(row.gold.expected_sequence)) throw new Error("Invalid author Gold");
  const sequence = row.gold.expected_sequence as string[];
  if (row.gold.should_call !== (sequence.length > 0)) throw new Error("Gold label/sequence mismatch");
  const steps: GoldChainStepV2[] = sequence.map((tool, index) => {
    const runtime = RUNTIME_TOOL_CONTRACTS.find(contract => contract.id === tool);
    if (!runtime || !supported.has(tool)) throw new Error("Unsupported Final5 Gold tool: " + tool);
    const step: GoldChainStepV2 = { stepId: "step-" + index, family: runtime.family, tool, endpoint: runtime.path,
      method: runtime.method, operation: { kind: "none" }, runtimeContractId: tool, terminal: index === sequence.length - 1,
      arguments: { required: runtime.requiredArgs, forbidden: runtime.forbiddenArgs, nonEmptyStrings: runtime.requiredArgs, positiveIntegersIfPresent: ["version"] }, bindings: [] };
    if (tool === "skill_view") {
      const ids = row.gold.target_asset_ids;
      const skills = row.assets.skills;
      const target = Array.isArray(ids) && ids.length === 1 && Array.isArray(skills) ? skills.find(asset => asset.id === ids[0]) : undefined;
      if (!target || typeof target.name !== "string") throw new Error("Listed Skill view requires an unambiguous author asset name");
      step.arguments!.exact = [{ path: "skill_name", value: target.name }];
    }
    if (tool === "skill_view_by_id") {
      if (sequence[index - 1] !== "skill_search") throw new Error("Skill ID view requires a prior search in this dataset");
      step.bindings = [
        { argumentPath: "skill_id", priorStepId: "step-" + (index - 1), responsePath: "data.items.*.skill_id", comparison: "one_of" },
        { argumentPath: "version", priorStepId: "step-" + (index - 1), responsePath: "data.items", comparison: "exact", optionalArgument: true,
          responseItemFilter: { argumentPath: "skill_id", keyField: "skill_id", valueField: "version" } },
      ];
    }
    if (tool === "skill_files_read") {
      if (!["skill_view", "skill_view_by_id"].includes(sequence[index - 1])) throw new Error("Resource read requires a prior view");
      step.bindings = [
        { argumentPath: "skill_id", priorStepId: "step-" + (index - 1), responsePath: "data.skill_id", comparison: "exact" },
        { argumentPath: "path", priorStepId: "step-" + (index - 1), responsePath: "data.manifest.*.path", comparison: "one_of" },
        { argumentPath: "version", priorStepId: "step-" + (index - 1), responsePath: "data.version", comparison: "exact", optionalArgument: true },
      ];
      const paths = row.gold.target_resource_paths;
      if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== "string") throw new Error("Resource Gold must declare one required path");
      step.arguments!.exact = [{ path: "path", value: paths[0] }];
    }
    return step;
  });
  return { evaluationSchemaVersion: 2, caseId: row.case_id, expectation: row.gold.should_call ? "tool" : "no-tool",
    attemptBudget: Number.MAX_SAFE_INTEGER, allowedSequences: steps.length ? [{ sequenceId: "author-sequence", steps }] : [] };
}
