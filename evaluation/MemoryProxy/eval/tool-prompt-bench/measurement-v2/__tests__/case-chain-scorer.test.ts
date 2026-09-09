import { describe, expect, it } from "vitest";
import { scoreCaseChain } from "../scorer.js";
import {
  KNOWLEDGE_BRANCH_CONTRACTS,
  KNOWLEDGE_BRANCH_GOLD,
  KNOWLEDGE_NONE_OPERATION_CONTRACTS,
  KNOWLEDGE_NONE_OPERATION_GOLD,
  KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE,
  MEMORY_MULTI_STEP_CONTRACTS,
  MEMORY_MULTI_STEP_GOLD,
  MEMORY_MULTI_STEP_SUCCESS_TRACE,
  MEMORY_PREREQUISITE_CHAIN_GOLD,
  MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE,
  MEMORY_SEARCH_GOLD,
  MEMORY_SEARCH_SUCCESS_TRACE,
  NO_TOOL_GOLD,
  SKILL_MULTI_STEP_CONTRACTS,
  SKILL_MULTI_STEP_GOLD,
  SKILL_MULTI_STEP_SUCCESS_TRACE,
  SYNTHETIC_RUNTIME_CONTRACTS,
} from "../synthetic-fixtures.js";

describe("Measurement v2 public case-chain scorer", () => {
  it.each([
    {
      label: "mismatched observation and Gold case IDs",
      input: {
        observation: { ...MEMORY_SEARCH_SUCCESS_TRACE, caseId: "different-case" },
        gold: MEMORY_SEARCH_GOLD,
        runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
      },
      message: /caseId/i,
    },
    {
      label: "a non-final terminal step",
      input: {
        observation: MEMORY_MULTI_STEP_SUCCESS_TRACE,
        gold: {
          ...MEMORY_MULTI_STEP_GOLD,
          allowedSequences: [{
            ...MEMORY_MULTI_STEP_GOLD.allowedSequences[0],
            steps: [
              { ...MEMORY_MULTI_STEP_GOLD.allowedSequences[0].steps[0], terminal: true },
              { ...MEMORY_MULTI_STEP_GOLD.allowedSequences[0].steps[1], terminal: false },
            ],
          }],
        },
        runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
      },
      message: /terminal/i,
    },
    {
      label: "duplicate runtime contract IDs",
      input: {
        observation: MEMORY_SEARCH_SUCCESS_TRACE,
        gold: MEMORY_SEARCH_GOLD,
        runtimeContracts: [
          SYNTHETIC_RUNTIME_CONTRACTS[0],
          SYNTHETIC_RUNTIME_CONTRACTS[0],
        ],
      },
      message: /contractId/i,
    },
    {
      label: "a forbidden terminal operation that disagrees with its runtime contract",
      input: {
        observation: MEMORY_MULTI_STEP_SUCCESS_TRACE,
        gold: {
          ...MEMORY_MULTI_STEP_GOLD,
          forbiddenBeforeTerminal: [{
            reason: "wrong_terminal",
            family: "memory",
            tool: "tdai_memory_search",
            endpoint: "/memory-bridge/v3/atomic/search",
            method: "POST",
            operation: { kind: "exact", value: "invented_operation" },
            runtimeContractId: "memory-search-contract",
          }],
        },
        runtimeContracts: [
          ...MEMORY_MULTI_STEP_CONTRACTS,
          ...SYNTHETIC_RUNTIME_CONTRACTS,
        ],
      },
      message: /operation/i,
    },
  ] as const)("rejects $label at the public seam", ({ input, message }) => {
    expect(() => scoreCaseChain(input)).toThrow(message);
  });

  it("reports an untriggered positive case without inventing a matched chain", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "memory-no-call",
        runId: "run-memory-no-call",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [],
      },
      gold: {
        evaluationSchemaVersion: 2,
        caseId: "memory-no-call",
        expectation: "tool",
        attemptBudget: 1,
        allowedSequences: [{
          sequenceId: "memory-search",
          steps: [{
            stepId: "search",
            family: "memory",
            tool: "tdai_memory_search",
            endpoint: "/memory-bridge/v3/atomic/search",
            method: "POST",
            operation: { kind: "none" },
            arguments: { required: ["query"] },
            bindings: [],
            runtimeContractId: "memory-search-contract",
            terminal: true,
          }],
        }],
      },
      runtimeContracts: [{
        contractId: "memory-search-contract",
        family: "memory",
        tool: "tdai_memory_search",
        endpoint: "/memory-bridge/v3/atomic/search",
        method: "POST",
        operation: { kind: "none" },
        acceptedStatusCodes: [200],
      }],
    });

    expect(score).toMatchObject({
      evaluationSchemaVersion: 2,
      traceCompleteness: true,
      triggeredAttempt: false,
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      strictChainExact: false,
      matchedSequenceId: null,
      observedAttemptCount: 0,
      evaluationPrefixAttemptCount: 0,
      behaviorValidTerminalAttemptIndex: null,
      terminalAttemptIndex: null,
      toolSplContribution: 0,
      shortestExact: false,
      failureLayer: "trigger",
    });
    expect(score).not.toHaveProperty("formalMetricEligible");
  });

  it("accepts a single-step chain only through typed Gold and its frozen runtime contract", () => {
    const score = scoreCaseChain({
      observation: MEMORY_SEARCH_SUCCESS_TRACE,
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      evaluationSchemaVersion: 2,
      triggeredAttempt: true,
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: true,
      positiveOvercall: false,
      matchedSequenceId: "memory-search",
      shortestAllowedLength: 1,
      matchedSequenceLength: 1,
      observedAttemptCount: 1,
      evaluationPrefixAttemptCount: 1,
      behaviorValidTerminalAttemptIndex: 0,
      terminalAttemptIndex: 0,
      toolSplContribution: 1,
      shortestExact: true,
      failureLayer: null,
    });
  });

  it("uses executor-bound ordinals for attempt indexes when an unbound fact comes first", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-memory-unbound-before-bound",
        attempts: [{
          attemptId: "intent-before-bound-attempt",
          executorBound: false,
          recognizableTdaiIntent: true,
          malformedReason: "unbound trace fact",
        }, MEMORY_SEARCH_SUCCESS_TRACE.attempts[0]],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: true,
      observedAttemptCount: 1,
      evaluationPrefixAttemptCount: 1,
      terminalAttemptIndex: 0,
      completeChainSuccess: true,
      strictChainExact: true,
    });
  });

  it("classifies an executor-bound call from the wrong family at the selection layer", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-wrong-family",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          family: "skill",
          tool: "skill_search",
          endpoint: "/skill-bridge/v3/skill/search",
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: true,
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      failureLayer: "wrong_family",
    });
  });

  it("distinguishes a wrong endpoint from a gold-relevant argument failure", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-wrong-endpoint",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          endpoint: "/memory-bridge/v3/conversation/search",
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: true,
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      positiveOvercall: true,
      failureLayer: "wrong_endpoint",
    });
  });

  it("distinguishes Knowledge operations that share the same endpoint", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-wrong-operation",
        runId: "run-knowledge-wrong-operation",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-call",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          arguments: {
            knowledge_id: "kg-repository",
            tool_name: "search_docs",
            params: { symbol: "SessionStore" },
          },
          status: 200,
          response: { results: [] },
        }],
      },
      gold: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-wrong-operation",
        expectation: "tool",
        attemptBudget: 1,
        allowedSequences: [{
          sequenceId: "knowledge-lookup-symbols",
          steps: [{
            stepId: "lookup",
            family: "knowledge",
            tool: "knowledge_tools_call",
            endpoint: "/tools/call",
            method: "POST",
            operation: { kind: "exact", value: "lookup_symbols" },
            arguments: { required: ["knowledge_id", "tool_name", "params"] },
            bindings: [],
            runtimeContractId: "knowledge-lookup-symbols-contract",
            terminal: true,
          }],
        }],
      },
      runtimeContracts: [{
        contractId: "knowledge-lookup-symbols-contract",
        family: "knowledge",
        tool: "knowledge_tools_call",
        endpoint: "/tools/call",
        method: "POST",
        operation: { kind: "argument", path: "tool_name", value: "lookup_symbols" },
        acceptedStatusCodes: [200],
      }, {
        contractId: "knowledge-search-docs-contract",
        family: "knowledge",
        tool: "knowledge_tools_call",
        endpoint: "/tools/call",
        method: "POST",
        operation: { kind: "argument", path: "tool_name", value: "search_docs" },
        acceptedStatusCodes: [200],
      }],
    });

    expect(score).toMatchObject({
      triggeredAttempt: true,
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      failureLayer: "wrong_operation",
    });
  });

  it("does not accept an explicit operation that conflicts with the contract argument selector", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-operation-conflict",
        runId: "run-knowledge-operation-conflict",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-operation-conflict",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          operation: "lookup_symbols",
          arguments: { tool_name: "search_docs" },
          status: 200,
          response: { symbols: [] },
        }],
      },
      gold: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-operation-conflict",
        expectation: "tool",
        attemptBudget: 1,
        allowedSequences: [{
          sequenceId: "knowledge-lookup-symbols",
          steps: [{
            stepId: "lookup",
            family: "knowledge",
            tool: "knowledge_tools_call",
            endpoint: "/tools/call",
            method: "POST",
            operation: { kind: "exact", value: "lookup_symbols" },
            arguments: { required: ["tool_name"] },
            bindings: [],
            runtimeContractId: "knowledge-lookup-symbols-contract",
            terminal: true,
          }],
        }],
      },
      runtimeContracts: KNOWLEDGE_BRANCH_CONTRACTS,
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      matchedSequenceId: null,
      failureLayer: "wrong_operation",
    });
  });

  it("does not fold an explicit-operation selector conflict into a none operation", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-explicit-operation-conflict-none",
        runId: "run-knowledge-explicit-operation-conflict-none",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-explicit-operation-conflict-none",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          operation: "invented_operation",
          arguments: { tool_name: "lookup_symbols" },
          status: 200,
          response: { symbols: [] },
        }],
      },
      gold: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-explicit-operation-conflict-none",
        expectation: "tool",
        attemptBudget: 1,
        allowedSequences: [{
          sequenceId: "knowledge-none-operation",
          steps: [{
            stepId: "call",
            family: "knowledge",
            tool: "knowledge_tools_call",
            endpoint: "/tools/call",
            method: "POST",
            operation: { kind: "none" },
            arguments: { required: ["tool_name"] },
            bindings: [],
            runtimeContractId: "knowledge-none-operation-contract",
            terminal: true,
          }],
        }],
      },
      runtimeContracts: [{
        contractId: "knowledge-none-operation-contract",
        family: "knowledge",
        tool: "knowledge_tools_call",
        endpoint: "/tools/call",
        method: "POST",
        operation: { kind: "none" },
        acceptedStatusCodes: [200],
      }, KNOWLEDGE_BRANCH_CONTRACTS[2]],
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      terminalAttemptIndex: null,
      failureLayer: "wrong_operation",
    });
  });

  it.each([
    ["number", 42],
    ["null", null],
    ["object", { nested: "lookup_symbols" }],
    ["array", ["lookup_symbols"]],
    ["boolean", true],
  ] as const)("treats a present non-string %s operation selector as invalid", (_label, selector) => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: KNOWLEDGE_NONE_OPERATION_GOLD.caseId,
        runId: `run-knowledge-non-string-selector-${_label}`,
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: `attempt-knowledge-non-string-selector-${_label}`,
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          arguments: { tool_name: selector },
          status: 200,
          response: { ok: true },
        }],
      },
      gold: KNOWLEDGE_NONE_OPERATION_GOLD,
      runtimeContracts: KNOWLEDGE_NONE_OPERATION_CONTRACTS,
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: false,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      strictChainExact: false,
      terminalAttemptIndex: null,
      toolSplContribution: 0,
      failureLayer: "wrong_operation",
    });
  });

  it("keeps a genuinely missing selector on the mixed identity as none", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: KNOWLEDGE_NONE_OPERATION_GOLD.caseId,
        runId: "run-knowledge-missing-selector",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-missing-selector",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          arguments: {},
          status: 200,
          response: { ok: true },
        }],
      },
      gold: KNOWLEDGE_NONE_OPERATION_GOLD,
      runtimeContracts: KNOWLEDGE_NONE_OPERATION_CONTRACTS,
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: true,
    });
  });

  it("does not interpret an undeclared selector-like field under a pure none contract", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: KNOWLEDGE_NONE_OPERATION_GOLD.caseId,
        runId: "run-knowledge-pure-none-selector-like-field",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-pure-none-selector-like-field",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          arguments: { tool_name: 42 },
          status: 200,
          response: { ok: true },
        }],
      },
      gold: KNOWLEDGE_NONE_OPERATION_GOLD,
      runtimeContracts: [KNOWLEDGE_NONE_OPERATION_CONTRACTS[0]],
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: true,
    });
  });

  it("checks every matching contract operation path instead of trusting the first string path", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-operation-multiple-paths",
        runId: "run-knowledge-operation-multiple-paths",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "attempt-knowledge-operation-multiple-paths",
          executorBound: true,
          family: "knowledge",
          tool: "knowledge_tools_call",
          endpoint: "/tools/call",
          method: "POST",
          arguments: {
            metadata: { operation: "not-search-docs" },
            tool_name: "lookup_symbols",
          },
          status: 200,
          response: { symbols: [] },
        }],
      },
      gold: {
        evaluationSchemaVersion: 2,
        caseId: "knowledge-operation-multiple-paths",
        expectation: "tool",
        attemptBudget: 1,
        allowedSequences: [{
          sequenceId: "knowledge-lookup-symbols",
          steps: [{
            stepId: "lookup",
            family: "knowledge",
            tool: "knowledge_tools_call",
            endpoint: "/tools/call",
            method: "POST",
            operation: { kind: "exact", value: "lookup_symbols" },
            arguments: { required: ["tool_name"] },
            bindings: [],
            runtimeContractId: "knowledge-lookup-symbols-contract",
            terminal: true,
          }],
        }],
      },
      runtimeContracts: [{
        contractId: "knowledge-metadata-search-contract",
        family: "knowledge",
        tool: "knowledge_tools_call",
        endpoint: "/tools/call",
        method: "POST",
        operation: { kind: "argument", path: "metadata.operation", value: "search_docs" },
        acceptedStatusCodes: [200],
      }, KNOWLEDGE_BRANCH_CONTRACTS[2]],
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: true,
      matchedSequenceId: "knowledge-lookup-symbols",
    });
  });

  it("keeps correct selection separate from gold-relevant argument validity", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-wrong-arguments",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          arguments: {},
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: true,
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      runtimeAcceptedChain: null,
      failureLayer: "arguments",
    });
  });

  it("rejects a forbidden Gold-relevant argument even when all required fields are present", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-forbidden-argument",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          arguments: {
            query: "Which database did we choose?",
            user_id: "model-supplied-identity",
          },
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      failureLayer: "arguments",
    });
  });

  it("keeps a correct tool-decision chain successful when the runtime returns a contract 4xx", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-contract-4xx",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          status: 400,
          response: { error: "invalid request" },
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: true,
      terminalAttemptIndex: 0,
      completeChainSuccess: true,
      runtimeAcceptedChain: false,
      rawInfrastructureFailure: [],
      failureLayer: null,
    });
  });

  it("reports exact-contract runtime acceptance independently from behavior success", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-wrong-contract-acceptance",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          status: 202,
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: [
        ...SYNTHETIC_RUNTIME_CONTRACTS,
        {
          ...SYNTHETIC_RUNTIME_CONTRACTS[0],
          contractId: "shadow-memory-search-contract",
          acceptedStatusCodes: [202],
        },
      ],
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      runtimeAcceptedChain: false,
      failureLayer: null,
    });
  });

  it.each([
    {
      label: "provider 5xx",
      status: 503,
      failure: { kind: "provider_5xx", message: "upstream unavailable" },
    },
    {
      label: "timeout",
      status: undefined,
      failure: { kind: "timeout", message: "bridge deadline exceeded" },
    },
  ] as const)("preserves $label as raw infrastructure evidence", ({ failure, status }) => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: `run-${failure.kind}`,
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          status,
          infrastructureFailure: failure,
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      runtimeAcceptedChain: false,
      rawInfrastructureFailure: [failure],
      failureLayer: null,
    });
    expect(score).not.toHaveProperty("formalMetricEligible");
  });

  it("requires a Memory follow-up argument to bind to the named prior-step output", () => {
    const accepted = scoreCaseChain({
      observation: MEMORY_MULTI_STEP_SUCCESS_TRACE,
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });
    const rejected = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-binding-rejected",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            arguments: { path: "deployment/invented.md" },
          },
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(accepted).toMatchObject({
      completeChainSuccess: true,
      strictChainExact: true,
      matchedSequenceId: "scenario-list-then-read",
      behaviorValidTerminalAttemptIndex: 1,
      terminalAttemptIndex: 1,
    });
    expect(rejected).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      behaviorValidTerminalAttemptIndex: null,
      terminalAttemptIndex: 1,
      failureLayer: "binding",
    });
  });

  it.each([
    {
      label: "wrong tool",
      replacement: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        tool: "tdai_memory_search",
      },
      expectedLayer: "wrong_tool",
    },
    {
      label: "wrong endpoint",
      replacement: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        endpoint: "/memory-bridge/v3/scenario/wrong-read",
      },
      expectedLayer: "wrong_endpoint",
    },
    {
      label: "wrong operation",
      replacement: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        operation: "unexpected_read_operation",
      },
      expectedLayer: "wrong_operation",
    },
  ] as const)("classifies a multi-step $label at the first divergent follow-up", ({
    expectedLayer,
    replacement,
  }) => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: `run-memory-follow-up-${expectedLayer}`,
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          replacement,
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      failureLayer: expectedLayer,
    });
  });

  it("does not treat two missing binding paths as a valid prior-output binding", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-missing-binding-values",
        attempts: [{
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          response: {},
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
          arguments: {},
        }],
      },
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        allowedSequences: [{
          ...MEMORY_MULTI_STEP_GOLD.allowedSequences[0],
          steps: [
            MEMORY_MULTI_STEP_GOLD.allowedSequences[0].steps[0],
            {
              ...MEMORY_MULTI_STEP_GOLD.allowedSequences[0].steps[1],
              arguments: undefined,
            },
          ],
        }],
      },
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      failureLayer: "binding",
    });
  });

  it("requires a Skill chain to satisfy both prior-output binding and exact arguments", () => {
    const accepted = scoreCaseChain({
      observation: SKILL_MULTI_STEP_SUCCESS_TRACE,
      gold: SKILL_MULTI_STEP_GOLD,
      runtimeContracts: SKILL_MULTI_STEP_CONTRACTS,
    });
    const rejected = scoreCaseChain({
      observation: {
        ...SKILL_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-skill-exact-argument-rejected",
        attempts: [
          SKILL_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...SKILL_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            arguments: { skill_name: "rl-post-training", include_content: false },
          },
        ],
      },
      gold: SKILL_MULTI_STEP_GOLD,
      runtimeContracts: SKILL_MULTI_STEP_CONTRACTS,
    });

    expect(accepted).toMatchObject({
      completeChainSuccess: true,
      matchedSequenceId: "skill-search-then-view",
      matchedSequenceLength: 2,
    });
    expect(rejected).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      failureLayer: "arguments",
    });
  });

  it("keeps ECR successful while Strict and ToolSPL penalize a pre-terminal duplicate", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-pre-terminal-duplicate",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
            attemptId: "attempt-scenario-list-duplicate",
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: false,
      positiveOvercall: true,
      evaluationPrefixAttemptCount: 3,
      terminalAttemptIndex: 2,
      toolSplContribution: 2 / 3,
      shortestExact: false,
      failureLayer: null,
    });
  });

  it("does not let a corrected argument retry after the first behavior-valid terminal repair the chain", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-bad-prerequisite-args-before-terminal",
        attempts: [{
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          attemptId: "attempt-scenario-list-bad-args",
          arguments: {},
        }, MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1], {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          attemptId: "attempt-scenario-list-later-valid",
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
          attemptId: "attempt-scene-read-later-valid",
        }],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 4,
      evaluationPrefixAttemptCount: 2,
      terminalAttemptIndex: 1,
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      strictChainExact: false,
      positiveOvercall: false,
      matchedSequenceId: null,
      toolSplContribution: 0,
      shortestExact: false,
      failureLayer: "arguments",
    });
  });

  it("lets corrected prerequisite arguments repair the chain before the behavior-valid terminal", () => {
    const [prerequisite, terminal] = MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts;
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-corrected-prerequisite-args-before-terminal",
        attempts: [{
          ...prerequisite,
          attemptId: "attempt-scenario-list-earliest-bad-args",
          arguments: {},
        }, {
          ...prerequisite,
          attemptId: "attempt-scenario-list-corrected-args",
        }, terminal],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 3,
      terminalAttemptIndex: 2,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: false,
      positiveOvercall: true,
      matchedSequenceId: "scenario-list-then-read",
      toolSplContribution: 2 / 3,
      shortestExact: false,
      failureLayer: null,
    });
  });

  it("stops behavior scoring at the first correct terminal call regardless of its HTTP status", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-rejected-terminal-before-accepted-horizon",
        attempts: [{
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          attemptId: "attempt-scenario-list-bad-args-before-rejected-terminal",
          arguments: {},
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
          attemptId: "attempt-scene-read-contract-rejected",
          status: 400,
          response: { error: "contract rejection" },
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
          attemptId: "attempt-scene-read-accepted-horizon",
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          attemptId: "attempt-scenario-list-post-horizon-valid",
        }, {
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
          attemptId: "attempt-scene-read-post-horizon-valid",
        }],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 5,
      evaluationPrefixAttemptCount: 2,
      terminalAttemptIndex: 1,
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      strictChainExact: false,
      runtimeAcceptedChain: null,
      positiveOvercall: false,
      toolSplContribution: 0,
      failureLayer: "arguments",
    });
  });

  it("does not let a corrected prior-output binding retry after the first behavior-valid terminal repair the chain", () => {
    const [list, readBridge, readPrerequisite, terminal] = (
      MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE.attempts
    );
    const laterValidChain = MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE.attempts.map((attempt) => ({
      ...attempt,
      attemptId: `${attempt.attemptId}-later-valid`,
    }));
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE,
        runId: "run-memory-bad-prerequisite-binding-before-terminal",
        attempts: [list, {
          ...readBridge,
          attemptId: "attempt-prerequisite-read-bridge-bad-binding",
          arguments: { path: "deployment/invented.md" },
        }, {
          ...readPrerequisite,
          attemptId: "attempt-prerequisite-read-validate-bad-args",
          arguments: { path: "deployment/details.md" },
        }, terminal, ...laterValidChain],
      },
      gold: MEMORY_PREREQUISITE_CHAIN_GOLD,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        ...SYNTHETIC_RUNTIME_CONTRACTS,
      ],
    });

    expect(score).toMatchObject({
      observedAttemptCount: 8,
      evaluationPrefixAttemptCount: 4,
      terminalAttemptIndex: 3,
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      strictChainExact: false,
      positiveOvercall: false,
      matchedSequenceId: null,
      toolSplContribution: 0,
      shortestExact: false,
      failureLayer: "binding",
    });
  });

  it("lets a corrected prior-output binding repair the chain before the behavior-valid terminal", () => {
    const [list, readBridge, readPrerequisite, terminal] = (
      MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE.attempts
    );
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_PREREQUISITE_CHAIN_SUCCESS_TRACE,
        runId: "run-memory-corrected-prerequisite-binding-before-terminal",
        attempts: [list, {
          ...readBridge,
          attemptId: "attempt-prerequisite-read-bridge-earliest-bad-binding",
          arguments: { path: "deployment/invented.md" },
        }, {
          ...readBridge,
          attemptId: "attempt-prerequisite-read-bridge-corrected-binding",
        }, readPrerequisite, terminal],
      },
      gold: MEMORY_PREREQUISITE_CHAIN_GOLD,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        ...SYNTHETIC_RUNTIME_CONTRACTS,
      ],
    });

    expect(score).toMatchObject({
      observedAttemptCount: 5,
      evaluationPrefixAttemptCount: 5,
      terminalAttemptIndex: 4,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: false,
      positiveOvercall: true,
      matchedSequenceId: "scenario-list-read-validate-read",
      toolSplContribution: 4 / 5,
      shortestExact: false,
      failureLayer: null,
    });
  });

  it("lets a Gold-invalid terminal be corrected before the first behavior-valid terminal", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        runId: "run-memory-invalid-terminal-then-repair",
        attempts: [{
          ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
          attemptId: "attempt-memory-search-missing-args",
          arguments: {},
        }, MEMORY_SEARCH_SUCCESS_TRACE.attempts[0]],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 2,
      evaluationPrefixAttemptCount: 2,
      behaviorValidTerminalAttemptIndex: 1,
      terminalAttemptIndex: 1,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: false,
      positiveOvercall: true,
      toolSplContribution: 1 / 2,
      failureLayer: null,
    });
  });

  it("lets a wrong binding be corrected when the prerequisite selection path already exists", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-wrong-binding-then-repair",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            attemptId: "attempt-scene-read-wrong-binding",
            arguments: { path: "deployment/invented.md" },
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 3,
      behaviorValidTerminalAttemptIndex: 2,
      terminalAttemptIndex: 2,
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      strictChainExact: false,
      positiveOvercall: true,
      toolSplContribution: 2 / 3,
      failureLayer: null,
    });
  });

  it("uses the earliest complete terminal even when it binds to a later prerequisite attempt", () => {
    const firstListAttempt = MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0];
    const secondListAttempt = {
      ...firstListAttempt,
      attemptId: "attempt-scenario-list-second-result",
      response: { paths: ["deployment/second.md"] },
    } as const;
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-earliest-bound-terminal",
        attempts: [
          firstListAttempt,
          secondListAttempt,
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            attemptId: "attempt-scene-read-second-result",
            arguments: { path: "deployment/second.md" },
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      completeChainSuccess: true,
      matchedSequenceId: "scenario-list-then-read",
      evaluationPrefixAttemptCount: 3,
      terminalAttemptIndex: 2,
      strictChainExact: false,
      positiveOvercall: true,
      toolSplContribution: 2 / 3,
    });
  });

  it("does not let a later correct terminal wash out a forbidden wrong-family attempt", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-wrong-family-barrier",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            attemptId: "attempt-forbidden-skill-search",
            executorBound: true,
            family: "skill",
            tool: "skill_search",
            endpoint: "/skill-bridge/v3/skill/search",
            method: "POST",
            arguments: { query: "rollback" },
            status: 200,
            response: { results: [] },
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        SKILL_MULTI_STEP_CONTRACTS[0],
      ],
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      strictChainExact: false,
      positiveOvercall: true,
      evaluationPrefixAttemptCount: 3,
      terminalAttemptIndex: 2,
      behaviorValidTerminalAttemptIndex: 2,
      failureLayer: "wrong_family",
    });
  });

  it("ignores a forbidden attempt after the behavior-valid terminal horizon", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-selection-terminal-before-later-barrier",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            status: 400,
            response: { error: "contract rejection" },
          },
          {
            attemptId: "attempt-forbidden-after-selection-terminal",
            executorBound: true,
            family: "skill",
            tool: "skill_search",
            endpoint: "/skill-bridge/v3/skill/search",
            method: "POST",
            arguments: { query: "too late to change TSR" },
            status: 200,
            response: { results: [] },
          },
        ],
      },
      gold: { ...MEMORY_MULTI_STEP_GOLD, attemptBudget: 3 },
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        SKILL_MULTI_STEP_CONTRACTS[0],
      ],
    });

    expect(score).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: true,
      runtimeAcceptedChain: false,
      strictChainExact: true,
      positiveOvercall: false,
      evaluationPrefixAttemptCount: 2,
      failureLayer: null,
    });
  });

  it("does not let a later correct terminal wash out a typed forbidden wrong terminal", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-memory-wrong-terminal-barrier",
        attempts: [
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          {
            ...MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
            attemptId: "attempt-forbidden-memory-terminal",
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        forbiddenBeforeTerminal: [{
          reason: "wrong_terminal",
          family: "memory",
          tool: "tdai_memory_search",
          endpoint: "/memory-bridge/v3/atomic/search",
          method: "POST",
          operation: { kind: "none" },
          runtimeContractId: "memory-search-contract",
        }],
      },
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        ...SYNTHETIC_RUNTIME_CONTRACTS,
      ],
    });

    expect(score).toMatchObject({
      firstActionSelectionCorrect: true,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      positiveOvercall: true,
      evaluationPrefixAttemptCount: 3,
      behaviorValidTerminalAttemptIndex: 2,
      terminalAttemptIndex: 2,
      failureLayer: "wrong_terminal",
    });
  });

  it("treats a genuinely premature behavior-valid terminal as a barrier so later repair cannot wash it out", () => {
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-premature-terminal",
        attempts: [
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            attemptId: "attempt-premature-scene-read",
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 3,
      behaviorValidTerminalAttemptIndex: 2,
      terminalAttemptIndex: 0,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      positiveOvercall: true,
      failureLayer: "wrong_terminal",
    });
  });

  it("freezes a genuinely premature behavior-valid unbound terminal as the evaluation horizon", () => {
    const sequence = MEMORY_MULTI_STEP_GOLD.allowedSequences[0];
    const terminal = sequence.steps[1];
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-premature-terminal-without-binding",
        attempts: [
          {
            ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
            attemptId: "attempt-premature-unbound-scene-read",
          },
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
          MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
        ],
      },
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        allowedSequences: [{
          ...sequence,
          steps: [sequence.steps[0], { ...terminal, bindings: [] }],
        }],
      },
      runtimeContracts: MEMORY_MULTI_STEP_CONTRACTS,
    });

    expect(score).toMatchObject({
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 1,
      behaviorValidTerminalAttemptIndex: 0,
      terminalAttemptIndex: 0,
      terminalSelectionCorrect: false,
      completeChainSuccess: false,
      positiveOvercall: true,
      failureLayer: "wrong_terminal",
    });
  });

  it("matches the second Knowledge sequence with its own operation, args, and binding predicates", () => {
    const accepted = scoreCaseChain({
      observation: KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE,
      gold: KNOWLEDGE_BRANCH_GOLD,
      runtimeContracts: KNOWLEDGE_BRANCH_CONTRACTS,
    });
    const rejected = scoreCaseChain({
      observation: {
        ...KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE,
        runId: "run-knowledge-second-branch-wrong-query",
        attempts: [
          KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE.attempts[0],
          {
            ...KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE.attempts[1],
            arguments: {
              ...KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE.attempts[1].arguments,
              params: { query: "unrelated symbol" },
            },
          },
        ],
      },
      gold: KNOWLEDGE_BRANCH_GOLD,
      runtimeContracts: KNOWLEDGE_BRANCH_CONTRACTS,
    });

    expect(accepted).toMatchObject({
      completeChainSuccess: true,
      strictChainExact: true,
      matchedSequenceId: "knowledge-lookup-symbols",
      matchedSequenceLength: 2,
    });
    expect(rejected).toMatchObject({
      terminalSelectionCorrect: true,
      completeChainSuccess: false,
      matchedSequenceId: null,
      failureLayer: "arguments",
    });
  });

  it("prefers an exact legal branch over a shorter overlapping subsequence independent of Gold order", () => {
    const shortSequence = MEMORY_MULTI_STEP_GOLD.allowedSequences[0];
    const longSequence = {
      sequenceId: "scenario-list-search-then-read",
      steps: [
        shortSequence.steps[0],
        {
          ...MEMORY_SEARCH_GOLD.allowedSequences[0].steps[0],
          stepId: "lookup",
          terminal: false,
        },
        shortSequence.steps[1],
      ],
    } as const;
    const observation = {
      ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
      runId: "run-overlapping-exact-branch",
      attempts: [
        MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
        MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
        MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
      ],
    } as const;
    const input = {
      observation,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        ...SYNTHETIC_RUNTIME_CONTRACTS,
      ],
    } as const;
    const score = scoreCaseChain({
      ...input,
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        attemptBudget: 3,
        allowedSequences: [shortSequence, longSequence],
      },
    });
    const reordered = scoreCaseChain({
      ...input,
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        attemptBudget: 3,
        allowedSequences: [longSequence, shortSequence],
      },
    });

    expect(score).toMatchObject({
      completeChainSuccess: true,
      matchedSequenceId: "scenario-list-search-then-read",
      matchedSequenceLength: 3,
      shortestAllowedLength: 2,
      evaluationPrefixAttemptCount: 3,
      strictChainExact: true,
      positiveOvercall: false,
      toolSplContribution: 2 / 3,
      shortestExact: false,
    });
    expect(reordered).toEqual(score);
  });

  it("stops at the earliest complete legal branch independent of Gold order", () => {
    const lateSequence = MEMORY_MULTI_STEP_GOLD.allowedSequences[0];
    const earlySequence = {
      sequenceId: "scenario-list-then-search",
      steps: [
        lateSequence.steps[0],
        {
          ...MEMORY_SEARCH_GOLD.allowedSequences[0].steps[0],
          stepId: "search-terminal",
        },
      ],
    } as const;
    const observation = {
      ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
      runId: "run-earliest-legal-branch",
      attempts: [
        MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[0],
        MEMORY_SEARCH_SUCCESS_TRACE.attempts[0],
        MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts[1],
      ],
    } as const;
    const input = {
      observation,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        ...SYNTHETIC_RUNTIME_CONTRACTS,
      ],
    } as const;
    const score = scoreCaseChain({
      ...input,
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        attemptBudget: 3,
        allowedSequences: [lateSequence, earlySequence],
      },
    });
    const reordered = scoreCaseChain({
      ...input,
      gold: {
        ...MEMORY_MULTI_STEP_GOLD,
        attemptBudget: 3,
        allowedSequences: [earlySequence, lateSequence],
      },
    });

    expect(score).toMatchObject({
      completeChainSuccess: true,
      matchedSequenceId: "scenario-list-then-search",
      matchedSequenceLength: 2,
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 2,
      terminalAttemptIndex: 1,
      strictChainExact: true,
      positiveOvercall: false,
      toolSplContribution: 1,
    });
    expect(reordered).toEqual(score);
  });

  it.each([
    {
      label: "clean completion",
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "no-tool-synthetic",
        runId: "run-no-tool-clean",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [],
      },
      expected: {
        triggeredAttempt: false,
        falseCallAttempt: false,
        falseCallAccepted: false,
        malformedFalseIntent: false,
        failureLayer: null,
      },
    },
    {
      label: "accepted false call",
      observation: {
        ...MEMORY_SEARCH_SUCCESS_TRACE,
        caseId: "no-tool-synthetic",
        runId: "run-no-tool-accepted",
      },
      expected: {
        triggeredAttempt: true,
        falseCallAttempt: true,
        falseCallAccepted: true,
        malformedFalseIntent: false,
        failureLayer: "false_call",
      },
    },
    {
      label: "unbound malformed intent",
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "no-tool-synthetic",
        runId: "run-no-tool-malformed",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "intent-malformed-curl",
          executorBound: false,
          recognizableTdaiIntent: true,
          malformedReason: "curl body is not valid JSON",
        }],
      },
      expected: {
        triggeredAttempt: false,
        falseCallAttempt: false,
        falseCallAccepted: false,
        malformedFalseIntent: true,
        failureLayer: "malformed_intent",
      },
    },
  ] as const)("separates no-tool $label", ({ expected, observation }) => {
    const score = scoreCaseChain({
      observation,
      gold: NO_TOOL_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      ...expected,
      firstActionSelectionCorrect: null,
      terminalSelectionCorrect: null,
      completeChainSuccess: null,
      strictChainExact: null,
      positiveOvercall: null,
      toolSplContribution: null,
      shortestExact: null,
    });
  });

  it("counts a recognizable unbound TDAI intent as malformed even without optional reason metadata", () => {
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: "no-tool-synthetic",
        runId: "run-no-tool-recognizable-without-reason",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "intent-recognizable-without-reason",
          executorBound: false,
          recognizableTdaiIntent: true,
        }],
      },
      gold: NO_TOOL_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: false,
      falseCallAttempt: false,
      malformedFalseIntent: true,
      failureLayer: "malformed_intent",
    });
  });

  it("classifies a complete zero-attempt trace with raw infrastructure evidence as infrastructure", () => {
    const failure = { kind: "timeout", message: "provider never returned a turn" } as const;
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-zero-attempt-infrastructure",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [],
        infrastructureFailures: [failure],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: false,
      rawInfrastructureFailure: [failure],
      failureLayer: "infrastructure",
    });
  });

  it("preserves attempt-level infrastructure evidence from an unbound trace fact", () => {
    const failure = { kind: "timeout", message: "dispatch binding timed out" } as const;
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-unbound-attempt-infrastructure",
        variantId: "synthetic",
        rawTraceStatus: "complete",
        attempts: [{
          attemptId: "intent-unbound-timeout",
          executorBound: false,
          recognizableTdaiIntent: true,
          infrastructureFailure: failure,
        }],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      triggeredAttempt: false,
      rawInfrastructureFailure: [failure],
      failureLayer: "infrastructure",
    });
  });

  it("preserves incomplete trace status as a raw fact without producing eligibility", () => {
    const traceFailure = { kind: "trace_missing", message: "turn completion event absent" } as const;
    const score = scoreCaseChain({
      observation: {
        evaluationSchemaVersion: 2,
        caseId: MEMORY_SEARCH_GOLD.caseId,
        runId: "run-partial-trace",
        variantId: "synthetic",
        rawTraceStatus: "partial",
        attempts: [],
        infrastructureFailures: [traceFailure],
      },
      gold: MEMORY_SEARCH_GOLD,
      runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS,
    });

    expect(score).toMatchObject({
      rawTraceStatus: "partial",
      traceCompleteness: false,
      rawInfrastructureFailure: [traceFailure],
      failureLayer: "trace",
    });
    expect(score).not.toHaveProperty("formalMetricEligible");
  });

  it("ignores post-terminal behavior metrics while preserving its raw infrastructure fact", () => {
    const postTerminalFailure = {
      kind: "provider_5xx",
      message: "post-terminal provider failure",
    } as const;
    const score = scoreCaseChain({
      observation: {
        ...MEMORY_MULTI_STEP_SUCCESS_TRACE,
        runId: "run-terminal-post-behavior",
        attempts: [
          ...MEMORY_MULTI_STEP_SUCCESS_TRACE.attempts,
          {
            attemptId: "attempt-post-terminal-skill-search",
            executorBound: true,
            family: "skill",
            tool: "skill_search",
            endpoint: "/skill-bridge/v3/skill/search",
            method: "POST",
            arguments: { query: "must be ignored" },
            status: 503,
            response: { error: "post-terminal failure" },
            infrastructureFailure: postTerminalFailure,
          },
        ],
      },
      gold: MEMORY_MULTI_STEP_GOLD,
      runtimeContracts: [
        ...MEMORY_MULTI_STEP_CONTRACTS,
        SKILL_MULTI_STEP_CONTRACTS[0],
      ],
    });

    expect(score).toMatchObject({
      observedAttemptCount: 3,
      evaluationPrefixAttemptCount: 2,
      terminalAttemptIndex: 1,
      completeChainSuccess: true,
      strictChainExact: true,
      positiveOvercall: false,
      rawInfrastructureFailure: [postTerminalFailure],
      failureLayer: null,
    });
  });

  it("scores the same trace, Gold, and contracts deterministically field by field", () => {
    const input = {
      observation: KNOWLEDGE_SECOND_BRANCH_SUCCESS_TRACE,
      gold: KNOWLEDGE_BRANCH_GOLD,
      runtimeContracts: KNOWLEDGE_BRANCH_CONTRACTS,
    } as const;

    const first = scoreCaseChain(input);
    const second = scoreCaseChain(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
