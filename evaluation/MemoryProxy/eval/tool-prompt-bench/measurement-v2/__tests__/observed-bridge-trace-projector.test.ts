import { describe, expect, it } from "vitest";

import {
  projectObservedBridgeTrace,
  type ObservedToolEntry,
} from "../observed-bridge-trace-projector.js";

describe("projectObservedBridgeTrace", () => {
  it("projects one completed Memory 2xx entry from production observer facts", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-memory-2xx",
      caseId: "case-memory-2xx",
      variantId: "V0",
      activeSessionId: "session-memory-2xx",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "memory-entry-1",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "deployment decision" },
        requestBodyCapture: {
          outcome: "captured",
          rawBodySha256: "a".repeat(64),
        },
        correlationHeaders: {
          "x-conversation-id": "session-memory-2xx",
          "x-tdai-team-id": "team-runtime-a",
        },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "memory-entry-1",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { records: [{ id: "memory-1" }] },
        responseBodySha256: "b".repeat(64),
        durationMs: 12,
      }],
    });

    expect(result.observation).toEqual({
      evaluationSchemaVersion: 2,
      runId: "run-memory-2xx",
      caseId: "case-memory-2xx",
      variantId: "V0",
      rawTraceStatus: "complete",
      attempts: [{
        attemptId: "memory-entry-1",
        executorBound: true,
        family: "memory",
        tool: "tdai_memory_search",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        arguments: { query: "deployment decision" },
        status: 200,
        response: { records: [{ id: "memory-1" }] },
      }],
    });
    expect(result.rawEvidence.entries).toHaveLength(1);
    expect(result.rawEvidence.completions).toHaveLength(1);
    expect(result.rawEvidence.issues).toEqual([]);
  });

  it("pairs completions by correlation id while preserving begin order and a Skill 4xx fact", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-begin-order",
      caseId: "case-begin-order",
      variantId: "V1",
      activeSessionId: "session-begin-order",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "skill-entry-first",
        family: "skill",
        endpoint: "/skill-bridge/v3/skill/search",
        method: "POST",
        requestBody: { query: "missing workflow" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "c".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-begin-order" },
      }, {
        correlationId: "memory-entry-second",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/query",
        method: "POST",
        requestBody: { type: "instruction" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "d".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-begin-order" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "memory-entry-second",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/query",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { records: [] },
        durationMs: 4,
      }, {
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "skill-entry-first",
        family: "skill",
        endpoint: "/skill-bridge/v3/skill/search",
        method: "POST",
        outcome: "response",
        status: 404,
        responseBody: { error: "not found" },
        durationMs: 3,
      }],
    });

    expect(result.observation).toMatchObject({
      rawTraceStatus: "complete",
      attempts: [{
        attemptId: "skill-entry-first",
        family: "skill",
        tool: "skill_search",
        endpoint: "/skill-bridge/v3/skill/search",
        status: 404,
        response: { error: "not found" },
      }, {
        attemptId: "memory-entry-second",
        family: "memory",
        tool: "tdai_atomic_query",
        endpoint: "/memory-bridge/v3/atomic/query",
        status: 200,
        response: { records: [] },
      }],
    });
  });

  it("canonicalizes mounted Knowledge list and call paths only in the M0 projection", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-knowledge-canonical",
      caseId: "case-knowledge-canonical",
      variantId: "V2",
      activeSessionId: "session-knowledge-canonical",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "knowledge-list",
        family: "knowledge",
        endpoint: "/v3/tools/list",
        method: "POST",
        requestBody: { knowledge_id: "wiki-runtime-1" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "e".repeat(64) },
        correlationHeaders: {
          "x-conversation-id": "codex:session-knowledge-canonical",
          "x-tdai-agent-source": "codex",
        },
      }, {
        correlationId: "knowledge-call",
        family: "knowledge",
        endpoint: "/v3/tools/call",
        method: "POST",
        requestBody: {
          knowledge_id: "wiki-runtime-1",
          tool_name: "search_pages",
          params: { query: "rollback" },
        },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "f".repeat(64) },
        correlationHeaders: {
          "x-conversation-id": "codex:session-knowledge-canonical",
          "x-tdai-agent-source": "codex",
        },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "knowledge-list",
        family: "knowledge",
        endpoint: "/v3/tools/list",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { tools: [{ name: "search_pages" }] },
        durationMs: 2,
      }, {
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "knowledge-call",
        family: "knowledge",
        endpoint: "/v3/tools/call",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { results: [] },
        durationMs: 5,
      }],
    });

    expect(result.observation.attempts).toMatchObject([{
      attemptId: "knowledge-list",
      tool: "knowledge_tools_list",
      endpoint: "/tools/list",
    }, {
      attemptId: "knowledge-call",
      tool: "knowledge_tools_call",
      endpoint: "/tools/call",
    }]);
    expect(result.rawEvidence.entries.map((entry) => entry.endpoint)).toEqual([
      "/v3/tools/list",
      "/v3/tools/call",
    ]);
    expect(result.rawEvidence.completions.map((completion) => completion.endpoint)).toEqual([
      "/v3/tools/list",
      "/v3/tools/call",
    ]);
  });

  it("maps a bridge 5xx and observer failure carrying 202 to infrastructure without accepted facts", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-infrastructure",
      caseId: "case-infrastructure",
      variantId: "V3",
      activeSessionId: "session-infrastructure",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "memory-503",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "release" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "1".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-infrastructure" },
      }, {
        correlationId: "skill-observer-failure",
        family: "skill",
        endpoint: "/skill-bridge/v3/skill/search",
        method: "POST",
        requestBody: { query: "release workflow" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "2".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-infrastructure" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "memory-503",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 503,
        responseBody: { error: "upstream unavailable" },
        durationMs: 30,
      }, {
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "skill-observer-failure",
        family: "skill",
        endpoint: "/skill-bridge/v3/skill/search",
        method: "POST",
        outcome: "failure",
        status: 202,
        durationMs: 8,
        failure: {
          name: "TypeError",
          message: "response clone leaked super-secret-user-key",
        },
      }],
    });

    expect(result.observation.rawTraceStatus).toBe("partial");
    expect(result.observation.attempts).toMatchObject([{
      attemptId: "memory-503",
      infrastructureFailure: { kind: "bridge_5xx", code: "http_503" },
    }, {
      attemptId: "skill-observer-failure",
      infrastructureFailure: { kind: "bridge_5xx", code: "observer_failure:TypeError" },
    }]);
    for (const attempt of result.observation.attempts) {
      expect(attempt).not.toHaveProperty("status");
      expect(attempt).not.toHaveProperty("response");
    }
    expect(result.rawEvidence.completions[1].failure).toMatchObject({
      name: "TypeError",
      category: "observer_failure",
      messageSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain("super-secret-user-key");
  });

  it("marks failed request-body capture partial and never promotes the untrusted body", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-body-capture-failed",
      caseId: "case-body-capture-failed",
      variantId: "V0-C",
      activeSessionId: "session-body-capture-failed",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "memory-body-capture-failed",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "must not be trusted" },
        requestBodyCapture: {
          outcome: "failed",
          failure: { stage: "request_body_clone", name: "DataCloneError" },
        },
        correlationHeaders: { "x-conversation-id": "session-body-capture-failed" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "memory-body-capture-failed",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { records: [] },
        durationMs: 2,
      }],
    });

    expect(result.observation.rawTraceStatus).toBe("partial");
    expect(result.observation.attempts[0]).toMatchObject({
      attemptId: "memory-body-capture-failed",
      executorBound: true,
      infrastructureFailure: {
        kind: "trace_missing",
        code: "request_body_capture_failed:DataCloneError",
      },
    });
    expect(result.observation.attempts[0]).not.toHaveProperty("arguments");
    expect(result.observation.attempts[0]).not.toHaveProperty("status");
    expect(result.observation.attempts[0]).not.toHaveProperty("response");
  });

  it("fails correlation integrity closed for missing, orphan, and duplicate facts", () => {
    const baseEntry = {
      correlationId: "correlation-integrity",
      family: "memory" as const,
      endpoint: "/memory-bridge/v3/atomic/search",
      method: "POST",
      requestBody: { query: "integrity" },
      requestBodyCapture: { outcome: "captured" as const, rawBodySha256: "3".repeat(64) },
      correlationHeaders: { "x-conversation-id": "session-integrity" },
    };
    const baseCompletion = {
      schemaVersion: "task1.tool-execution-completion.v1" as const,
      correlationId: "correlation-integrity",
      family: "memory" as const,
      endpoint: "/memory-bridge/v3/atomic/search",
      method: "POST",
      outcome: "response" as const,
      status: 200,
      responseBody: { records: [] },
      durationMs: 1,
    };
    const common = {
      runId: "run-integrity",
      caseId: "case-integrity",
      variantId: "V0",
      activeSessionId: "session-integrity",
      turnCompletion: { outcome: "completed" as const },
    };

    const missing = projectObservedBridgeTrace({
      ...common,
      entries: [baseEntry],
      completions: [],
    });
    expect(missing.observation).toMatchObject({
      rawTraceStatus: "partial",
      attempts: [{
        attemptId: "correlation-integrity",
        infrastructureFailure: { kind: "trace_missing", code: "missing_completion" },
      }],
    });

    const orphan = projectObservedBridgeTrace({
      ...common,
      entries: [],
      completions: [baseCompletion],
    });
    expect(orphan.observation).toMatchObject({ rawTraceStatus: "partial", attempts: [] });
    expect(orphan.rawEvidence.issues).toContainEqual(expect.objectContaining({
      kind: "trace_missing",
      code: "orphan_completion",
    }));

    const duplicateBegin = projectObservedBridgeTrace({
      ...common,
      entries: [baseEntry, { ...baseEntry }],
      completions: [baseCompletion],
    });
    expect(duplicateBegin.observation).toMatchObject({ rawTraceStatus: "partial", attempts: [] });
    expect(duplicateBegin.rawEvidence.issues).toContainEqual(expect.objectContaining({
      code: "duplicate_begin",
    }));

    const duplicateCompletion = projectObservedBridgeTrace({
      ...common,
      entries: [baseEntry],
      completions: [baseCompletion, { ...baseCompletion }],
    });
    expect(duplicateCompletion.observation).toMatchObject({
      rawTraceStatus: "partial",
      attempts: [{
        attemptId: "correlation-integrity",
        infrastructureFailure: { kind: "trace_missing", code: "duplicate_completion" },
      }],
    });
    expect(duplicateCompletion.observation.attempts[0]).not.toHaveProperty("status");

  });

  it("keeps window-associated wrong or missing session headers as failed model attempts", () => {
    const entries: ObservedToolEntry[] = [{
      correlationId: "wrong-session",
      family: "memory" as const,
      endpoint: "/memory-bridge/v3/atomic/search",
      method: "POST",
      requestBody: { query: "wrong session" },
      requestBodyCapture: { outcome: "captured" as const, rawBodySha256: "6".repeat(64) },
      correlationHeaders: { "x-conversation-id": "session-other" },
    }, {
      correlationId: "missing-session",
      family: "skill" as const,
      endpoint: "/skill-bridge/v3/skill/search",
      method: "POST",
      requestBody: { query: "missing session" },
      requestBodyCapture: { outcome: "captured" as const, rawBodySha256: "7".repeat(64) },
      correlationHeaders: {},
    }];
    const completions = entries.map((entry, index) => ({
      schemaVersion: "task1.tool-execution-completion.v1" as const,
      correlationId: entry.correlationId,
      family: entry.family,
      endpoint: entry.endpoint,
      method: entry.method,
      outcome: "response" as const,
      status: index === 0 ? 200 : 401,
      responseBody: { ignored: true },
      durationMs: 1,
    }));

    const result = projectObservedBridgeTrace({
      runId: "run-session-header-model-error",
      caseId: "case-session-header-model-error",
      variantId: "V2",
      activeSessionId: "session-active",
      turnCompletion: { outcome: "completed" },
      entries,
      completions,
    });

    expect(result.observation.rawTraceStatus).toBe("complete");
    expect(result.observation.attempts).toMatchObject([{
      attemptId: "wrong-session",
      executorBound: true,
      tool: "tdai_memory_search",
      arguments: { query: "wrong session" },
      malformedReason: "session_correlation_header_mismatch",
    }, {
      attemptId: "missing-session",
      executorBound: true,
      tool: "skill_search",
      arguments: { query: "missing session" },
      malformedReason: "session_correlation_header_mismatch",
    }]);
    for (const attempt of result.observation.attempts) {
      expect(attempt).not.toHaveProperty("status");
      expect(attempt).not.toHaveProperty("response");
      expect(attempt).not.toHaveProperty("infrastructureFailure");
    }
    expect(result.rawEvidence.issues).toEqual([]);
  });

  it("requires an independent completed turn before an empty trace is clean no-tool", () => {
    const common = {
      runId: "run-no-tool-control",
      caseId: "case-no-tool-control",
      variantId: "V3",
      activeSessionId: "session-no-tool-control",
      entries: [],
      completions: [],
    };

    const completed = projectObservedBridgeTrace({
      ...common,
      turnCompletion: { outcome: "completed" },
    });
    expect(completed.observation).toEqual({
      evaluationSchemaVersion: 2,
      runId: "run-no-tool-control",
      caseId: "case-no-tool-control",
      variantId: "V3",
      rawTraceStatus: "complete",
      attempts: [],
    });

    const missing = projectObservedBridgeTrace({
      ...common,
      turnCompletion: { outcome: "missing" },
    });
    expect(missing.observation).toMatchObject({
      rawTraceStatus: "missing",
      attempts: [],
      infrastructureFailures: [{
        kind: "trace_missing",
        code: "turn_completion_missing",
      }],
    });

    const providerFailure = projectObservedBridgeTrace({
      ...common,
      turnCompletion: {
        outcome: "provider_5xx",
        status: 502,
        errorName: "TypeError: provider-turn-secret",
      },
    });
    expect(providerFailure.observation).toMatchObject({
      rawTraceStatus: "partial",
      infrastructureFailures: [{
        kind: "provider_5xx",
        code: "provider_http_502:Error",
      }],
    });
    expect(JSON.stringify(providerFailure)).not.toContain("provider-turn-secret");

    const timeout = projectObservedBridgeTrace({
      ...common,
      turnCompletion: {
        outcome: "timeout",
        stage: "provider_turn: timeout-stage-secret",
        budgetMs: 30_000,
      },
    });
    expect(timeout.observation).toMatchObject({
      rawTraceStatus: "partial",
      infrastructureFailures: [{
        kind: "timeout",
        code: "turn_timeout:unknown",
      }],
    });
    expect(JSON.stringify(timeout)).not.toContain("timeout-stage-secret");
  });

  it("returns detached frozen allowlisted evidence and never truncates later observed entries", () => {
    const firstBody = { query: "first" };
    const laterBody = { query: "later" };
    const firstResponse = { records: [{ id: "first-result" }] };
    const firstHeaders = {
      "x-conversation-id": "session-safe-evidence",
      "x-tdai-team-id": "team-original",
      authorization: "Bearer header-secret",
      "x-tdai-user-key": "user-key-secret",
    };
    const result = projectObservedBridgeTrace({
      runId: "run-safe-evidence",
      caseId: "case-safe-evidence",
      variantId: "V3",
      activeSessionId: "session-safe-evidence",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "entry-first",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: firstBody,
        requestBodyCapture: { outcome: "captured", rawBodySha256: "4".repeat(64) },
        correlationHeaders: firstHeaders,
      }, {
        correlationId: "entry-after-potential-terminal",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: laterBody,
        requestBodyCapture: { outcome: "captured", rawBodySha256: "5".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-safe-evidence" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "entry-first",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: firstResponse,
        durationMs: 1,
      }, {
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "entry-after-potential-terminal",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { records: [{ id: "later-result" }] },
        durationMs: 1,
      }],
    });

    firstBody.query = "mutated";
    laterBody.query = "mutated";
    firstResponse.records[0].id = "mutated";
    firstHeaders["x-tdai-team-id"] = "team-mutated";

    expect(result.observation.attempts.map((attempt) => attempt.attemptId)).toEqual([
      "entry-first",
      "entry-after-potential-terminal",
    ]);
    expect(result.rawEvidence.entries[0]).toMatchObject({
      requestBody: { query: "first" },
      correlationHeaders: {
        "x-conversation-id": "session-safe-evidence",
        "x-tdai-team-id": "team-original",
      },
    });
    expect(result.rawEvidence.completions[0]).toMatchObject({
      responseBody: { records: [{ id: "first-result" }] },
    });
    expect(JSON.stringify(result)).not.toContain("header-secret");
    expect(JSON.stringify(result)).not.toContain("user-key-secret");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observation.attempts[0].arguments)).toBe(true);
    expect(Object.isFrozen(result.rawEvidence.entries[0].correlationHeaders)).toBe(true);
    expect(Object.isFrozen(result.rawEvidence.completions[0].responseBody)).toBe(true);
  });

  it("keeps the begin fact but rejects a completion whose observed identity changed", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-completion-mismatch",
      caseId: "case-completion-mismatch",
      variantId: "V1",
      activeSessionId: "session-completion-mismatch",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "identity-mismatch",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "identity" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "6".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-completion-mismatch" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "identity-mismatch",
        family: "skill",
        endpoint: "/skill-bridge/v3/skill/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { results: [] },
        durationMs: 1,
      }],
    });

    expect(result.observation).toMatchObject({
      rawTraceStatus: "partial",
      attempts: [{
        attemptId: "identity-mismatch",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        infrastructureFailure: { kind: "other", code: "completion_identity_mismatch" },
      }],
    });
    expect(result.observation.attempts[0]).not.toHaveProperty("status");
  });

  it("keeps a missing turn partial when bridge entry facts are present", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-missing-turn-with-entry",
      caseId: "case-missing-turn-with-entry",
      variantId: "V2",
      activeSessionId: "session-missing-turn-with-entry",
      turnCompletion: { outcome: "missing" },
      entries: [{
        correlationId: "entry-before-missing-turn",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        requestBody: { query: "observed before missing turn" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "7".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-missing-turn-with-entry" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "entry-before-missing-turn",
        family: "memory",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        outcome: "response",
        status: 200,
        responseBody: { records: [] },
        durationMs: 1,
      }],
    });

    expect(result.observation).toMatchObject({
      rawTraceStatus: "partial",
      attempts: [{ attemptId: "entry-before-missing-turn", status: 200 }],
      infrastructureFailures: [{ code: "turn_completion_missing" }],
    });
  });

  it("retains an unknown Knowledge contract without canonicalizing its actual endpoint", () => {
    const result = projectObservedBridgeTrace({
      runId: "run-unknown-contract",
      caseId: "case-unknown-contract",
      variantId: "V3",
      activeSessionId: "session-unknown-contract",
      turnCompletion: { outcome: "completed" },
      entries: [{
        correlationId: "knowledge-unknown-prefix",
        family: "knowledge",
        endpoint: "/v4/tools/list",
        method: "POST",
        requestBody: { knowledge_id: "wiki-runtime-1" },
        requestBodyCapture: { outcome: "captured", rawBodySha256: "8".repeat(64) },
        correlationHeaders: { "x-conversation-id": "session-unknown-contract" },
      }],
      completions: [{
        schemaVersion: "task1.tool-execution-completion.v1",
        correlationId: "knowledge-unknown-prefix",
        family: "knowledge",
        endpoint: "/v4/tools/list",
        method: "POST",
        outcome: "response",
        status: 404,
        responseBody: { error: "not found" },
        durationMs: 1,
      }],
    });

    expect(result.observation.attempts[0]).toMatchObject({
      attemptId: "knowledge-unknown-prefix",
      endpoint: "/v4/tools/list",
      status: 404,
    });
    expect(result.observation.attempts[0]).not.toHaveProperty("tool");
  });
});
