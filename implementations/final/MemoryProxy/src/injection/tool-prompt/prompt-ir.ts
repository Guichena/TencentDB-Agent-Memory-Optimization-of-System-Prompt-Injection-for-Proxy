import { getRuntimeToolContracts } from "./runtime-contract.js";
import { getV4Decision } from "./selection-fidelity.js";
import { getV4ExecutionHint } from "./execution-hints.js";
import type {
  PromptPlane,
  RuntimeToolContract,
  ToolPromptFamily,
} from "./types.js";

export type PrerequisiteStrength = "required" | "conditional" | "none";
export type ParameterProvenance = "user" | "injected_asset" | "prior_tool_output";

export interface PromptIRPrerequisite {
  toolId: string;
  strength: PrerequisiteStrength;
  provenance: readonly ParameterProvenance[];
  producer?: string;
  outputFields?: readonly string[];
}

export interface PromptIRHandoffBinding {
  from: string;
  to: string;
  mode?: "schema";
}

export interface PromptIRHandoff {
  producerToolId: string;
  bindings: readonly PromptIRHandoffBinding[];
  strength: PrerequisiteStrength;
  sources: readonly ParameterProvenance[];
  allowDirectWhenAvailable: true;
}

export type PromptIRRecoveryTrigger =
  | "invalid-operation-or-schema"
  | "invalid-skill-id"
  | "invalid-skill-id-or-path"
  | "empty-semantic-result-with-open-gap";

export interface PromptIRRecovery {
  trigger: PromptIRRecoveryTrigger;
  actionToolIds: readonly string[];
  maxAttempts: 1;
  neverGuessReplacement: true;
  condition?: string;
}

export interface PromptIRTool {
  toolId: string;
  family: ToolPromptFamily;
  capability: string;
  plane: PromptPlane;
  when: string;
  inputHint?: string;
  avoid?: string;
  contrasts: readonly { otherTool: string; cue: string }[];
  method: RuntimeToolContract["method"];
  path: string;
  requiredArgs: readonly string[];
  optionalArgs: readonly string[];
  forbiddenArgs: readonly string[];
  responseKind: RuntimeToolContract["responseKind"];
  prerequisites: readonly PromptIRPrerequisite[];
  handoffs: readonly PromptIRHandoff[];
  recovery: readonly PromptIRRecovery[];
  parameterProvenance: Readonly<Record<string, readonly ParameterProvenance[]>>;
  produces: "discovery" | "instructions" | "content" | "answer";
  continueIf: string;
  runtimeBindingSlots: readonly string[];
  dynamicAssetSlots: readonly string[];
}

export interface PromptIR {
  family: ToolPromptFamily;
  capabilitySignature: string;
  tools: readonly PromptIRTool[];
  globalRules?: Readonly<Record<string, string>>;
}

const PREREQUISITES: Readonly<Record<string, readonly PromptIRPrerequisite[]>> = {
  skill_view_by_id: [{
    toolId: "skill_search",
    strength: "conditional",
    provenance: ["user", "injected_asset", "prior_tool_output"],
    producer: "skill_search",
    outputFields: ["id"],
  }],
  skill_files_read: [{
    toolId: "skill_view_by_id",
    strength: "conditional",
    provenance: ["injected_asset", "prior_tool_output"],
    producer: "skill_view_by_id",
    outputFields: ["manifest.path", "skill_id"],
  }],
  skill_files_download: [{
    toolId: "skill_view_by_id",
    strength: "conditional",
    provenance: ["injected_asset", "prior_tool_output"],
    producer: "skill_view_by_id",
    outputFields: ["manifest.path", "skill_id"],
  }],
  knowledge_tools_call: [{
    toolId: "knowledge_tools_list",
    strength: "required",
    provenance: ["prior_tool_output", "injected_asset"],
    producer: "knowledge_tools_list",
    outputFields: ["tools[].name", "tools[].params"],
  }],
  tdai_read_scene: [{
    toolId: "tdai_scenario_ls",
    strength: "conditional",
    provenance: ["injected_asset", "prior_tool_output", "user"],
    producer: "tdai_scenario_ls",
    outputFields: ["path"],
  }],
};

/** Only the three cross-tool value transfers needed to execute a downstream card. */
const MINIMAL_HANDOFFS: Readonly<Record<string, readonly PromptIRHandoff[]>> = {
  skill_view_by_id: [{
    producerToolId: "skill_search",
    bindings: [{ from: "data.items[].skill_id", to: "skill_id" }],
    strength: "conditional",
    sources: ["user", "injected_asset", "prior_tool_output"],
    allowDirectWhenAvailable: true,
  }],
  knowledge_tools_call: [{
    producerToolId: "knowledge_tools_list",
    bindings: [
      { from: "data.tools[].name", to: "tool_name" },
      { from: "data.tools[].params", to: "params", mode: "schema" },
    ],
    strength: "required",
    sources: ["injected_asset", "prior_tool_output"],
    allowDirectWhenAvailable: true,
  }],
  tdai_read_scene: [{
    producerToolId: "tdai_scenario_ls",
    bindings: [{ from: "data.entries[].path", to: "path" }],
    strength: "conditional",
    sources: ["user", "injected_asset", "prior_tool_output"],
    allowDirectWhenAvailable: true,
  }],
};

