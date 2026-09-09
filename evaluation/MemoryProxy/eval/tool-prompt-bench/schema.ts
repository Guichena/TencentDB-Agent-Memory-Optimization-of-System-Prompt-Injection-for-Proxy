export type EvalSplit = "dev" | "test";
export type EvalLanguage = "zh" | "en" | "mixed";
export type EvalFamily = "memory" | "skill" | "knowledge";

export type EvalCategory =
  | "memory_positive"
  | "skill_positive"
  | "knowledge_positive"
  | "self_contained_coding"
  | "answer_already_available"
  | "superficial_overlap"
  | "wrong_tool_hard_negative";

export interface SourceRef {
  dataset: string;
  sourceId: string;
  revision: string;
  license: string;
  usage: "adapted" | "structural-template" | "project-authored";
  adaptation: string;
}

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ArgumentRules {
  requiredFields?: string[];
  forbiddenFields?: string[];
  stringContainsAny?: Record<string, string[]>;
  exactValues?: Record<string, unknown>;
  pathFromFixture?: boolean;
  valueFromPreviousStep?: boolean;
}

export interface AllowedToolAction {
  tool: string;
  endpoint: string;
  argumentRules?: ArgumentRules;
}

export interface KnowledgeCallExpectation {
  toolName: string;
  paramRules: ArgumentRules;
}

export interface ToolPromptEvalCase {
  caseId: string;
  schemaVersion: "1.0";
  split: EvalSplit;
  language: EvalLanguage;
  category: EvalCategory;
  query: string;
  contextMessages?: ContextMessage[];
  source: SourceRef;
  capabilities: {
    chatMemory: boolean;
    skill: boolean;
    llmWiki: boolean;
    codeGraph: boolean;
    allowLlmWrite: boolean;
    allowLlmExtract: boolean;
  };
  gold: {
    needTdaiTool: boolean;
    family: EvalFamily | null;
    allowedFirstActions: AllowedToolAction[];
    allowedSequences: string[][];
    /** Ordered HTTP actions after the first one for non-Knowledge flows. */
    expectedFollowupActions?: AllowedToolAction[];
    /** Ordered Knowledge /tools/call bodies expected after discovery. */
    expectedKnowledgeCalls?: KnowledgeCallExpectation[];
    forbiddenTools: string[];
    maxTdaiCalls: number;
  };
  preconditions: {
    answerInCurrentContext: boolean;
    answerInProfileL3: boolean;
    scenePathInjected: boolean;
    goldSkillInListing: boolean;
    knowledgeMatchesWorkspace: boolean;
  };
  fixtureIds: string[];
  annotationReason: string;
  groupId: string;
}

export interface EvalFixture {
  fixtureId: string;
  split: EvalSplit;
  description: string;
  assets: {
    profileL3?: string[];
    atomicMemories?: Array<Record<string, unknown>>;
    conversations?: Array<Record<string, unknown>>;
    sceneIndex?: Array<Record<string, unknown>>;
    scenes?: Array<Record<string, unknown>>;
    skills?: {
      listed: Array<Record<string, unknown>>;
      teamLibrary: Array<Record<string, unknown>>;
    };
    knowledge?: Array<Record<string, unknown>>;
  };
}
