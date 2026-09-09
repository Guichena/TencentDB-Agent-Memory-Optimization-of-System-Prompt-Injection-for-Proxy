import type {
  RuntimeToolContract,
  ToolPromptCapabilityState,
  ToolPromptFamily,
} from "./types.js";

const IDENTITY_ARGS = ["user_id", "team_id", "agent_id", "task_id"] as const;
const BRIDGE_HEADERS = ["content-type", "x-tdai-service-id", "x-conversation-id"] as const;
const KNOWLEDGE_HEADERS = ["content-type", "x-tdai-service-id"] as const;

export const RUNTIME_TOOL_CONTRACTS = [
  {
    id: "tdai_memory_search",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/atomic/search",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["query"],
    optionalArgs: ["limit", "type", "time_start", "time_end"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#atomicSearchRequestSchema",
    ],
  },
  {
    id: "tdai_atomic_query",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/atomic/query",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: [],
    optionalArgs: ["type", "limit", "offset", "time_start", "time_end"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#atomicQueryRequestSchema",
    ],
  },
  {
    id: "tdai_conversation_search",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/conversation/search",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["query"],
    optionalArgs: ["limit", "session_id", "time_start", "time_end"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#conversationSearchRequestSchema",
    ],
  },
  {
    id: "tdai_conversation_query",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/conversation/query",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: [],
    optionalArgs: ["session_id", "limit", "offset", "time_start", "time_end"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#conversationQueryRequestSchema",
    ],
  },
  {
    id: "tdai_scenario_ls",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/scenario/ls",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: [],
    optionalArgs: ["path_prefix"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#scenarioListRequestSchema",
    ],
  },
  {
    id: "tdai_read_scene",
    family: "memory",
    phase: "read",
    method: "POST",
    path: "/memory-bridge/v3/scenario/read",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["path"],
    optionalArgs: ["agent_id"],
    forbiddenArgs: ["user_id", "team_id", "task_id"],
    responseKind: "json",
    capability: "memory.read",
    sourceRefs: [
      "MemoryProxy/src/memory/memory-bridge.ts#MEMORY_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/generated/schemas.ts#scenarioReadRequestSchema",
    ],
  },
  {
    id: "skill_search",
    family: "skill",
    phase: "read",
    method: "POST",
    path: "/skill-bridge/v3/skill/search",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["query"],
    optionalArgs: [],
    forbiddenArgs: [...IDENTITY_ARGS, "top_k", "mode"],
    responseKind: "json",
    capability: "skill.read",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#searchRequestSchema",
    ],
  },
  {
    id: "skill_view",
    family: "skill",
    phase: "read",
    method: "POST",
    path: "/skill-bridge/v3/skill/get-by-name",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_name"],
    optionalArgs: ["version", "include_content", "include_manifest"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.read",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#getByNameRequestSchema",
    ],
  },
  {
    id: "skill_view_by_id",
    family: "skill",
    phase: "read",
    method: "POST",
    path: "/skill-bridge/v3/skill/get",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id"],
    optionalArgs: ["version", "include_content", "include_manifest"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.read",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#getRequestSchema",
    ],
  },
  {
    id: "skill_files_read",
    family: "skill",
    phase: "read",
    method: "POST",
    path: "/skill-bridge/v3/skill/files/read",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "path"],
    optionalArgs: ["version", "encoding"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.read",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_ALLOWED_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#filesReadRequestSchema",
    ],
  },
  {
    id: "skill_files_download",
    family: "skill",
    phase: "read",
    method: "POST",
    path: "/skill-bridge/v3/skill/files/download",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "path"],
    optionalArgs: ["version", "encoding"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "bytes",
    capability: "skill.read",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#files/download",
      "MemoryCore/src/gateway/skill-schemas.ts#filesReadRequestSchema",
    ],
  },
  {
    id: "skill_extract",
    family: "skill",
    phase: "lifecycle",
    method: "POST",
    path: "/skill-bridge/v3/skill/extract",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: [],
    optionalArgs: ["reason"],
    forbiddenArgs: [...IDENTITY_ARGS, "messages"],
    responseKind: "json",
    capability: "skill.extract",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#sub === extract",
      "MemoryCore/src/gateway/skill-schemas.ts#forceArchiveRequestSchema",
    ],
  },
  {
    id: "skill_create",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/create",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["name", "content"],
    optionalArgs: ["resources", "metadata"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#createRequestSchema",
    ],
  },
  {
    id: "skill_update",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/update",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "expected_version", "content"],
    optionalArgs: [],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#updateRequestSchema",
    ],
  },
  {
    id: "skill_patch",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/patch",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "expected_version", "old_string", "new_string"],
    optionalArgs: ["replace_all"],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#patchRequestSchema",
    ],
  },
  {
    id: "skill_delete",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/delete",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "expected_version"],
    optionalArgs: [],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#deleteRequestSchema",
    ],
  },
  {
    id: "skill_files_write",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/files/write",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "expected_version", "files"],
    optionalArgs: [],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#filesWriteRequestSchema",
    ],
  },
  {
    id: "skill_files_remove",
    family: "skill",
    phase: "write",
    method: "POST",
    path: "/skill-bridge/v3/skill/files/remove",
    requiredHeaders: BRIDGE_HEADERS,
    requiredArgs: ["skill_id", "expected_version", "paths"],
    optionalArgs: [],
    forbiddenArgs: IDENTITY_ARGS,
    responseKind: "json",
    capability: "skill.write",
    sourceRefs: [
      "MemoryProxy/src/skill/skill-bridge.ts#SKILL_BRIDGE_WRITE_SUBPATHS",
      "MemoryCore/src/gateway/skill-schemas.ts#filesRemoveRequestSchema",
    ],
  },
  {
    id: "knowledge_tools_list",
    family: "knowledge",
    phase: "read",
    method: "POST",
    path: "/tools/list",
    requiredHeaders: KNOWLEDGE_HEADERS,
    requiredArgs: ["knowledge_id"],
    optionalArgs: [],
    forbiddenArgs: [],
    responseKind: "dynamic-schema",
    capability: "knowledge.read",
    sourceRefs: ["MemoryKnowledge/src/routes/tools.ts#app.post(/list)"],
  },
  {
    id: "knowledge_tools_call",
    family: "knowledge",
    phase: "read",
    method: "POST",
    path: "/tools/call",
    requiredHeaders: KNOWLEDGE_HEADERS,
    requiredArgs: ["knowledge_id", "tool_name", "params"],
    optionalArgs: [],
    forbiddenArgs: [],
    responseKind: "dynamic-schema",
    capability: "knowledge.read",
    sourceRefs: ["MemoryKnowledge/src/routes/tools.ts#app.post(/call)"],
  },
] as const satisfies readonly RuntimeToolContract[];

