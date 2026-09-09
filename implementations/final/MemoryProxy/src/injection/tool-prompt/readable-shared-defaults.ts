import type { RuntimeToolContract } from "./types.js";
import {
  GOAL_CONTINUE_CONDITION,
  type PromptIRTool,
} from "./prompt-ir.js";

export const V4_SHARED_DEFAULTS = [
  "## Card defaults",
  "Omitted requires/optional/handoff/recovery = none; response = JSON; produces = answer.",
  "Recovery permits one rediscovery/corrected request, not an unchanged 4xx retry. Never guess replacement IDs or paths.",
  `continue-if: ${GOAL_CONTINUE_CONDITION}`,
  "result-window: stop when sufficient/short page; paginate only for an exhaustive request.",
] as const;

const IDENTITY_ARGS = new Set(["user_id", "team_id", "agent_id", "task_id"]);
const FAMILY_BASE_PATH = {
  memory: "/memory-bridge/v3",
  skill: "/skill-bridge/v3/skill",
} as const;
const RECOVERY_TRIGGER = {
  "invalid-operation-or-schema": "bad-schema",
  "invalid-skill-id": "bad-id",
  "invalid-skill-id-or-path": "bad-id/path",
  "empty-semantic-result-with-open-gap": "empty-with-gap",
} as const;

function compactSource(source: string): string {
  if (source === "injected_asset") return "asset";
  if (source === "prior_tool_output") return "output";
  return source;
}

function visiblePath(contract: Pick<RuntimeToolContract, "family" | "path">): string {
  const base = contract.family === "memory" || contract.family === "skill"
    ? FAMILY_BASE_PATH[contract.family]
    : "";
  return base && contract.path.startsWith(base)
    ? contract.path.slice(base.length)
    : contract.path;
}

export function renderV4ToolCard(tool: PromptIRTool): string {
  const contract = tool;
  const forbidden = tool.forbiddenArgs.filter(arg => !IDENTITY_ARGS.has(arg));
  return [
        `  <tool name="${tool.toolId}">`,
        ...renderV4DecisionFields(tool),
        ...(contract.requiredArgs.length > 0 ? [`    requires: ${contract.requiredArgs.join(",")}`] : []),
        `    path: ${visiblePath(contract)}`,
        ...(contract.optionalArgs.length > 0 ? [`    optional: ${contract.optionalArgs.join(",")}`] : []),
        ...(forbidden.length > 0 ? [`    forbidden: ${forbidden.join(",")}`] : []),
        ...(tool.toolId === "knowledge_tools_call" ? ["    shape: params=object; empty={}"] : []),
        ...(contract.responseKind === "json" ? [] : [`    response: ${contract.responseKind}`]),
        ...renderV4ActionFields(tool),
        "  </tool>",
      ].join("\n");
}

export function renderV4DecisionFields(tool: PromptIRTool): string[] {
  return [`    when: ${tool.when}`,
    ...(tool.avoid ? [`    avoid: ${tool.avoid}`] : []),
    ...tool.contrasts.map(cue => `    contrast[${cue.otherTool}]: ${cue.cue}`)];
}

export function lintV4DecisionFields(body: string, tool: PromptIRTool): void {
  const actual = body.split(/\r?\n/).filter(line => /^    (when|avoid|contrast\[[^\]]+\]):/.test(line));
  if (JSON.stringify(actual) !== JSON.stringify(renderV4DecisionFields(tool))) {
    throw new Error(`${tool.toolId} v4 decision fields diverged from effective rules`);
  }
}

/** Sparse action fields share one IR-backed projection in rendering and final validation. */
export function renderV4ActionFields(tool: PromptIRTool): string[] {
  return [
    ...(tool.inputHint ? [`    input: ${tool.inputHint}`] : []),
    ...tool.handoffs.map((handoff) => {
      const bindings = handoff.bindings.map((binding) => binding.mode === "schema"
        ? `${handoff.producerToolId}.${binding.from} constrains ${binding.to} values`
        : `${handoff.producerToolId}.${binding.from}->${binding.to}`).join(",");
      return `    handoff[${handoff.strength};${handoff.sources.map(compactSource).join("|")}]: ${bindings}; direct only if available`;
    }),
    ...(tool.produces === "answer" ? [] : [`    produces: ${tool.produces}`]),
    ...tool.recovery.map((rule) => (
      `    recover-once[${RECOVERY_TRIGGER[rule.trigger]}]: ${rule.actionToolIds.join("|")}${rule.condition ? `; only if ${rule.condition}` : ""}`
    )),
  ];
}

export function lintV4ActionFields(body: string, tool: PromptIRTool): void {
  const actual = body.split(/\r?\n/).filter((line) => /^    (?:input|handoff(?:\[[^\]]*\])?|produces|recover-once(?:\[[^\]]*\])?):/.test(line));
  if (JSON.stringify(actual) !== JSON.stringify(renderV4ActionFields(tool))) {
    throw new Error(`${tool.toolId} v4 action fields diverged from its IR`);
  }
}
