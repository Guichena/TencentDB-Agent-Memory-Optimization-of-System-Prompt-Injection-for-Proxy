import { describe, it, expect } from "vitest";
import { scoreCaseChain } from "../scorer.js";
import { MEMORY_SEARCH_GOLD, MEMORY_SEARCH_SUCCESS_TRACE, SYNTHETIC_RUNTIME_CONTRACTS } from "../synthetic-fixtures.js";

describe("Final5 whole episode", () => {
  it("counts a post-terminal call in Strict, Overcall and ToolSPL", () => {
    const original = MEMORY_SEARCH_SUCCESS_TRACE.attempts[0];
    const observation = { ...MEMORY_SEARCH_SUCCESS_TRACE, attempts: [original, { ...original, attemptId: "extra" }] };
    const score = scoreCaseChain({ observation, gold: MEMORY_SEARCH_GOLD, runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS, observationWindow: "full-episode" });
    expect(score.completeChainSuccess).toBe(true);
    expect(score.strictChainExact).toBe(false);
    expect(score.positiveOvercall).toBe(true);
    expect(score.evaluationPrefixAttemptCount).toBe(2);
    expect(score.toolSplContribution).toBe(0.5);
  });
  it("preserves the old frozen window only when explicitly/default selected", () => {
    const original = MEMORY_SEARCH_SUCCESS_TRACE.attempts[0];
    const score = scoreCaseChain({ observation: { ...MEMORY_SEARCH_SUCCESS_TRACE, attempts: [original, { ...original, attemptId: "extra" }] }, gold: MEMORY_SEARCH_GOLD, runtimeContracts: SYNTHETIC_RUNTIME_CONTRACTS });
    expect(score.evaluationPrefixAttemptCount).toBe(1);
  });
});
