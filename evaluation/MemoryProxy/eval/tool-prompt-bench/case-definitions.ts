import type {
  AllowedToolAction,
  EvalFixture,
  EvalLanguage,
  EvalSplit,
  KnowledgeCallExpectation,
  SourceRef,
  ToolPromptEvalCase,
} from "./schema.js";

const SOURCE_META: Record<string, Pick<SourceRef, "revision" | "license">> = {
  "project-authored": {
    revision: "97f94654280b2932c35ba4806a491999ed244cc9",
    license: "MIT",
  },
  "human-eval": {
    revision: "6d43fb980f9fee3c892a914eda09951f772ad10d",
    license: "MIT",
  },
  "longmemeval-cleaned": {
    revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
    license: "MIT",
  },
  skillsbench: {
    revision: "b63b7b2850226b6aa4fb5929a8c1ac7bc4d9a6af",
    license: "Apache-2.0",
  },
  crosscodeeval: {
    revision: "40c68d2b7ca2a8eae95d901ac80e6a540a84a53d",
    license: "Apache-2.0",
  },
  bfcl: {
    revision: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8",
    license: "Apache-2.0",
  },
  metatool: {
    revision: "35e81bb7576826e980c80fed8f8c0a2b4a1e6fbb",
    license: "MIT",
  },
};

function source(
  dataset: keyof typeof SOURCE_META,
  sourceId: string,
  usage: SourceRef["usage"],
  adaptation: string,
): SourceRef {
  return { dataset, sourceId, usage, adaptation, ...SOURCE_META[dataset] };
}

const IDENTITY_FIELDS = ["user_id", "team_id", "agent_id"];

function action(
  tool: string,
  endpoint: string,
  requiredFields: string[],
  options: Partial<NonNullable<AllowedToolAction["argumentRules"]>> = {},
): AllowedToolAction {
  return {
    tool,
    endpoint,
    argumentRules: {
      requiredFields,
      forbiddenFields: IDENTITY_FIELDS,
      ...options,
    },
  };
}

const memorySearch = (terms: string[]) => action(
  "tdai_memory_search",
  "/memory-bridge/v3/atomic/search",
  ["query"],
  { stringContainsAny: { query: terms } },
);
const conversationSearch = (terms: string[]) => action(
  "tdai_conversation_search",
  "/memory-bridge/v3/conversation/search",
  ["query"],
  { stringContainsAny: { query: terms } },
);
const atomicQuery = (exactValues: Record<string, unknown>) => action(
  "tdai_atomic_query",
  "/memory-bridge/v3/atomic/query",
  [],
  { exactValues },
);
const conversationQuery = (sessionId: string) => action(
  "tdai_conversation_query",
  "/memory-bridge/v3/conversation/query",
  ["session_id"],
  { exactValues: { session_id: sessionId } },
);
const scenarioList = (prefix: string) => action(
  "tdai_scenario_ls",
  "/memory-bridge/v3/scenario/ls",
  [],
  { exactValues: { path_prefix: prefix } },
);
const readScene = () => action(
  "tdai_read_scene",
  "/memory-bridge/v3/scenario/read",
  ["path"],
  { pathFromFixture: true },
);

const skillView = (skillName: string) => action(
  "skill_view",
  "/skill-bridge/v3/skill/get-by-name",
  ["skill_name", "include_content", "include_manifest"],
  { exactValues: { skill_name: skillName, include_content: true, include_manifest: true } },
);
const skillSearch = (terms: string[]) => action(
  "skill_search",
  "/skill-bridge/v3/skill/search",
  ["query"],
  { stringContainsAny: { query: terms } },
);
const skillFileRead = (skillId: string, path: string) => action(
  "skill_files_read",
  "/skill-bridge/v3/skill/files/read",
  ["skill_id", "path"],
  { exactValues: { skill_id: skillId, path }, valueFromPreviousStep: true },
);
const knowledgeList = (knowledgeId: string) => action(
  "knowledge_tools_list",
  "/tools/list",
  ["knowledge_id"],
  { exactValues: { knowledge_id: knowledgeId } },
);

const knowledgeExplore = (terms: string[]): KnowledgeCallExpectation[] => [{
  toolName: "explore",
  paramRules: { requiredFields: ["query"], stringContainsAny: { query: terms } },
}];
const knowledgeSymbolCall = (toolName: "callers" | "callees" | "impact", symbol: string): KnowledgeCallExpectation[] => [{
  toolName,
  paramRules: { requiredFields: ["symbol"], exactValues: { symbol } },
}];
const knowledgeSearchThenImpact = (symbol: string): KnowledgeCallExpectation[] => [
  {
    toolName: "search",
    paramRules: { requiredFields: ["query"], exactValues: { query: symbol } },
  },
  {
    toolName: "impact",
    paramRules: { requiredFields: ["symbol"], exactValues: { symbol } },
  },
];
const knowledgeWikiLookup = (terms: string[]): KnowledgeCallExpectation[] => [
  {
    toolName: "search",
    paramRules: { requiredFields: ["query"], stringContainsAny: { query: terms } },
  },
  {
    toolName: "read_page",
    paramRules: { requiredFields: ["refs"], valueFromPreviousStep: true },
  },
];

export const FIXTURES: EvalFixture[] = [];
export const CASES: ToolPromptEvalCase[] = [];

interface BaseInput {
  caseId: string;
  split: EvalSplit;
  language?: EvalLanguage;
  query: string;
  contextMessages?: ToolPromptEvalCase["contextMessages"];
  source: SourceRef;
  annotationReason: string;
  groupId: string;
  assets: EvalFixture["assets"];
}

function register(
  input: BaseInput,
  category: ToolPromptEvalCase["category"],
  gold: ToolPromptEvalCase["gold"],
  preconditions: ToolPromptEvalCase["preconditions"],
): void {
  const fixtureId = `${input.caseId}-fixture`;
  FIXTURES.push({
    fixtureId,
    split: input.split,
    description: input.annotationReason,
    assets: input.assets,
  });
  CASES.push({
    caseId: input.caseId,
    schemaVersion: "1.0",
    split: input.split,
    language: input.language ?? "zh",
    category,
    query: input.query,
    contextMessages: input.contextMessages,
    source: input.source,
    capabilities: {
      chatMemory: true,
      skill: true,
      llmWiki: true,
      codeGraph: true,
      allowLlmWrite: false,
      // V0 currently exposes skill_extract in <skill_tools>. Hiding it is an
      // optimization variant, not part of the baseline capability surface.
      allowLlmExtract: true,
    },
    gold,
    preconditions,
    fixtureIds: [fixtureId],
    annotationReason: input.annotationReason,
    groupId: input.groupId,
  });
}

function memoryCase(
  input: BaseInput & {
    first: AllowedToolAction;
    sequence?: string[];
    scenePathInjected?: boolean;
  },
): void {
  const sequence = input.sequence ?? [input.first.tool];
  const expectedFollowupActions: AllowedToolAction[] = [];
  if (sequence[0] === "tdai_scenario_ls" && sequence[1] === "tdai_read_scene") {
    const prefix = input.first.argumentRules?.exactValues?.path_prefix;
    const path = input.assets.scenes?.find((scene) => (
      typeof scene.path === "string"
      && (typeof prefix !== "string" || scene.path.startsWith(prefix))
    ))?.path;
    expectedFollowupActions.push(action(
      "tdai_read_scene",
      "/memory-bridge/v3/scenario/read",
      ["path"],
      {
        exactValues: typeof path === "string" ? { path } : undefined,
        pathFromFixture: true,
        valueFromPreviousStep: true,
      },
    ));
  }
  register(
    input,
    "memory_positive",
    {
      needTdaiTool: true,
      family: "memory",
      allowedFirstActions: [input.first],
      allowedSequences: [sequence],
      expectedFollowupActions: expectedFollowupActions.length > 0 ? expectedFollowupActions : undefined,
      forbiddenTools: ["skill_search", "skill_view", "skill_extract", "knowledge_tools_list"],
      maxTdaiCalls: input.sequence?.length ?? 1,
    },
    {
      answerInCurrentContext: false,
      answerInProfileL3: false,
      scenePathInjected: input.scenePathInjected ?? false,
      goldSkillInListing: false,
      knowledgeMatchesWorkspace: false,
    },
  );
}

function skillCase(
  input: BaseInput & {
    first: AllowedToolAction;
    sequence: string[];
    listed: boolean;
  },
): void {
  const goldSkill = input.assets.skills?.teamLibrary.find((skill) => skill.gold_asset === true);
  const skillName = typeof goldSkill?.name === "string" ? goldSkill.name : "";
  const skillId = typeof goldSkill?.skill_id === "string" ? goldSkill.skill_id : "";
  const manifest = Array.isArray(goldSkill?.manifest) ? goldSkill.manifest : [];
  const resourcePath = typeof manifest[0]?.path === "string" ? manifest[0].path : "";
  const expectedFollowupActions = input.sequence.slice(1).map((tool) => {
    if (tool === "skill_view") return action(
      "skill_view",
      "/skill-bridge/v3/skill/get-by-name",
      ["skill_name", "include_content", "include_manifest"],
      {
        exactValues: { skill_name: skillName, include_content: true, include_manifest: true },
        valueFromPreviousStep: true,
      },
    );
    if (tool === "skill_files_read") return skillFileRead(skillId, resourcePath);
    throw new Error(`${input.caseId}: unsupported Skill follow-up ${tool}`);
  });
  register(
    input,
    "skill_positive",
    {
      needTdaiTool: true,
      family: "skill",
      allowedFirstActions: [input.first],
      allowedSequences: [input.sequence],
      expectedFollowupActions: expectedFollowupActions.length > 0 ? expectedFollowupActions : undefined,
      forbiddenTools: ["skill_extract", "tdai_memory_search", "knowledge_tools_list"],
      maxTdaiCalls: input.sequence.length,
    },
    {
      answerInCurrentContext: false,
      answerInProfileL3: false,
      scenePathInjected: false,
      goldSkillInListing: input.listed,
      knowledgeMatchesWorkspace: false,
    },
  );
}

