import {
  constrainCapabilitySignature,
  getRuntimeToolContracts,
  parseCapabilitySignature,
} from "./runtime-contract.js";
import type {
  RuntimeToolContract,
  ToolPromptCapabilityState,
  ToolPromptFamily,
} from "./types.js";

export interface ToolPromptAssetCapabilityFlags {
  skill?: boolean;
  llm_wiki?: boolean;
  code_graph?: boolean;
  chat_memory?: boolean;
}

export function resolveSessionCapabilitySignature(
  baseSignature: string, flags: ToolPromptAssetCapabilityFlags | undefined,
): string {
  return constrainCapabilitySignature(baseSignature, {
    memory: flags?.chat_memory === true, skill: flags?.skill === true,
    wiki: flags?.llm_wiki === true, codeGraph: flags?.code_graph === true,
  });
}

export function isFidelityCapabilityEnabled(
  family: ToolPromptFamily,
  flags: ToolPromptAssetCapabilityFlags | undefined,
): boolean {
  if (!flags) return false;
  if (family === "memory") return flags.chat_memory === true;
  if (family === "skill") return flags.skill === true;
  return flags.llm_wiki === true || flags.code_graph === true;
}

export function getVisibleRuntimeToolContracts(
  capabilitySignature: string,
  family?: ToolPromptFamily,
): readonly RuntimeToolContract[] {
  const state = parseCapabilitySignature(capabilitySignature);
  assertConsistentCapabilityState(state);
  return getRuntimeToolContracts(family).filter((contract) =>
    isContractVisible(contract, state)
  );
}

export function assertConsistentCapabilityState(
  state: ToolPromptCapabilityState,
): void {
  if (!state.skill && (state.skillWrite || state.skillExtract)) {
    throw new Error("skill_write/skill_extract require skill=1");
  }
  if (!state.knowledge && (state.wiki || state.codeGraph)) {
    throw new Error("wiki/code_graph require knowledge=1");
  }
  if (state.knowledge && !state.wiki && !state.codeGraph) {
    throw new Error("knowledge=1 requires wiki=1 or code_graph=1");
  }
}

function isContractVisible(
  contract: RuntimeToolContract,
  state: ToolPromptCapabilityState,
): boolean {
  if (!state[contract.family]) return false;
  if (contract.capability === "skill.write") return state.skillWrite;
  if (contract.capability === "skill.extract") return state.skillExtract;
  return true;
}
