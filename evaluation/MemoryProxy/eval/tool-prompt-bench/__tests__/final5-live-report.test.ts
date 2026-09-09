import { describe, expect, it } from "vitest";
import { classifyV4Regression, isTimeoutAttempt } from "../final5-live-report.js";

const row = (shouldCall: boolean, score: Record<string, unknown>) => ({
  caseId: "case-1", shouldCall, pairId: null, behaviorEligible: true, score,
});

describe("V4 live regression classification", () => {
  it("records lost trigger and chain outcomes on positive cases", () => {
    const result = classifyV4Regression({ client: "codex",
      baseline: row(true, { triggeredAttempt: true, completeChainSuccess: true, positiveOvercall: false }),
      v4: row(true, { triggeredAttempt: false, completeChainSuccess: false, positiveOvercall: false }) });
    expect(result?.reasons).toEqual(["triggeredAttempt:true->false", "completeChainSuccess:true->false"]);
  });

  it("records newly introduced false calls on negative cases", () => {
    const result = classifyV4Regression({ client: "claude-code",
      baseline: row(false, { falseCallAttempt: false, falseCallAccepted: false }),
      v4: row(false, { falseCallAttempt: true, falseCallAccepted: true }) });
    expect(result?.reasons).toEqual(["falseCallAttempt:false->true", "falseCallAccepted:false->true"]);
  });

  it("ignores improvements and incomplete evidence", () => {
    expect(classifyV4Regression({ client: "codex",
      baseline: row(true, { triggeredAttempt: false }), v4: row(true, { triggeredAttempt: true }) })).toBeNull();
    expect(classifyV4Regression({ client: "codex",
      baseline: { ...row(true, {}), behaviorEligible: false }, v4: row(true, {}) })).toBeNull();
  });
});

describe("live incomplete classification", () => {
  const attempt = (trace: unknown, error = "Error: slot failed") => ({
    attempt: 0, status: "failed" as const, startedAt: "2026-09-09T00:00:00.000Z",
    durationMs: 480_000, retryable: false, error, trace,
  });

  it("classifies Claude and Codex case timeouts as incomplete", () => {
    expect(isTimeoutAttempt(attempt({ infrastructureError: "Claude Code runner timed out" }))).toBe(true);
    expect(isTimeoutAttempt(attempt({ timedOut: true }))).toBe(true);
  });

  it("does not classify other provider exclusions as timeouts", () => {
    expect(isTimeoutAttempt(attempt({ infrastructureError: "upstream 429" }))).toBe(false);
  });
});
