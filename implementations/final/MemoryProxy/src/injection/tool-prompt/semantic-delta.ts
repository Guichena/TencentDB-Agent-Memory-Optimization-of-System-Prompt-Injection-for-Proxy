import type { PromptIR, PromptIRTool } from "./prompt-ir.js";

export const PROMPT_SEMANTIC_DELTA_FIELDS = [
  "must-call",
  "no-call",
  "family-route",
  "when",
  "avoid",
  "contrast",
  "capability",
  "execution-contract",
] as const;

export type PromptSemanticDeltaField = (typeof PROMPT_SEMANTIC_DELTA_FIELDS)[number];

export interface PromptSemanticDelta {
  "must-call": readonly string[];
  "no-call": readonly string[];
  "family-route": readonly string[];
  when: readonly string[];
  avoid: readonly string[];
  contrast: readonly string[];
  capability: readonly string[];
  "execution-contract": readonly string[];
}

export interface AllowedPromptSemanticDelta {
  fields: readonly PromptSemanticDeltaField[];
  reason?: string;
}

const EMPTY: PromptSemanticDelta = {
  "must-call": [],
  "no-call": [],
  "family-route": [],
  when: [],
  avoid: [],
  contrast: [],
  capability: [],
  "execution-contract": [],
};

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function toolMap(ir: PromptIR): Map<string, PromptIRTool> {
  return new Map(ir.tools.map((tool) => [tool.toolId, tool]));
}

function changedToolIds(parent: PromptIR, child: PromptIR, project: (tool: PromptIRTool) => unknown): string[] {
  const before = toolMap(parent);
  const after = toolMap(child);
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => stable(project(before.get(id) ?? after.get(id)!)) !== stable(project(after.get(id) ?? before.get(id)!))).sort();
}

export function computePromptSemanticDelta(parent: PromptIR, child: PromptIR): PromptSemanticDelta {
  const before = toolMap(parent);
  const after = toolMap(child);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const delta: PromptSemanticDelta = { ...EMPTY };
  if (parent.capabilitySignature !== child.capabilitySignature) delta.capability = ["capability-bitmap"];
  for (const key of new Set([...Object.keys(parent.globalRules ?? {}), ...Object.keys(child.globalRules ?? {})])) {
    if (parent.globalRules?.[key] === child.globalRules?.[key]) continue;
    const field = key === "must-call" || key === "no-call" || key === "family-route" ? key : "execution-contract";
    delta[field] = [...delta[field], `global.${key}`];
  }
  for (const id of ids) {
    const left = before.get(id);
    const right = after.get(id);
    if (!left || !right) {
      delta["family-route"] = [...delta["family-route"], id];
      delta.capability = [...delta.capability, id];
      continue;
    }
    if (left.family !== right.family) delta["family-route"] = [...delta["family-route"], id];
    if (left.capability !== right.capability) delta.capability = [...delta.capability, id];
    if (left.when !== right.when) {
      delta.when = [...delta.when, id];
      if (/\bmust|required|always/i.test(`${left.when} ${right.when}`)) {
        delta["must-call"] = [...delta["must-call"], id];
      }
    }
    if (left.avoid !== right.avoid) {
      delta.avoid = [...delta.avoid, id];
      delta["no-call"] = [...delta["no-call"], id];
    }
    if (stable(left.contrasts) !== stable(right.contrasts)) delta.contrast = [...delta.contrast, id];
    if (stable({
      method: left.method,
      inputHint: left.inputHint,
      path: left.path,
      requiredArgs: left.requiredArgs,
      optionalArgs: left.optionalArgs,
      forbiddenArgs: left.forbiddenArgs,
      responseKind: left.responseKind,
      prerequisites: left.prerequisites,
      handoffs: left.handoffs,
      recovery: left.recovery,
      parameterProvenance: left.parameterProvenance,
      produces: left.produces,
      continueIf: left.continueIf,
      runtimeBindingSlots: left.runtimeBindingSlots,
      dynamicAssetSlots: left.dynamicAssetSlots,
    }) !== stable({
      method: right.method,
      inputHint: right.inputHint,
      path: right.path,
      requiredArgs: right.requiredArgs,
      optionalArgs: right.optionalArgs,
      forbiddenArgs: right.forbiddenArgs,
      responseKind: right.responseKind,
      prerequisites: right.prerequisites,
      handoffs: right.handoffs,
      recovery: right.recovery,
      parameterProvenance: right.parameterProvenance,
      produces: right.produces,
      continueIf: right.continueIf,
      runtimeBindingSlots: right.runtimeBindingSlots,
      dynamicAssetSlots: right.dynamicAssetSlots,
    })) {
      delta["execution-contract"] = [...delta["execution-contract"], id];
    }
  }
  return delta;
}

export function assertPromptSemanticDelta(
  parent: PromptIR,
  child: PromptIR,
  allowed: AllowedPromptSemanticDelta = { fields: [] },
): PromptSemanticDelta {
  const delta = computePromptSemanticDelta(parent, child);
  const allowedFields = new Set(allowed.fields);
  for (const field of PROMPT_SEMANTIC_DELTA_FIELDS) {
    if (delta[field].length > 0 && !allowedFields.has(field)) {
      throw new Error(`undeclared prompt semantic delta in ${field}: ${delta[field].join(", ")}`);
    }
  }
  return delta;
}

export function isPromptSemanticDeltaEmpty(delta: PromptSemanticDelta): boolean {
  return PROMPT_SEMANTIC_DELTA_FIELDS.every((field) => delta[field].length === 0);
}

/** Utility for comparing the static IR unit stream independently of tool cards. */
