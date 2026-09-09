import { describe, expect, it } from "vitest";
import { buildRerunSelection } from "../build-final5-rerun-plan.js";

describe("formal rerun selection", () => {
  it("unions V4 regressions and incomplete cases without duplicate IDs", () => {
    const rows = buildRerunSelection([
      { client: "codex", caseId: "case-b", shouldCall: true, pairId: null,
        reasons: ["triggeredAttempt:true->false"], baseline: {}, v4: {} },
    ], [
      { client: "claude-code", variant: "V4", caseId: "case-b", classification: "timeout_incomplete" },
      { client: "codex", variant: "server_team", caseId: "case-a", classification: "infrastructure_excluded" },
    ]);
    expect(rows).toEqual([
      { caseId: "case-a", clients: ["codex"], reasons: ["server_team:infrastructure_excluded"] },
      { caseId: "case-b", clients: ["claude-code", "codex"],
        reasons: ["V4:timeout_incomplete", "v4_regression:triggeredAttempt:true->false"] },
    ]);
  });
});