function knowledgeCase(input: BaseInput & { knowledgeId: string; toolCalls: KnowledgeCallExpectation[] }): void {
  register(
    input,
    "knowledge_positive",
    {
      needTdaiTool: true,
      family: "knowledge",
      allowedFirstActions: [knowledgeList(input.knowledgeId)],
      allowedSequences: [["knowledge_tools_list", ...input.toolCalls.map(() => "knowledge_tools_call")]],
      expectedKnowledgeCalls: input.toolCalls,
      forbiddenTools: ["tdai_memory_search", "skill_search", "skill_view"],
      maxTdaiCalls: input.toolCalls.length + 1,
    },
    {
      answerInCurrentContext: false,
      answerInProfileL3: false,
      scenePathInjected: false,
      goldSkillInListing: false,
      knowledgeMatchesWorkspace: true,
    },
  );
}

function noToolCase(
  input: BaseInput & {
    category: Exclude<ToolPromptEvalCase["category"], `${string}_positive`>;
    answerInCurrentContext?: boolean;
    answerInProfileL3?: boolean;
  },
): void {
  register(
    input,
    input.category,
    {
      needTdaiTool: false,
      family: null,
      allowedFirstActions: [],
      allowedSequences: [],
      forbiddenTools: ["*"],
      maxTdaiCalls: 0,
    },
    {
      answerInCurrentContext: input.answerInCurrentContext ?? !input.answerInProfileL3,
      answerInProfileL3: input.answerInProfileL3 ?? false,
      scenePathInjected: false,
      goldSkillInListing: false,
      knowledgeMatchesWorkspace: false,
    },
  );
}

const distractorSkill = {
  skill_id: "skl-distractor-formatting",
  name: "typescript-formatting",
  description: "Formatting conventions for TypeScript source files",
};
const distractorKnowledge = {
  knowledge_id: "cg-mobi0001",
  type: "code-graph",
  name: "Mobile App Graph",
  service_url: "http://knowledge.test/v3",
  summary: "Symbol graph for an unrelated mobile application",
  repo_slug: "example/mobile-app",
  branch: "main",
  tools: [
    { name: "search", description: "Search symbols by name", params: { query: { type: "string", required: true } } },
    { name: "callers", description: "List callers of a symbol", params: { symbol: { type: "string", required: true } } },
    { name: "impact", description: "Analyze symbol impact", params: { symbol: { type: "string", required: true } } },
  ],
};
const distractorMemory = {
  memory_id: "mem-distractor-theme",
  type: "persona",
  content: "The user prefers dark editor themes.",
};

function baseDistractors(): EvalFixture["assets"] {
  return {
    atomicMemories: [distractorMemory],
    skills: { listed: [distractorSkill], teamLibrary: [distractorSkill] },
    knowledge: [distractorKnowledge],
  };
}

function pagedConversationMessages(): Array<Record<string, unknown>> {
  return Array.from({ length: 51 }, (_, index) => ({
    role: index === 50 ? "assistant" : "user",
    content: index === 50
      ? "Message 51 discusses route normalization."
      : `Previously examined routing message ${index + 1}.`,
  }));
}

function pagedPersonaMemories(): Array<Record<string, unknown>> {
  return Array.from({ length: 21 }, (_, index) => ({
    memory_id: `mem-persona-${index + 1}`,
    type: "persona",
    content: index === 20
      ? "Prefer concise pull-request descriptions."
      : `Earlier persona entry ${index + 1}.`,
  }));
}

// Memory Dev: selected to cover each current Memory tool boundary.
memoryCase({
  caseId: "memory-dev-preference-001",
  split: "dev",
  query: "继续写这个服务时，按我之前确定的 TypeScript 测试框架配置测试。",
  source: source("longmemeval-cleaned", "c8c3f81d", "adapted", "Preserves retrieval of a stable user preference; rewritten as an engineering-tooling preference."),
  annotationReason: "The required test framework is a past preference absent from current context, so L1 semantic memory is the smallest sufficient call.",
  groupId: "memory-preference-dev",
  first: memorySearch(["TypeScript", "测试框架", "之前"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-test-framework", type: "persona", content: "For TypeScript services, use Vitest rather than Jest." }] },
});
memoryCase({
  caseId: "memory-dev-decision-002",
  split: "dev",
  query: "数据库迁移方案按上次的最终结论继续推进：用双写还是停机切换？",
  source: source("longmemeval-cleaned", "3ba21379", "adapted", "Preserves retrieval of the latest project state; rewritten as a migration decision."),
  annotationReason: "The query explicitly depends on a prior engineering decision summarized in L1.",
  groupId: "memory-decision-dev",
  first: memorySearch(["数据库迁移", "双写", "停机切换"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-migration-choice", type: "instruction", content: "The final migration plan uses dual writes before cutover." }] },
});
memoryCase({
  caseId: "memory-dev-update-003",
  split: "dev",
  query: "线上推理当前默认用哪个模型？以最近一次更新为准。",
  source: source("longmemeval-cleaned", "59524333", "adapted", "Preserves knowledge-update semantics and the need to prefer the newest memory."),
  annotationReason: "The answer is a mutable past fact; semantic memory should retrieve the newest matching record.",
  groupId: "memory-update-dev",
  first: memorySearch(["线上推理", "默认模型", "最近"]),
  assets: { ...baseDistractors(), atomicMemories: [
    { memory_id: "mem-model-old", type: "instruction", content: "Default model was qwen-max.", timestamp: "2026-05-01T10:00:00Z" },
    { memory_id: "mem-model-new", type: "instruction", content: "Default model changed to deepseek-v3.", timestamp: "2026-07-12T10:00:00Z" },
  ] },
});
memoryCase({
  caseId: "memory-dev-exact-quote-004",
  split: "dev",
  query: "把我上次否决全量重建索引时说的原话找出来。",
  source: source("project-authored", "memory-conversation-exact-quote", "project-authored", "Targets the current conversation_search versus memory_search distinction."),
  annotationReason: "The user requests verbatim historical wording, so L0 conversation search is required.",
  groupId: "memory-exact-quote-dev",
  first: conversationSearch(["全量重建索引", "原话", "否决"]),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-index-review", messages: [{ role: "user", content: "不要全量重建，先做增量回放验证水位。" }] }] },
});
memoryCase({
  caseId: "memory-dev-timeline-005",
  split: "dev",
  query: "我们先启用灰度写入还是先完成回滚演练？请根据之前的对话时间线确认。",
  source: source("longmemeval-cleaned", "gpt4_2655b836", "adapted", "Preserves temporal ordering between two past events; rewritten as deployment milestones."),
  annotationReason: "The order is represented by timestamped raw messages, making conversation search preferable to an atomic summary.",
  groupId: "memory-timeline-dev",
  first: conversationSearch(["灰度写入", "回滚演练", "先"]),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-release", messages: [
    { role: "user", content: "今天先完成回滚演练。", timestamp: "2026-06-02T09:00:00Z" },
    { role: "user", content: "演练通过了，明天启用灰度写入。", timestamp: "2026-06-03T09:00:00Z" },
  ] }] },
});
memoryCase({
  caseId: "memory-dev-atomic-filter-006",
  split: "dev",
  query: "列出 2026 年 7 月记录的 instruction 类型项目约束，不需要语义搜索。",
  source: source("project-authored", "memory-atomic-filter", "project-authored", "Targets structured type and time-window retrieval."),
  annotationReason: "The user supplies exact type and time filters, which maps directly to atomic_query.",
  groupId: "memory-atomic-query-dev",
  first: atomicQuery({ type: "instruction", time_start: "2026-07-01T00:00:00Z", time_end: "2026-08-01T00:00:00Z" }),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-july-rule", type: "instruction", content: "All schema migrations require a rollback test.", timestamp: "2026-07-18T10:00:00Z" }] },
});
memoryCase({
  caseId: "memory-dev-known-session-007",
  split: "dev",
  query: "按顺序读取会话 sess-checkpoint-157 的历史消息。",
  contextMessages: [{ role: "assistant", content: "The relevant archived session id is sess-checkpoint-157." }],
  source: source("project-authored", "memory-known-session", "project-authored", "Targets direct ordered retrieval when the session id is known."),
  annotationReason: "A concrete session id and ordered-message request uniquely select conversation_query.",
  groupId: "memory-conversation-query-dev",
  first: conversationQuery("sess-checkpoint-157"),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-checkpoint-157", messages: [{ role: "user", content: "Recalibrate the checkpoint after compaction." }] }] },
});
memoryCase({
  caseId: "memory-dev-scene-read-008",
  split: "dev",
  query: "读取场景索引中 incidents/proxy/cache-miss.md 的完整处理流程。",
  source: source("project-authored", "memory-known-scene-path", "project-authored", "Targets read_scene when a valid L2 path is already injected."),
  annotationReason: "The exact scene path is present in the injected index; listing again would be unnecessary.",
  groupId: "memory-scene-read-dev",
  first: readScene(),
  scenePathInjected: true,
  assets: { ...baseDistractors(), sceneIndex: [{ path: "incidents/proxy/cache-miss.md", summary: "Prompt cache miss response" }], scenes: [{ path: "incidents/proxy/cache-miss.md", content: "Confirm prefix hash, then compare dynamic suffixes." }] },
});
memoryCase({
  caseId: "memory-dev-scene-refresh-009",
  split: "dev",
  query: "当前注入的场景索引里没有 deployment 条目，刷新 deployment/ 前缀后读取发布回滚场景。",
  source: source("project-authored", "memory-refresh-scene-index", "project-authored", "Targets scenario_ls followed by read_scene when the injected index is incomplete."),
  annotationReason: "The path is not injected, so the model must list the requested prefix before reading a returned path.",
  groupId: "memory-scene-refresh-dev",
  first: scenarioList("deployment/"),
  sequence: ["tdai_scenario_ls", "tdai_read_scene"],
  assets: { ...baseDistractors(), sceneIndex: [], scenes: [{ path: "deployment/rollback.md", summary: "Release rollback", content: "Stop writes, roll back, verify offsets." }] },
});