const HANDOFF_TARGET_PROVENANCE: Readonly<Record<string, Readonly<Record<string, readonly ParameterProvenance[]>>>> = {
  skill_view_by_id: {
    skill_id: ["user", "injected_asset", "prior_tool_output"],
  },
  knowledge_tools_call: {
    tool_name: ["injected_asset", "prior_tool_output"],
    params: ["injected_asset", "prior_tool_output"],
  },
  tdai_read_scene: {
    path: ["user", "injected_asset", "prior_tool_output"],
  },
};

const SPARSE_RECOVERY: Readonly<Record<string, readonly PromptIRRecovery[]>> = {
  knowledge_tools_call: [{
    trigger: "invalid-operation-or-schema",
    actionToolIds: ["knowledge_tools_list"],
    maxAttempts: 1,
    neverGuessReplacement: true,
  }],
  skill_view_by_id: [{
    trigger: "invalid-skill-id",
    actionToolIds: ["skill_search"],
    maxAttempts: 1,
    neverGuessReplacement: true,
  }],
  skill_files_read: [{
    trigger: "invalid-skill-id-or-path",
    actionToolIds: ["skill_view", "skill_view_by_id"],
    maxAttempts: 1,
    neverGuessReplacement: true,
  }],
  skill_files_download: [{
    trigger: "invalid-skill-id-or-path",
    actionToolIds: ["skill_view", "skill_view_by_id"],
    maxAttempts: 1,
    neverGuessReplacement: true,
  }],
  tdai_memory_search: [{
    trigger: "empty-semantic-result-with-open-gap",
    actionToolIds: ["tdai_atomic_query"],
    maxAttempts: 1,
    neverGuessReplacement: true,
    condition: "known type/time filters are available",
  }],
  tdai_conversation_search: [{
    trigger: "empty-semantic-result-with-open-gap",
    actionToolIds: ["tdai_conversation_query"],
    maxAttempts: 1,
    neverGuessReplacement: true,
    condition: "a target session_id is known",
  }],
};

export function getSparseRecoveryForToolId(toolId: string): readonly PromptIRRecovery[] {
  return SPARSE_RECOVERY[toolId] ?? [];
}

function provenanceFor(contract: RuntimeToolContract, arg: string): readonly ParameterProvenance[] {
  if (contract.requiredHeaders.includes(arg)) return ["injected_asset"];
  const handoffSources = HANDOFF_TARGET_PROVENANCE[contract.id]?.[arg];
  if (handoffSources) return handoffSources;
  if (["skill_id", "path", "tool_name", "params"].includes(arg)) return ["injected_asset", "prior_tool_output", "user"];
  return ["user"];
}

export const GOAL_CONTINUE_CONDITION = "Continue iff the user's goal still lacks required information; otherwise stop.";

export function getToolGoalSemantics(contract: RuntimeToolContract): Pick<PromptIRTool, "produces" | "continueIf"> {
  let produces: PromptIRTool["produces"];
  if (contract.id.endsWith("_list") || contract.id === "skill_search" || contract.id === "tdai_scenario_ls") produces = "discovery";
  else if (contract.id === "skill_view" || contract.id === "skill_view_by_id") produces = "instructions";
  else if (contract.responseKind === "bytes" || contract.id.includes("files_read") || contract.id === "tdai_read_scene") produces = "content";
  else produces = "answer";
  return { produces, continueIf: GOAL_CONTINUE_CONDITION };
}

export function buildPromptIR(input: {
  family: ToolPromptFamily;
  capabilitySignature: string;
  contracts?: readonly RuntimeToolContract[];
  globalRules?: Readonly<Record<string, string>>;
}): PromptIR {
  const contracts = input.contracts ?? getRuntimeToolContracts(input.family);
  const tools = contracts.filter((contract) => contract.family === input.family).map((contract) => {
    const spec = getV4Decision(contract.id);
    const allArgs = [...contract.requiredArgs, ...contract.optionalArgs];
    const parameterProvenance = Object.fromEntries(
      allArgs.map((arg) => [arg, provenanceFor(contract, arg)]),
    );
    const goalSemantics = getToolGoalSemantics(contract);
    return {
      toolId: contract.id,
      family: contract.family,
      capability: contract.capability,
      plane: "decision" as const,
      when: spec.when,
      inputHint: getV4ExecutionHint(contract.id),
      avoid: spec?.avoid,
      contrasts: (spec?.contrasts ?? []).filter(cue => contracts.some(c => c.id === cue.otherTool)),
      method: contract.method,
      path: contract.path,
      requiredArgs: contract.requiredArgs,
      optionalArgs: contract.optionalArgs,
      forbiddenArgs: contract.forbiddenArgs,
      responseKind: contract.responseKind,
      prerequisites: PREREQUISITES[contract.id] ?? [],
      handoffs: MINIMAL_HANDOFFS[contract.id] ?? [],
      recovery: getSparseRecoveryForToolId(contract.id),
      parameterProvenance,
      ...goalSemantics,
      runtimeBindingSlots: contract.requiredHeaders,
      dynamicAssetSlots: contract.family === "knowledge" ? ["knowledge-resource"] : [],
    } satisfies PromptIRTool;
  });
  return {
    family: input.family, capabilitySignature: input.capabilitySignature, tools,
    ...(input.globalRules ? { globalRules: input.globalRules } : {}),
  };
}