export function getRuntimeToolContracts(
  family?: ToolPromptFamily,
): readonly RuntimeToolContract[] {
  return family
    ? RUNTIME_TOOL_CONTRACTS.filter((contract) => contract.family === family)
    : RUNTIME_TOOL_CONTRACTS;
}

export function buildCapabilitySignature(state: ToolPromptCapabilityState): string {
  return [
    `memory=${Number(state.memory)}`,
    `skill=${Number(state.skill)}`,
    `knowledge=${Number(state.knowledge)}`,
    `wiki=${Number(state.wiki)}`,
    `code_graph=${Number(state.codeGraph)}`,
    `skill_write=${Number(state.skillWrite)}`,
    `skill_extract=${Number(state.skillExtract)}`,
  ].join(";");
}

export function parseCapabilitySignature(
  signature: string,
): ToolPromptCapabilityState {
  const expectedKeys = [
    "memory",
    "skill",
    "knowledge",
    "wiki",
    "code_graph",
    "skill_write",
    "skill_extract",
  ] as const;
  const expected = new Set<string>(expectedKeys);
  const fields = new Map<string, string>();
  const parts = signature.split(";");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`invalid capability signature ${JSON.stringify(signature)}: empty field`);
  }
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      throw new Error(
        `invalid capability signature ${JSON.stringify(signature)}: missing memory=0|1`,
      );
    }
    if (separator !== part.lastIndexOf("=")) {
      throw new Error(`invalid capability signature ${JSON.stringify(signature)}: malformed field`);
    }
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!expected.has(key)) {
      throw new Error(`invalid capability signature ${JSON.stringify(signature)}: unknown ${key}`);
    }
    if (fields.has(key)) {
      throw new Error(`invalid capability signature ${JSON.stringify(signature)}: duplicate ${key}`);
    }
    fields.set(key, value);
  }
  const read = (key: string): boolean => {
    const value = fields.get(key);
    if (value !== "0" && value !== "1") {
      throw new Error(
        `invalid capability signature ${JSON.stringify(signature)}: missing ${key}=0|1`,
      );
    }
    return value === "1";
  };
  return {
    memory: read("memory"),
    skill: read("skill"),
    knowledge: read("knowledge"),
    wiki: read("wiki"),
    codeGraph: read("code_graph"),
    skillWrite: read("skill_write"),
    skillExtract: read("skill_extract"),
  };
}

/** Intersect process-level capability facts with one Session's access flags. */
export function constrainCapabilitySignature(
  signature: string,
  allowed: Partial<ToolPromptCapabilityState>,
): string {
  const base = parseCapabilitySignature(signature);
  const memory = base.memory && allowed.memory !== false;
  const skill = base.skill && allowed.skill !== false;
  const wiki = base.wiki && allowed.wiki !== false;
  const codeGraph = base.codeGraph && allowed.codeGraph !== false;
  const knowledge = base.knowledge
    && allowed.knowledge !== false
    && (wiki || codeGraph);
  return buildCapabilitySignature({
    memory,
    skill,
    knowledge,
    wiki: knowledge && wiki,
    codeGraph: knowledge && codeGraph,
    skillWrite: skill && base.skillWrite && allowed.skillWrite !== false,
    skillExtract: skill && base.skillExtract && allowed.skillExtract !== false,
  });
}