// Memory Test: separate stories and source groups from Dev.
memoryCase({
  caseId: "memory-test-preference-001",
  split: "test",
  query: "生成 API 示例时沿用我以前选定的示例语言，不要自行换一种。",
  source: source("longmemeval-cleaned", "a06e4cfe", "adapted", "Preserves retrieval of a user-specific ratio preference; rewritten as a code-example language preference."),
  annotationReason: "The requested choice depends on a stored user preference not present in the current prompt.",
  groupId: "memory-preference-test",
  first: memorySearch(["API 示例", "Python", "TypeScript"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-example-language", type: "persona", content: "Use Python for API examples." }] },
});
memoryCase({
  caseId: "memory-test-update-002",
  split: "test",
  query: "我们最后把 tracing 采样率改成了多少？以最新决定为准。",
  source: source("longmemeval-cleaned", "5a4f22c0", "adapted", "Preserves retrieval of an updated fact over an older fact; rewritten as observability configuration."),
  annotationReason: "The current value is the newest item among conflicting historical records.",
  groupId: "memory-update-test",
  first: memorySearch(["tracing", "采样率", "最终"]),
  assets: { ...baseDistractors(), atomicMemories: [
    { memory_id: "mem-sample-old", type: "instruction", content: "Tracing sample rate is 0.10.", timestamp: "2026-04-01T00:00:00Z" },
    { memory_id: "mem-sample-new", type: "instruction", content: "Tracing sample rate is now 0.25.", timestamp: "2026-07-20T00:00:00Z" },
  ] },
});
memoryCase({
  caseId: "memory-test-exact-quote-003",
  split: "test",
  query: "找出我讨论 Redis 降级策略时那句包含 fail-open 的原话。",
  source: source("project-authored", "memory-exact-quote-fail-open", "project-authored", "Targets exact-message retrieval with a distinctive quoted term."),
  annotationReason: "The user asks for exact wording from an earlier conversation, requiring conversation_search.",
  groupId: "memory-exact-quote-test",
  first: conversationSearch(["Redis", "fail-open", "原话"]),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-redis", messages: [{ role: "user", content: "Redis 不可用时限流必须 fail-open，但要记录告警。" }] }] },
});
memoryCase({
  caseId: "memory-test-temporal-004",
  split: "test",
  query: "之前是先合并 storage 抽象还是先接入 ClickHouse？根据历史消息确认顺序。",
  source: source("longmemeval-cleaned", "gpt4_2487a7cb", "adapted", "Preserves comparison of which past event happened first; rewritten as repository milestones."),
  annotationReason: "Ordering requires timestamped raw conversation evidence.",
  groupId: "memory-temporal-test",
  first: conversationSearch(["storage", "ClickHouse", "先"]),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-roadmap", messages: [
    { role: "assistant", content: "Storage abstraction merged.", timestamp: "2026-05-10T00:00:00Z" },
    { role: "assistant", content: "ClickHouse reporting integrated.", timestamp: "2026-05-18T00:00:00Z" },
  ] }] },
});
memoryCase({
  caseId: "memory-test-scene-read-005",
  split: "test",
  query: "按已注入路径 runbooks/core/extraction-timeout.md 读取完整排障步骤。",
  source: source("project-authored", "memory-scene-extraction-timeout", "project-authored", "Targets known-path L2 scene retrieval."),
  annotationReason: "The injected path is authoritative, so read_scene is the correct first action.",
  groupId: "memory-scene-read-test",
  first: readScene(),
  scenePathInjected: true,
  assets: { ...baseDistractors(), sceneIndex: [{ path: "runbooks/core/extraction-timeout.md", summary: "Skill extraction timeout" }], scenes: [{ path: "runbooks/core/extraction-timeout.md", content: "Inspect worker lease, then LLM timeout and archive size." }] },
});
memoryCase({
  caseId: "memory-test-atomic-filter-006",
  split: "test",
  query: "只取 2026 年 6 月的 episodic 记忆，按时间窗口查询，不要做关键词搜索。",
  source: source("project-authored", "memory-atomic-filter-episodic", "project-authored", "Targets atomic_query with explicit type and date filters."),
  annotationReason: "Explicit structured filters make semantic search unnecessary and less precise.",
  groupId: "memory-atomic-query-test",
  first: atomicQuery({ type: "episodic", time_start: "2026-06-01T00:00:00Z", time_end: "2026-07-01T00:00:00Z" }),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-june-incident", type: "episodic", content: "Proxy timeout incident resolved.", timestamp: "2026-06-11T00:00:00Z" }] },
});

function skillAssets(
  name: string,
  description: string,
  listed: boolean,
  resources: Array<Record<string, unknown>> = [],
): EvalFixture["assets"] {
  const gold = {
    skill_id: `skl-${name}`,
    name,
    description,
    content: `# ${name}\nFollow the verified workflow.`,
    manifest: resources,
    files: Object.fromEntries(resources.map((resource) => [
      String(resource.path),
      {
        path: resource.path,
        encoding: resource.encoding ?? "utf-8",
        content: `Fixture content for ${String(resource.path)}`,
      },
    ])),
    gold_asset: true,
  };
  return {
    atomicMemories: [distractorMemory],
    skills: {
      listed: listed ? [gold, distractorSkill] : [distractorSkill],
      teamLibrary: [gold, distractorSkill],
    },
    knowledge: [distractorKnowledge],
  };
}

// Skill Dev: selected SkillsBench tasks have an actual workflow or resource dependency.
skillCase({
  caseId: "skill-dev-dialogue-view-001",
  split: "dev",
  language: "en",
  query: "Implement the dialogue graph parser for /app/script.txt and follow our team's parser workflow and graph-validation rules.",
  source: source("skillsbench", "tasks/dialogue-parser", "adapted", "Preserves dependency on the dialogue-graph skill while reducing the task to tool-selection behavior."),
  annotationReason: "A matching parser workflow is present in the injected listing, so direct view is the shortest valid action.",
  groupId: "skillsbench-dialogue-direct-dev",
  first: skillView("dialogue-graph"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("dialogue-graph", "Parse dialogue scripts into validated node and edge graphs", true),
});
skillCase({
  caseId: "skill-dev-dialogue-files-002",
  split: "dev",
  language: "en",
  query: "Process script.txt with the reusable parser utility bundled in our team's dialogue-graph workflow.",
  source: source("skillsbench", "tasks/dialogue-parser/environment/skills/dialogue-graph/scripts/dialogue_graph.py", "adapted", "Preserves the need to inspect a skill manifest before reading an executable resource."),
  annotationReason: "Executing the bundled asset requires skill_view followed by skill_files_read.",
  groupId: "skillsbench-dialogue-resource-dev",
  first: skillView("dialogue-graph"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("dialogue-graph", "Parse dialogue scripts into graphs", true, [{ path: "scripts/dialogue_graph.py", encoding: "utf-8", executable: true }]),
});
skillCase({
  caseId: "skill-dev-grpo-search-003",
  split: "dev",
  language: "en",
  query: "Debug a TRL GRPO training run that produces no reward improvement, following our team's established post-training diagnosis procedure.",
  source: source("skillsbench", "tasks/debug-trl-grpo", "adapted", "Preserves a debugging task that depends on specialized GRPO and TRL guidance."),
  annotationReason: "The required specialized skill is absent from the listing but available in the team library.",
  groupId: "skillsbench-grpo-search-dev",
  first: skillSearch(["GRPO", "reward", "debug"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("rl-post-training", "Diagnostic workflow for GRPO and post-training failures", false),
});
skillCase({
  caseId: "skill-dev-grpo-files-004",
  split: "dev",
  language: "en",
  query: "After repairing the post-training pipeline, validate it with our workflow's bundled verify_pipeline.py utility.",
  source: source("skillsbench", "tasks/debug-trl-grpo/environment/skills/rl-post-training/scripts/verify_pipeline.py", "adapted", "Preserves explicit dependence on a bundled verification script."),
  annotationReason: "The matching listed workflow must be viewed before its bundled verification resource can be read.",
  groupId: "skillsbench-grpo-resource-dev",
  first: skillView("rl-post-training"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("rl-post-training", "Post-training diagnostic workflow", true, [{ path: "scripts/verify_pipeline.py", encoding: "utf-8", executable: true }]),
});
skillCase({
  caseId: "skill-dev-spring-view-005",
  split: "dev",
  language: "en",
  query: "Migrate this service from Spring Boot 2.7 to 3.2 while following our approved migration workflow and compatibility checks.",
  source: source("skillsbench", "tasks/spring-boot-jakarta-migration", "adapted", "Preserves dependence on a repository migration procedure with multiple compatibility steps."),
  annotationReason: "The exact migration skill is already listed and should be opened directly.",
  groupId: "skillsbench-spring-direct-dev",
  first: skillView("spring-boot-migration"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("spring-boot-migration", "Spring Boot 2.7 to 3.2 migration workflow", true),
});
skillCase({
  caseId: "skill-dev-spring-search-006",
  split: "dev",
  language: "en",
  query: "Migrate all javax imports to the correct Jakarta namespaces using our team's namespace-migration procedure.",
  source: source("skillsbench", "tasks/spring-boot-jakarta-migration/environment/skills/jakarta-namespace", "adapted", "Preserves selection among similar Spring migration skills."),
  annotationReason: "The exact Jakarta workflow is outside the injected listing, so search must precede view.",
  groupId: "skillsbench-jakarta-search-dev",
  first: skillSearch(["Jakarta", "javax", "namespace"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("jakarta-namespace", "Migrate javax APIs to Jakarta namespaces", false),
});
skillCase({
  caseId: "skill-dev-react-view-007",
  split: "dev",
  language: "en",
  query: "Diagnose unnecessary rerenders in ProductList using our standard React performance investigation procedure.",
  source: source("skillsbench", "tasks/react-performance-debugging", "adapted", "Preserves a React performance task with a domain-specific diagnostic skill."),
  annotationReason: "The listed domain skill directly covers the requested diagnosis.",
  groupId: "skillsbench-react-direct-dev",
  first: skillView("react-best-practices"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("react-best-practices", "React rendering and data-fetch performance practices", true),
});
skillCase({
  caseId: "skill-dev-browser-search-008",
  split: "dev",
  language: "en",
  query: "Measure CLS in a real browser before profiling this React page, following the browser procedure our team uses.",
  source: source("skillsbench", "tasks/react-performance-debugging/environment/skills/browser-testing", "adapted", "Preserves dependence on a browser measurement workflow not present in the initial listing."),
  annotationReason: "The browser-testing skill is in the team library but not the listing, requiring search then view.",
  groupId: "skillsbench-browser-search-dev",
  first: skillSearch(["browser", "CLS", "measure"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("browser-testing", "Browser-based CLS and performance measurement workflow", false),
});
skillCase({
  caseId: "skill-dev-security-view-009",
  split: "dev",
  language: "en",
  query: "Replace the deprecated security configuration according to our Spring Security 6 migration procedure.",
  source: source("skillsbench", "tasks/spring-boot-jakarta-migration/environment/skills/spring-security-6", "adapted", "Preserves a targeted framework migration procedure."),
  annotationReason: "The matching Spring Security procedure is present in the listing, making direct view the efficient first action.",
  groupId: "skillsbench-security-direct-dev",
  first: skillView("spring-security-6"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("spring-security-6", "Spring Security 6 migration workflow", true),
});

// Skill Test uses source tasks not used in Dev.
skillCase({
  caseId: "skill-test-scala-search-001",
  split: "test",
  language: "en",
  query: "Translate the Python collection operations into idiomatic Scala 2.13 collections according to our team's mapping rules.",
  source: source("skillsbench", "tasks/python-scala-translation", "adapted", "Preserves selection of a language-specific translation skill among several related skills."),
  annotationReason: "The specialized collection mapping skill is not listed and must be discovered.",
  groupId: "skillsbench-scala-search-test",
  first: skillSearch(["Python", "Scala", "collections"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("python-scala-collections", "Map Python collection operations to idiomatic Scala", false),
});
skillCase({
  caseId: "skill-test-scala-view-002",
  split: "test",
  language: "en",
  query: "Translate the closures and higher-order functions according to our Python-to-Scala functional-programming procedure.",
  source: source("skillsbench", "tasks/python-scala-translation/environment/skills/python-scala-functional", "adapted", "Preserves direct use of a listed language translation workflow."),
  annotationReason: "The exact listed skill should be viewed without a redundant search.",
  groupId: "skillsbench-scala-direct-test",
  first: skillView("python-scala-functional"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("python-scala-functional", "Translate Python functional patterns to Scala", true),
});
skillCase({
  caseId: "skill-test-threejs-view-003",
  split: "test",
  language: "en",
  query: "Extract the part-level hierarchy from object.js and export its Three.js meshes according to our scene-processing workflow.",
  source: source("skillsbench", "tasks/threejs-structure-parser", "adapted", "Preserves a task requiring domain file-format knowledge."),
  annotationReason: "The domain parser skill is explicitly listed and relevant.",
  groupId: "skillsbench-threejs-direct-test",
  first: skillView("threejs"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("threejs", "Parse Three.js scene structure and export part meshes", true),
});
skillCase({
  caseId: "skill-test-threejs-files-004",
  split: "test",
  language: "en",
  query: "Export the link objects with the export_link_objs.mjs utility bundled in our Three.js processing workflow.",
  source: source("skillsbench", "tasks/threejs-structure-parser", "adapted", "Preserves the need to retrieve an attached validation resource."),
  annotationReason: "The resource path is available only after viewing the skill manifest.",
  groupId: "skillsbench-threejs-resource-test",
  first: skillView("threejs"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("threejs", "Parse Three.js scene structure", true, [{ path: "scripts/export_link_objs.mjs", encoding: "utf-8", executable: true }]),
});
skillCase({
  caseId: "skill-test-simpo-search-005",
  split: "test",
  language: "en",
  query: "Set up the SimPO reproduction repository with Python and package versions aligned to the repository declarations, following our reproducibility procedure.",
  source: source("skillsbench", "tasks/simpo-code-reproduction", "adapted", "Preserves dependence on a specialized experiment-reproduction procedure."),
  annotationReason: "The environment-alignment workflow is outside the listing and must be searched.",
  groupId: "skillsbench-simpo-search-test",
  first: skillSearch(["Python", "dependencies", "NLP repository"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("nlp-research-repo-package-installment", "Align Python and declared dependencies for NLP repository reproduction", false),
});
skillCase({
  caseId: "skill-test-codebook-view-006",
  split: "test",
  language: "en",
  query: "Normalize the manufacturing failure reasons against the product codebooks without changing their semantics, following our approved normalization procedure.",
  source: source("skillsbench", "tasks/manufacturing-codebook-normalization", "adapted", "Preserves reliance on a domain normalization procedure."),
  annotationReason: "The domain-specific listed procedure should be opened directly.",
  groupId: "skillsbench-codebook-direct-test",
  first: skillView("manufacturing-failure-reason-codebook-normalization"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("manufacturing-failure-reason-codebook-normalization", "Normalize manufacturing failure reasons against product codebooks", true),
});

function knowledgeAssets(
  knowledgeId: string,
  type: "code-graph" | "wiki",
  name: string,
  about: string,
): EvalFixture["assets"] {
  const tools = type === "code-graph"
    ? [
        { name: "explore", description: "Explore related symbols and source", params: { query: { type: "string", required: true } } },
        { name: "search", description: "Search symbols by name", params: { query: { type: "string", required: true } } },
        { name: "node", description: "Read one symbol", params: { symbol: { type: "string", required: true } } },
        { name: "callers", description: "List callers of a symbol", params: { symbol: { type: "string", required: true } } },
        { name: "callees", description: "List callees of a symbol", params: { symbol: { type: "string", required: true } } },
        { name: "impact", description: "Analyze symbol impact", params: { symbol: { type: "string", required: true } } },
      ]
    : [
        { name: "search", description: "Search wiki pages", params: { query: { type: "string", required: true } } },
        { name: "read_page", description: "Read matched wiki pages", params: { refs: { type: "array", required: true } } },
      ];
  return {
    atomicMemories: [distractorMemory],
    skills: { listed: [distractorSkill], teamLibrary: [distractorSkill] },
    knowledge: [{
      knowledge_id: knowledgeId,
      type,
      name,
      service_url: "http://knowledge.test/v3",
      summary: about,
      repo_slug: type === "code-graph" ? "TencentCloud/TencentDB-Agent-Memory" : undefined,
      branch: type === "code-graph" ? "feat/server_team" : undefined,
      tools,
    }],
  };
}

// Knowledge Dev: CrossCodeEval supplies the cross-file dependency structure, not copied prompts.
knowledgeCase({
  caseId: "knowledge-dev-entrypoint-001",
  split: "dev",
  query: "在当前 TencentDB-Agent-Memory 仓库里，Codex 请求从路由入口到注入流水线经过哪些主要模块？",
  source: source("crosscodeeval", "cross-file-context-entrypoint", "structural-template", "Uses the need for repository-matched cross-file context; query is authored from this repository."),
  annotationReason: "Answering requires broad cross-file structure in the matching repository, so code-graph discovery is appropriate.",
  groupId: "knowledge-codegraph-entry-dev",
  knowledgeId: "cg-tdai0001",
  toolCalls: knowledgeExplore(["Codex", "路由入口", "注入流水线"]),
  assets: knowledgeAssets("cg-tdai0001", "code-graph", "TDAI Code Graph Dev", "Current repository symbol and call graph"),
});
knowledgeCase({
  caseId: "knowledge-dev-callers-002",
  split: "dev",
  query: "找出 renderSkillToolsBlock 的所有调用方以及它们所在的注入阶段。",
  source: source("crosscodeeval", "cross-file-callers", "structural-template", "Uses a caller-relation task over a repository-matched symbol."),
  annotationReason: "All callers and their module relationships are a code-graph task, not a historical memory or workflow.",
  groupId: "knowledge-codegraph-callers-dev",
  knowledgeId: "cg-tdai0002",
  toolCalls: knowledgeSymbolCall("callers", "renderSkillToolsBlock"),
  assets: knowledgeAssets("cg-tdai0002", "code-graph", "TDAI Code Graph Callers", "Symbol callers and dependencies"),
});
knowledgeCase({
  caseId: "knowledge-dev-impact-003",
  split: "dev",
  query: "如果修改 InjectionHook 的 ContextBlock 结构，哪些 Adapter、Injector 和测试面会受到影响？",
  source: source("crosscodeeval", "cross-file-impact", "structural-template", "Uses dependency and impact analysis across files."),
  annotationReason: "The requested impact breadth is exactly what the repository-matched code graph is for.",
  groupId: "knowledge-codegraph-impact-dev",
  knowledgeId: "cg-tdai0003",
  toolCalls: knowledgeSearchThenImpact("InjectionHook"),
  assets: knowledgeAssets("cg-tdai0003", "code-graph", "TDAI Code Graph Impact", "Cross-file impact analysis"),
});
knowledgeCase({
  caseId: "knowledge-dev-dataflow-004",
  split: "dev",
  query: "追踪 spaceId 从 Codex URL 进入后，如何流到 Memory 和 Skill Bridge 请求头。",
  source: source("crosscodeeval", "cross-file-dataflow", "structural-template", "Uses a cross-file data-flow question over a current repository concept."),
  annotationReason: "Tracking a value across handler, context, and bridge modules requires code-graph exploration.",
  groupId: "knowledge-codegraph-dataflow-dev",
  knowledgeId: "cg-tdai0004",
  toolCalls: knowledgeExplore(["spaceId", "Memory Bridge", "Skill Bridge"]),
  assets: knowledgeAssets("cg-tdai0004", "code-graph", "TDAI Code Graph Flow", "Cross-file data flow"),
});
knowledgeCase({
  caseId: "knowledge-dev-wiki-rationale-005",
  split: "dev",
  query: "团队为什么决定让 Skill 正文按需 skill_view，而不是全部放进系统提示词？",
  source: source("project-authored", "wiki-progressive-skill-rationale", "project-authored", "Targets design rationale that cannot be recovered reliably from current code alone."),
  annotationReason: "The question asks for historical design rationale, which belongs to the bound engineering wiki.",
  groupId: "knowledge-wiki-rationale-dev",
  knowledgeId: "wiki-tdai0001",
  toolCalls: knowledgeWikiLookup(["Skill", "按需", "系统提示词"]),
  assets: knowledgeAssets("wiki-tdai0001", "wiki", "TDAI Design Wiki", "Design decisions for progressive Skill disclosure"),
});
knowledgeCase({
  caseId: "knowledge-dev-wiki-definition-006",
  split: "dev",
  query: "团队文档里 model_intent 和 bridge_call 分别代表什么，它们为什么要关联？",
  source: source("project-authored", "wiki-telemetry-definition", "project-authored", "Targets team-specific definitions and rationale."),
  annotationReason: "The requested definitions and intent are documented team knowledge rather than a code-location query.",
  groupId: "knowledge-wiki-definition-dev",
  knowledgeId: "wiki-tdai0002",
  toolCalls: knowledgeWikiLookup(["model_intent", "bridge_call", "关联"]),
  assets: knowledgeAssets("wiki-tdai0002", "wiki", "TDAI Telemetry Wiki", "Definitions and rationale for tool telemetry"),
});

knowledgeCase({
  caseId: "knowledge-test-dependency-001",
  split: "test",
  query: "评估删除 skill_extract Prompt 暴露后，哪些 Bridge allowlist、配置和 handler 路径需要同步检查。",
  source: source("crosscodeeval", "cross-file-dependency-test", "structural-template", "Uses repository-wide dependency analysis on a held-out concept."),
  annotationReason: "The change spans config, prompt, handler, and allowlist modules in the matching repository.",
  groupId: "knowledge-codegraph-dependency-test",
  knowledgeId: "cg-test0001",
  toolCalls: knowledgeExplore(["skill_extract", "allowlist", "handler"]),
  assets: knowledgeAssets("cg-test0001", "code-graph", "TDAI Code Graph Test A", "Repository dependencies for Skill lifecycle tools"),
});
knowledgeCase({
  caseId: "knowledge-test-architecture-002",
  split: "test",
  query: "梳理 Knowledge 资源从 Session 初始化到 renderKnowledgeToolsBlock 的跨文件调用路径。",
  source: source("crosscodeeval", "cross-file-architecture-test", "structural-template", "Uses held-out cross-file architecture tracing."),
  annotationReason: "The request needs a broad repository call path and the code graph matches the current workspace.",
  groupId: "knowledge-codegraph-architecture-test",
  knowledgeId: "cg-test0002",
  toolCalls: knowledgeExplore(["Knowledge", "Session", "renderKnowledgeToolsBlock"]),
  assets: knowledgeAssets("cg-test0002", "code-graph", "TDAI Code Graph Test B", "Knowledge injection architecture"),
});
knowledgeCase({
  caseId: "knowledge-test-wiki-history-003",
  split: "test",
  query: "团队当初为什么采用 Bash 加 curl 的假工具方案，而没有直接实现原生工具拦截？",
  source: source("project-authored", "wiki-fake-tool-history", "project-authored", "Targets a historical architectural decision."),
  annotationReason: "The question asks why a historical design was chosen, which requires the engineering wiki.",
  groupId: "knowledge-wiki-history-test",
  knowledgeId: "wiki-test0001",
  toolCalls: knowledgeWikiLookup(["Bash", "curl", "原生工具"]),
  assets: knowledgeAssets("wiki-test0001", "wiki", "TDAI Architecture History", "Historical decisions behind the proxy tool protocol"),
});
knowledgeCase({
  caseId: "knowledge-test-wiki-tradeoff-004",
  split: "test",
  query: "查团队设计记录，说明 Prompt cache 稳定性和按当前 Query 动态路由之间当时如何取舍。",
  source: source("project-authored", "wiki-cache-routing-tradeoff", "project-authored", "Targets a team-specific design tradeoff."),
  annotationReason: "The requested tradeoff is historical design context rather than current source behavior.",
  groupId: "knowledge-wiki-tradeoff-test",
  knowledgeId: "wiki-test0002",
  toolCalls: knowledgeWikiLookup(["Prompt cache", "动态路由", "取舍"]),
  assets: knowledgeAssets("wiki-test0002", "wiki", "TDAI Prompt Design Records", "Prompt cache and routing tradeoffs"),
});

function negativeAssets(extra: Partial<EvalFixture["assets"]> = {}): EvalFixture["assets"] {
  return { ...baseDistractors(), ...extra };
}

// No-Tool Dev: six suitable self-contained HumanEval tasks plus targeted TDAI hard negatives.
noToolCase({
  caseId: "notool-dev-humaneval-001",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Implement has_close_elements(numbers, threshold): return whether any two numbers are closer than threshold.",
  source: source("human-eval", "HumanEval/0", "adapted", "Keeps the self-contained numeric specification; wording is shortened for an agent query."),
  annotationReason: "All required behavior is in the query; unrelated TDAI assets must not be called.",
  groupId: "humaneval-0-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-002",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Implement a parser that removes spaces and separates a string containing multiple balanced parenthesis groups into individual groups.",
  source: source("human-eval", "HumanEval/1", "adapted", "Keeps a fully specified local parsing task."),
  annotationReason: "The parser task is self-contained and does not depend on historical data or a team workflow.",
  groupId: "humaneval-1-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-003",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Given deposits and withdrawals on an account starting at zero, return whether the running balance ever drops below zero.",
  source: source("human-eval", "HumanEval/3", "adapted", "Keeps the self-contained state-accumulation task."),
  annotationReason: "No TDAI asset is necessary to implement the explicitly defined function.",
  groupId: "humaneval-3-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-004",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Implement parse_music: split the input on spaces and map `o` to 4 beats, `o|` to 2 beats, and `.|` to 1 beat.",
  source: source("human-eval", "HumanEval/17", "adapted", "Keeps a self-contained format conversion task with the mapping in current context."),
  annotationReason: "The current task provides the format rules; a similarly named Skill would be a distraction.",
  groupId: "humaneval-17-dev",
  assets: negativeAssets({ skills: { listed: [{ ...distractorSkill, name: "audio-pipeline", description: "Production audio processing deployment" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-dev-humaneval-005",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Implement factorize(n) so it returns the prime factors of n in ascending order with multiplicity.",
  source: source("human-eval", "HumanEval/25", "adapted", "Keeps an unambiguous self-contained algorithm task."),
  annotationReason: "This requires ordinary coding and tests, not Memory, Skill, or Knowledge.",
  groupId: "humaneval-25-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-006",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Return how many times digit 7 occurs in positive integers below n that are divisible by 11 or 13.",
  source: source("human-eval", "HumanEval/36", "adapted", "Keeps a bounded self-contained counting task."),
  annotationReason: "No external project context or historical information is needed.",
  groupId: "humaneval-36-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-context-007",
  split: "dev",
  category: "answer_already_available",
  query: "根据刚才贴出的配置，Proxy 监听端口是多少？",
  contextMessages: [{ role: "user", content: "server:\n  host: 127.0.0.1\n  port: 8096" }],
  source: source("bfcl", "irrelevance-current-context", "structural-template", "Uses the no-tool condition when the answer is already in the conversation."),
  annotationReason: "The answer 8096 is visible in current context, so calling any TDAI tool is unnecessary.",
  groupId: "context-answer-port-dev",
  answerInCurrentContext: true,
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-context-008",
  split: "dev",
  category: "answer_already_available",
  query: "按照上面的错误栈，失败的是哪个原生依赖？",
  contextMessages: [{ role: "assistant", content: "Could not locate the bindings file for better-sqlite3; storage fell back to fs." }],
  source: source("bfcl", "irrelevance-explicit-evidence", "structural-template", "Uses explicit current evidence as a no-tool boundary."),
  annotationReason: "The dependency name is already in the current assistant message.",
  groupId: "context-answer-native-dep-dev",
  answerInCurrentContext: true,
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-overlap-009",
  split: "dev",
  category: "superficial_overlap",
  query: "用 TypeScript 实现一个带 TTL 的 LRU Cache，并补充单元测试。",
  source: source("metatool", "similar-tool-language-overlap", "structural-template", "Uses similar-description interference; TDAI assets share TypeScript and cache terms but add no required procedure."),
  annotationReason: "Language and cache keyword overlap do not make an unrelated cloud Skill necessary.",
  groupId: "overlap-typescript-cache-dev",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-prompt-cache", name: "prompt-cache-operations", description: "Operate production prompt cache dashboards" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-dev-overlap-010",
  split: "dev",
  category: "superficial_overlap",
  query: "给这个纯函数补一个 Vitest 表格驱动测试，输入输出已经全部列在注释里。",
  source: source("metatool", "similar-tool-testing-overlap", "structural-template", "Uses framework keyword overlap against an unnecessary workflow Skill."),
  annotationReason: "A simple fully specified test does not require the listed migration-test workflow.",
  groupId: "overlap-vitest-dev",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-enterprise-tdd", name: "enterprise-tdd-release", description: "Full release-gated TDD workflow for service migrations" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-dev-overlap-011",
  split: "dev",
  category: "superficial_overlap",
  query: "解释这段本地代码里的 retry 循环为什么最多执行两次。",
  contextMessages: [{ role: "user", content: "for (let attempt = 0; attempt < 2; attempt++) { await retry(); }" }],
  source: source("metatool", "similar-tool-retry-overlap", "structural-template", "Uses a shared retry keyword while the answer is in the current code."),
  annotationReason: "The exact local code is present; historical runbooks and knowledge indexes are unnecessary.",
  groupId: "overlap-retry-local-code-dev",
  assets: negativeAssets({ atomicMemories: [{ memory_id: "mem-retry-policy", type: "instruction", content: "Production HTTP retries use exponential backoff." }] }),
});
noToolCase({
  caseId: "notool-dev-wrong-repo-012",
  split: "dev",
  category: "wrong_tool_hard_negative",
  query: "找出当前本地 calculator 项目中 add 函数的实现并修改返回类型。",
  source: source("bfcl", "irrelevance-wrong-resource", "structural-template", "Uses a provided but irrelevant tool/resource as a hard negative."),
  annotationReason: "The available code graph is for TencentDB-Agent-Memory, not the current calculator workspace; local search is required.",
  groupId: "wrong-repo-calculator-dev",
  assets: negativeAssets({ knowledge: [{ ...distractorKnowledge, knowledge_id: "cg-tdai0090", name: "TDAI Code Graph", repo_slug: "TencentCloud/TencentDB-Agent-Memory" }] }),
});

// No-Tool Test: held-out algorithms and hard-negative stories.
noToolCase({
  caseId: "notool-test-humaneval-001",
  split: "test",
  language: "en",
  category: "self_contained_coding",
  query: "Decode a string produced by left-rotating every full three-character group: rotate each full group one position to the right and leave a final shorter group unchanged.",
  source: source("human-eval", "HumanEval/38", "adapted", "Keeps a fully specified local string transformation."),
  annotationReason: "The transformation is self-contained and no TDAI asset is relevant.",
  groupId: "humaneval-38-test",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-humaneval-002",
  split: "test",
  language: "en",
  category: "self_contained_coding",
  query: "Implement prime_fib(n), returning the nth Fibonacci number that is also prime.",
  source: source("human-eval", "HumanEval/39", "adapted", "Keeps an unambiguous self-contained numeric task."),
  annotationReason: "Ordinary implementation and tests are sufficient.",
  groupId: "humaneval-39-test",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-context-003",
  split: "test",
  category: "answer_already_available",
  query: "刚才给出的 JSON 中 enabled 的值是什么？",
  contextMessages: [{ role: "user", content: "{\"langfuse\":{\"enabled\":true,\"debug\":false}}" }],
  source: source("bfcl", "irrelevance-current-json", "structural-template", "Uses current-context sufficiency as a held-out no-tool case."),
  annotationReason: "The answer is directly visible in the current turn.",
  groupId: "context-answer-json-test",
  answerInCurrentContext: true,
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-context-004",
  split: "test",
  category: "answer_already_available",
  query: "根据上面的测试输出，失败用例数量是多少？",
  contextMessages: [{ role: "assistant", content: "Tests: 42 passed, 2 failed, 44 total." }],
  source: source("bfcl", "irrelevance-current-test-output", "structural-template", "Uses explicit local evidence as a held-out no-tool case."),
  annotationReason: "The count is present in the current context and must not trigger historical search.",
  groupId: "context-answer-tests-test",
  answerInCurrentContext: true,
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-overlap-005",
  split: "test",
  category: "superficial_overlap",
  query: "把这个十行的 React 组件改成使用 useMemo，需求和代码都在当前消息里。",
  contextMessages: [{ role: "user", content: "function Total({items}) { return <p>{items.reduce((a,b)=>a+b,0)}</p>; }" }],
  source: source("metatool", "similar-tool-react-overlap-test", "structural-template", "Uses React keyword overlap with an unnecessary broad performance Skill."),
  annotationReason: "The small exact edit is fully specified; a broad React performance Skill would be overcalling.",
  groupId: "overlap-react-test",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-react-perf", name: "react-best-practices", description: "Comprehensive React performance workflow" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-test-overlap-006",
  split: "test",
  category: "superficial_overlap",
  query: "写一个正则校验普通的 semantic version 字符串，并给出三个示例。",
  source: source("metatool", "similar-tool-version-overlap-test", "structural-template", "Uses version terminology that overlaps a release Skill but does not require it."),
  annotationReason: "The task is a self-contained regex exercise despite version-related distractors.",
  groupId: "overlap-semver-test",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-release", name: "release-versioning", description: "Organization release and versioning process" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-test-wrong-repo-007",
  split: "test",
  category: "wrong_tool_hard_negative",
  query: "在当前本地 weather-cli 仓库中查找 parseForecast 的精确源码并修改一行。",
  source: source("bfcl", "irrelevance-wrong-codegraph-test", "structural-template", "Uses a semantically plausible but repository-mismatched code graph."),
  annotationReason: "The only bound code graph does not match weather-cli, and the task requires current exact local code.",
  groupId: "wrong-repo-weather-test",
  assets: negativeAssets({ knowledge: [{ ...distractorKnowledge, knowledge_id: "cg-tdai0091", name: "TDAI Code Graph", repo_slug: "TencentCloud/TencentDB-Agent-Memory" }] }),
});
noToolCase({
  caseId: "notool-test-local-edit-008",
  split: "test",
  category: "wrong_tool_hard_negative",
  query: "检查我刚刚在未提交工作区里改过的 codexHandler.ts 第 120 行，并修正当前精确代码。",
  source: source("project-authored", "knowledge-local-uncommitted-boundary", "project-authored", "Targets the documented boundary between code-graph snapshots and current local source."),
  annotationReason: "The request explicitly concerns uncommitted exact code, so local Read/Edit tools are correct and TDAI Knowledge is stale by definition.",
  groupId: "local-uncommitted-test",
  assets: negativeAssets({ knowledge: [{
    knowledge_id: "cg-tdai0092",
    type: "code-graph",
    name: "TDAI main branch graph",
    service_url: "http://knowledge.test/v3",
    summary: "Committed main-branch symbol graph",
    repo_slug: "TencentCloud/TencentDB-Agent-Memory",
    branch: "main",
    tools: [
      { name: "search", description: "Search symbols by name", params: { query: { type: "string", required: true } } },
      { name: "node", description: "Read one indexed symbol", params: { symbol: { type: "string", required: true } } },
    ],
  }] }),
});

// Additional targeted cases bring the benchmark to 100 without random sampling.
memoryCase({
  caseId: "memory-dev-quiet-hours-010",
  split: "dev",
  query: "部署通知要遵守我之前设定的免打扰时间，先查出每天几点以后不要发工作消息。",
  source: source("longmemeval-cleaned", "577d4d32", "adapted", "Preserves a stored daily communication preference; rewritten as an engineering notification rule."),
  annotationReason: "The deployment action depends on a stable personal communication rule stored in L1.",
  groupId: "memory-quiet-hours-dev",
  first: memorySearch(["免打扰", "几点", "工作消息"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-quiet-hours", type: "persona", content: "Do not send work notifications after 19:00." }] },
});
memoryCase({
  caseId: "memory-dev-multi-session-011",
  split: "dev",
  query: "过去几次排障里一共提到过哪些导致 Proxy 连接超时的原因？需要汇总多段历史对话。",
  source: source("longmemeval-cleaned", "6d550036", "adapted", "Preserves aggregation across multiple sessions; rewritten as incident-cause aggregation."),
  annotationReason: "The answer requires retrieving messages distributed across several archived sessions.",
  groupId: "memory-multisession-incidents-dev",
  first: conversationSearch(["Proxy", "连接超时", "原因"]),
  assets: { ...baseDistractors(), conversations: [
    { session_id: "sess-timeout-a", messages: [{ role: "user", content: "First timeout was caused by DNS resolution." }] },
    { session_id: "sess-timeout-b", messages: [{ role: "user", content: "Second timeout came from an exhausted connection pool." }] },
  ] },
});
memoryCase({
  caseId: "memory-dev-known-session-page-012",
  split: "dev",
  query: "读取会话 sess-routing-review 从第 50 条开始的下一页消息。",
  contextMessages: [{ role: "assistant", content: "The review session id is sess-routing-review and the first 50 messages were already examined." }],
  source: source("project-authored", "memory-known-session-pagination", "project-authored", "Targets ordered session pagination instead of semantic search."),
  annotationReason: "The exact session and offset are known, so conversation_query is uniquely appropriate.",
  groupId: "memory-conversation-page-dev",
  first: action("tdai_conversation_query", "/memory-bridge/v3/conversation/query", ["session_id"], { exactValues: { session_id: "sess-routing-review", offset: 50 } }),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-routing-review", messages: pagedConversationMessages() }] },
});
memoryCase({
  caseId: "memory-dev-persona-page-013",
  split: "dev",
  query: "分页列出 persona 类型记忆的第二页，每页 20 条。",
  source: source("project-authored", "memory-atomic-pagination", "project-authored", "Targets structured type and pagination fields."),
  annotationReason: "The user requests a typed page rather than a semantic match, selecting atomic_query.",
  groupId: "memory-atomic-page-dev",
  first: atomicQuery({ type: "persona", limit: 20, offset: 20 }),
  assets: { ...baseDistractors(), atomicMemories: pagedPersonaMemories() },
});
memoryCase({
  caseId: "memory-dev-imported-scene-014",
  split: "dev",
  query: "读取 imported_from agent-reviewer 下的 reviews/security-checklist.md 全文。",
  source: source("project-authored", "memory-imported-scene", "project-authored", "Targets read_scene with a path and imported agent identity supplied by the injected index."),
  annotationReason: "The exact imported scene path and source agent are injected, so direct scene read is required.",
  groupId: "memory-imported-scene-dev",
  first: action("tdai_read_scene", "/memory-bridge/v3/scenario/read", ["path", "agent_id"], {
    forbiddenFields: ["user_id", "team_id"],
    exactValues: { path: "reviews/security-checklist.md", agent_id: "agent-reviewer" },
    pathFromFixture: true,
  }),
  scenePathInjected: true,
  assets: { ...baseDistractors(), sceneIndex: [{ path: "reviews/security-checklist.md", summary: "Security review checklist", imported_from: "agent-reviewer" }], scenes: [{ path: "reviews/security-checklist.md", agent_id: "agent-reviewer", content: "Validate auth boundaries and redact secrets." }] },
});
memoryCase({
  caseId: "memory-dev-imported-search-015",
  split: "dev",
  query: "查一下我和已导入 Agent 过去关于 API 限流上限的结论。",
  source: source("project-authored", "memory-imported-atomic-search", "project-authored", "Targets cross-agent semantic memory search using the bridge's default self plus imported scope."),
  annotationReason: "The query asks for a past conclusion that may live in self or imported L1 memory.",
  groupId: "memory-imported-search-dev",
  first: memorySearch(["API 限流", "上限", "结论"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-imported-rate-limit", type: "instruction", content: "The agreed API limit is 100 QPM.", source_agent_id: "agent-platform", source_agent_role: "imported" }] },
});

memoryCase({
  caseId: "memory-test-communication-style-007",
  split: "test",
  query: "按我以前确定的 PR 反馈风格写评论，保持我一贯的表达顺序。",
  source: source("longmemeval-cleaned", "75832dbd", "adapted", "Preserves preference-conditioned recommendation; rewritten as code-review communication style."),
  annotationReason: "The response must follow a stored personal review preference.",
  groupId: "memory-review-style-test",
  first: memorySearch(["PR", "反馈风格", "偏好"]),
  assets: { ...baseDistractors(), atomicMemories: [{ memory_id: "mem-review-style", type: "persona", content: "State the actionable defect first, then one sentence of context." }] },
});
memoryCase({
  caseId: "memory-test-multi-project-008",
  split: "test",
  query: "汇总过去多个会话里我们同时推进过的 MemoryProxy 可观测性改动。",
  source: source("longmemeval-cleaned", "60472f9c", "adapted", "Preserves aggregation of concurrent projects across sessions; rewritten as observability workstreams."),
  annotationReason: "The requested list spans multiple raw conversations and is not represented in current context.",
  groupId: "memory-multisession-observability-test",
  first: conversationSearch(["MemoryProxy", "可观测性", "改动"]),
  assets: { ...baseDistractors(), conversations: [
    { session_id: "sess-langfuse", messages: [{ role: "user", content: "Add Langfuse generations per upstream call." }] },
    { session_id: "sess-clickhouse", messages: [{ role: "user", content: "Add ClickHouse usage reporting." }] },
  ] },
});
memoryCase({
  caseId: "memory-test-known-session-009",
  split: "test",
  query: "顺序读取已知会话 sess-cache-audit 的全部消息。",
  contextMessages: [{ role: "assistant", content: "The archived cache investigation is sess-cache-audit." }],
  source: source("project-authored", "memory-known-session-cache-audit", "project-authored", "Held-out direct session retrieval case."),
  annotationReason: "A known session id and request for ordered messages map directly to conversation_query.",
  groupId: "memory-conversation-query-test",
  first: conversationQuery("sess-cache-audit"),
  assets: { ...baseDistractors(), conversations: [{ session_id: "sess-cache-audit", messages: [{ role: "user", content: "Compare prompt hashes between turns." }] }] },
});
memoryCase({
  caseId: "memory-test-scene-refresh-010",
  split: "test",
  query: "索引里没有 incidents/core/ 条目；先按这个前缀刷新，再读取 worker 租约丢失的场景。",
  source: source("project-authored", "memory-scene-refresh-core", "project-authored", "Held-out list-then-read scene sequence."),
  annotationReason: "The target path is absent from the injected index and must be discovered before reading.",
  groupId: "memory-scene-refresh-test",
  first: scenarioList("incidents/core/"),
  sequence: ["tdai_scenario_ls", "tdai_read_scene"],
  assets: { ...baseDistractors(), sceneIndex: [], scenes: [{ path: "incidents/core/worker-lease-loss.md", summary: "Worker lease loss", content: "Reacquire the lease and replay the queued extraction." }] },
});

skillCase({
  caseId: "skill-dev-hibernate-view-010",
  split: "dev",
  language: "en",
  query: "Adapt the entity mappings to Hibernate 6 according to our ORM upgrade procedure, including changed annotations and query behavior.",
  source: source("skillsbench", "tasks/spring-boot-jakarta-migration/environment/skills/hibernate-upgrade", "adapted", "Preserves a specialized library-upgrade procedure."),
  annotationReason: "The exact specialized skill is listed and should be viewed directly.",
  groupId: "skillsbench-hibernate-direct-dev",
  first: skillView("hibernate-upgrade"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("hibernate-upgrade", "Hibernate 5 to 6 entity and query migration", true),
});
skillCase({
  caseId: "skill-dev-restclient-search-011",
  split: "dev",
  language: "en",
  query: "Replace RestTemplate with RestClient according to our team's migration procedure and compatibility checks.",
  source: source("skillsbench", "tasks/spring-boot-jakarta-migration/environment/skills/restclient-migration", "adapted", "Preserves discovery of a focused migration skill among related Spring skills."),
  annotationReason: "The focused workflow is outside the listing and must be searched before viewing.",
  groupId: "skillsbench-restclient-search-dev",
  first: skillSearch(["RestTemplate", "RestClient", "migration"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("restclient-migration", "Migrate RestTemplate calls to Spring RestClient", false),
});
skillCase({
  caseId: "skill-dev-browser-files-012",
  split: "dev",
  language: "en",
  query: "Run the CLS check with the measure-cls.ts utility bundled in our browser-testing procedure.",
  source: source("skillsbench", "tasks/react-performance-debugging/environment/skills/browser-testing/measure-cls.ts", "adapted", "Preserves use of a bundled browser measurement asset."),
  annotationReason: "The named resource requires viewing the listed skill manifest first.",
  groupId: "skillsbench-browser-resource-dev",
  first: skillView("browser-testing"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("browser-testing", "Browser performance measurement workflow", true, [{ path: "measure-cls.ts", encoding: "utf-8", executable: false }]),
});
skillCase({
  caseId: "skill-dev-grpo-reference-013",
  split: "dev",
  language: "en",
  query: "Analyze the GRPO trainer loop using our internal trainer-internals reference before proposing a fix.",
  source: source("skillsbench", "tasks/debug-trl-grpo/environment/skills/grpo/references/grpo-trainer-internals.md", "adapted", "Preserves retrieval of a skill reference needed for diagnosis."),
  annotationReason: "The reference file is accessible only after viewing the Skill manifest.",
  groupId: "skillsbench-grpo-reference-dev",
  first: skillView("grpo"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("grpo", "GRPO algorithm and trainer internals", true, [{ path: "references/grpo-trainer-internals.md", encoding: "utf-8" }]),
});
skillCase({
  caseId: "skill-dev-dialogue-search-014",
  split: "dev",
  language: "en",
  query: "Implement the dialogue graph parser according to the parser procedure maintained by our team; the currently shown workflows do not cover dialogue parsing.",
  source: source("skillsbench", "tasks/dialogue-parser/environment/skills/dialogue-graph", "adapted", "Preserves discovery when the relevant domain skill is not listed."),
  annotationReason: "The task explicitly needs a team parser workflow absent from the injected listing.",
  groupId: "skillsbench-dialogue-search-dev",
  first: skillSearch(["dialogue", "graph", "parser"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("dialogue-graph", "Parse dialogue scripts into graphs", false),
});
skillCase({
  caseId: "skill-dev-react-files-015",
  split: "dev",
  language: "en",
  query: "Fix the sequential server fetches according to our React performance rule for parallel server fetching.",
  source: source("skillsbench", "tasks/react-performance-debugging/environment/skills/react-best-practices/rules/server-parallel-fetching.md", "adapted", "Preserves retrieval of a specific rule asset from a large Skill."),
  annotationReason: "The requested rule is a resource file, requiring view then files_read.",
  groupId: "skillsbench-react-reference-dev",
  first: skillView("react-best-practices"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("react-best-practices", "React performance practices", true, [{ path: "rules/server-parallel-fetching.md", encoding: "utf-8" }]),
});

skillCase({
  caseId: "skill-test-scala-libraries-007",
  split: "test",
  language: "en",
  query: "Replace the Python library calls with Scala equivalents according to our library-mapping procedure.",
  source: source("skillsbench", "tasks/python-scala-translation/environment/skills/python-scala-libraries", "adapted", "Held-out direct-view case for a library mapping skill."),
  annotationReason: "The exact listed mapping skill is directly relevant.",
  groupId: "skillsbench-scala-libraries-test",
  first: skillView("python-scala-libraries"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("python-scala-libraries", "Map Python libraries to Scala alternatives", true),
});
skillCase({
  caseId: "skill-test-scala-syntax-view-008",
  split: "test",
  language: "en",
  query: "Translate the tokenizer syntax to Scala 2.13 according to our syntax-mapping procedure.",
  source: source("skillsbench", "tasks/python-scala-translation/environment/skills/python-scala-syntax-mapping", "adapted", "Held-out direct use of the actual syntax-mapping Skill."),
  annotationReason: "The exact syntax-mapping Skill is listed and should be viewed directly.",
  groupId: "skillsbench-scala-syntax-resource-test",
  first: skillView("python-scala-syntax-mapping"),
  sequence: ["skill_view"],
  listed: true,
  assets: skillAssets("python-scala-syntax-mapping", "Python to Scala syntax mapping", true),
});
skillCase({
  caseId: "skill-test-simpo-files-009",
  split: "test",
  language: "en",
  query: "Extract the SimPO loss definition from paper.pdf using the PDF workflow's bundled reference.md guidance.",
  source: source("skillsbench", "tasks/simpo-code-reproduction/environment/skills/pdf/reference.md", "adapted", "Held-out dependence on a real reference bundled with the PDF skill."),
  annotationReason: "The requested PDF reference requires view followed by resource read.",
  groupId: "skillsbench-simpo-resource-test",
  first: skillView("pdf"),
  sequence: ["skill_view", "skill_files_read"],
  listed: true,
  assets: skillAssets("pdf", "Read and process PDF documents and references", true, [{ path: "reference.md", encoding: "utf-8" }]),
});
skillCase({
  caseId: "skill-test-codebook-search-010",
  split: "test",
  language: "en",
  query: "Normalize the manufacturing mapping table using our team's failure-reason codebook procedure; the currently shown workflows do not cover manufacturing data.",
  source: source("skillsbench", "tasks/manufacturing-codebook-normalization", "adapted", "Held-out discovery of a domain procedure absent from the listing."),
  annotationReason: "A specific team procedure is necessary but not listed, so search then view is required.",
  groupId: "skillsbench-codebook-search-test",
  first: skillSearch(["manufacturing", "codebook", "normalization"]),
  sequence: ["skill_search", "skill_view"],
  listed: false,
  assets: skillAssets("manufacturing-failure-reason-codebook-normalization", "Normalize manufacturing failure reasons against codebooks", false),
});

knowledgeCase({
  caseId: "knowledge-dev-callees-007",
  split: "dev",
  query: "分析 createCodexTdaiClient 会继续调用哪些客户端方法和 Bridge 路径。",
  source: source("crosscodeeval", "cross-file-callees", "structural-template", "Targets outgoing symbol relationships in the matching repository."),
  annotationReason: "The complete callee relationship spans files and fits code-graph traversal.",
  groupId: "knowledge-codegraph-callees-dev",
  knowledgeId: "cg-tdai0005",
  toolCalls: knowledgeSymbolCall("callees", "createCodexTdaiClient"),
  assets: knowledgeAssets("cg-tdai0005", "code-graph", "TDAI Callee Graph", "Outgoing calls and bridge paths"),
});
knowledgeCase({
  caseId: "knowledge-dev-existing-implementation-008",
  split: "dev",
  query: "在新增 Prompt token 统计前，确认仓库里是否已经有注入块字符数、hash 或 usage 的实现。",
  source: source("crosscodeeval", "cross-file-existing-concept", "structural-template", "Targets broad concept search to avoid duplicate implementation."),
  annotationReason: "The query asks whether a concept exists anywhere in the matching repository.",
  groupId: "knowledge-codegraph-existing-dev",
  knowledgeId: "cg-tdai0006",
  toolCalls: knowledgeExplore(["Prompt", "token", "hash", "usage"]),
  assets: knowledgeAssets("cg-tdai0006", "code-graph", "TDAI Concept Graph", "Repository-wide concept and symbol search"),
});
knowledgeCase({
  caseId: "knowledge-dev-wiki-incident-009",
  split: "dev",
  query: "查团队事故复盘，为什么 storage 从 sqlite 降级到 fs 会被标成多节点风险。",
  source: source("project-authored", "wiki-storage-degradation-rationale", "project-authored", "Targets incident rationale unavailable from a single code location."),
  annotationReason: "The causal history belongs to the engineering incident wiki.",
  groupId: "knowledge-wiki-incident-dev",
  knowledgeId: "wiki-tdai0003",
  toolCalls: knowledgeWikiLookup(["storage", "sqlite", "fs", "多节点"]),
  assets: knowledgeAssets("wiki-tdai0003", "wiki", "TDAI Incident Reviews", "Storage degradation incidents and operational risks"),
});
knowledgeCase({
  caseId: "knowledge-dev-wiki-term-010",
  split: "dev",
  query: "团队语境里的 asset capability 和 runtime capability 有什么区别？",
  source: source("project-authored", "wiki-capability-terminology", "project-authored", "Targets a team-specific domain definition."),
  annotationReason: "This is a team terminology question whose authoritative answer is in the wiki.",
  groupId: "knowledge-wiki-term-dev",
  knowledgeId: "wiki-tdai0004",
  toolCalls: knowledgeWikiLookup(["asset capability", "runtime capability", "区别"]),
  assets: knowledgeAssets("wiki-tdai0004", "wiki", "TDAI Domain Glossary", "Definitions of asset and runtime capabilities"),
});

knowledgeCase({
  caseId: "knowledge-test-remove-impact-005",
  split: "test",
  query: "如果移除 MEMORY_TOOLS_GUIDE，找出所有引用、快照和注入顺序约束。",
  source: source("crosscodeeval", "cross-file-removal-impact-test", "structural-template", "Held-out repository-wide removal impact question."),
  annotationReason: "Safe removal requires cross-file references and ordering relationships from the matching graph.",
  groupId: "knowledge-codegraph-removal-test",
  knowledgeId: "cg-test0003",
  toolCalls: knowledgeExplore(["MEMORY_TOOLS_GUIDE", "引用", "注入顺序"]),
  assets: knowledgeAssets("cg-test0003", "code-graph", "TDAI Removal Impact Graph", "References and injection ordering"),
});
knowledgeCase({
  caseId: "knowledge-test-wiki-lesson-006",
  split: "test",
  query: "从团队踩坑记录里查一下，为什么普通 Prompt 压缩曾经导致工具参数丢失。",
  source: source("project-authored", "wiki-prompt-compression-lesson", "project-authored", "Held-out engineering lesson and rationale."),
  annotationReason: "The question asks for a historical lesson documented in the team wiki.",
  groupId: "knowledge-wiki-lesson-test",
  knowledgeId: "wiki-test0003",
  toolCalls: knowledgeWikiLookup(["Prompt 压缩", "工具参数", "丢失"]),
  assets: knowledgeAssets("wiki-test0003", "wiki", "TDAI Prompt Lessons", "Prompt compression failures and mitigations"),
});

noToolCase({
  caseId: "notool-dev-humaneval-013",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Compute the mean absolute deviation of a non-empty list of numbers around its arithmetic mean.",
  source: source("human-eval", "HumanEval/4", "adapted", "Selected as a self-contained numeric aggregation task."),
  annotationReason: "The formula and input are fully specified; TDAI assets are irrelevant.",
  groupId: "humaneval-4-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-014",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Filter a list of strings to those containing a given substring while preserving order.",
  source: source("human-eval", "HumanEval/7", "adapted", "Selected as a fully specified list-filtering task."),
  annotationReason: "No historical, procedural, or cross-file information is required.",
  groupId: "humaneval-7-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-015",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Return both the sum and product of all integers in the input list, using 1 as the empty product.",
  source: source("human-eval", "HumanEval/8", "adapted", "Selected as a self-contained dual-aggregation task."),
  annotationReason: "The current specification is complete and ordinary coding is sufficient.",
  groupId: "humaneval-8-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-humaneval-016",
  split: "dev",
  language: "en",
  category: "self_contained_coding",
  query: "Implement binary string XOR for two equal-length strings containing only 0 and 1.",
  source: source("human-eval", "HumanEval/11", "adapted", "Selected as a fully bounded string operation."),
  annotationReason: "The query contains all constraints and requires no TDAI lookup.",
  groupId: "humaneval-11-dev",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-dev-profile-l3-017",
  split: "dev",
  category: "answer_already_available",
  query: "继续给这个 TypeScript 服务补测试，沿用我的默认测试框架。",
  contextMessages: [{ role: "assistant", content: "The service implementation is ready for its test pass." }],
  source: source("bfcl", "irrelevance-profile-l3-test-framework", "structural-template", "Adapts the no-tool sufficiency boundary to an injected L3 preference."),
  annotationReason: "The injected L3 profile already states that the user's default TypeScript test framework is Vitest.",
  groupId: "profile-l3-test-framework-dev",
  answerInCurrentContext: false,
  answerInProfileL3: true,
  assets: negativeAssets({ profileL3: ["For TypeScript services, the user uses Vitest as the default test framework."] }),
});
noToolCase({
  caseId: "notool-dev-profile-l3-018",
  split: "dev",
  category: "answer_already_available",
  query: "这个 PR 描述按我一贯偏好的风格写，保持简短。",
  contextMessages: [{ role: "assistant", content: "The implementation and verification details are ready to summarize." }],
  source: source("bfcl", "irrelevance-profile-l3-pr-style", "structural-template", "Adapts the no-tool sufficiency boundary to an injected L3 writing preference."),
  annotationReason: "The injected L3 profile already contains the user's preference for concise pull-request descriptions.",
  groupId: "profile-l3-pr-style-dev",
  answerInCurrentContext: false,
  answerInProfileL3: true,
  assets: negativeAssets({ profileL3: ["The user prefers concise pull-request descriptions with no ceremonial sections."] }),
});
noToolCase({
  caseId: "notool-dev-skill-overlap-019",
  split: "dev",
  category: "superficial_overlap",
  query: "把一个简单的 Java record 转成 TypeScript interface，字段已经全部给出。",
  source: source("metatool", "similar-tool-language-translation", "structural-template", "Tests a translation keyword collision with a broad migration Skill."),
  annotationReason: "A trivial fully specified type translation does not require a repository migration workflow.",
  groupId: "overlap-java-typescript-dev",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-java-migration", name: "spring-boot-migration", description: "Full Spring Boot repository migration" }], teamLibrary: [] } }),
});
noToolCase({
  caseId: "notool-dev-memory-overlap-020",
  split: "dev",
  category: "superficial_overlap",
  query: "实现一个名为 MemoryStore 的内存 Map 封装，接口定义已在当前文件。",
  source: source("metatool", "similar-tool-memory-name", "structural-template", "Tests lexical collision between a class named MemoryStore and historical-memory tools."),
  annotationReason: "The word Memory names a local data structure, not user history.",
  groupId: "overlap-memory-class-dev",
  assets: negativeAssets({ atomicMemories: [{ memory_id: "mem-storage-history", type: "episodic", content: "Past discussion about cloud storage." }] }),
});

noToolCase({
  caseId: "notool-test-humaneval-009",
  split: "test",
  language: "en",
  category: "self_contained_coding",
  query: "Return the longest string in a list, choosing the first one on ties and returning None for an empty list.",
  source: source("human-eval", "HumanEval/12", "adapted", "Selected as a held-out self-contained list task."),
  annotationReason: "All behavior is specified locally.",
  groupId: "humaneval-12-test",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-humaneval-010",
  split: "test",
  language: "en",
  category: "self_contained_coding",
  query: "Return every prefix of an input string from shortest to longest.",
  source: source("human-eval", "HumanEval/14", "adapted", "Selected as a held-out self-contained string task."),
  annotationReason: "This is an ordinary local algorithm with no TDAI dependency.",
  groupId: "humaneval-14-test",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-humaneval-011",
  split: "test",
  language: "en",
  category: "self_contained_coding",
  query: "Count distinct characters in a string case-insensitively.",
  source: source("human-eval", "HumanEval/16", "adapted", "Selected as a held-out self-contained counting task."),
  annotationReason: "The task requires no project history or specialized workflow.",
  groupId: "humaneval-16-test",
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-profile-l3-012",
  split: "test",
  category: "answer_already_available",
  query: "格式化这次修改时使用我默认的 TypeScript 格式化工具。",
  contextMessages: [{ role: "assistant", content: "All changed TypeScript files have been identified." }],
  source: source("bfcl", "irrelevance-profile-l3-formatter", "structural-template", "Held-out no-tool sufficiency boundary using an injected L3 tooling preference."),
  annotationReason: "The injected L3 profile already identifies Biome as the user's default TypeScript formatter.",
  groupId: "profile-l3-formatter-test",
  answerInCurrentContext: false,
  answerInProfileL3: true,
  assets: negativeAssets({ profileL3: ["The user's default TypeScript formatter is Biome."] }),
});
noToolCase({
  caseId: "notool-test-knowledge-mismatch-013",
  split: "test",
  category: "wrong_tool_hard_negative",
  query: "解释当前本地 notes.txt 的第三行是什么意思。",
  contextMessages: [{ role: "user", content: "notes.txt line 3: retry_budget = 0" }],
  source: source("bfcl", "irrelevance-local-file-vs-knowledge", "structural-template", "Tests rejection of a repository knowledge resource for an exact unrelated local file."),
  annotationReason: "The exact line is in current context and the bound graph is unrelated.",
  groupId: "wrong-resource-notes-test",
  answerInCurrentContext: true,
  assets: negativeAssets(),
});
noToolCase({
  caseId: "notool-test-skill-overlap-014",
  split: "test",
  category: "superficial_overlap",
  query: "给现有函数加一条边界值断言；测试文件和预期结果都已提供。",
  contextMessages: [{ role: "user", content: "expect(clamp(11, 0, 10)).toBe(10)" }],
  source: source("metatool", "similar-tool-test-keyword-heldout", "structural-template", "Held-out keyword collision with a full TDD workflow."),
  annotationReason: "One explicit assertion does not require loading a broad test workflow Skill.",
  groupId: "overlap-single-assertion-test",
  assets: negativeAssets({ skills: { listed: [{ skill_id: "skl-tdd", name: "service-tdd-workflow", description: "End-to-end service TDD and release verification" }], teamLibrary: [] } }),
});
