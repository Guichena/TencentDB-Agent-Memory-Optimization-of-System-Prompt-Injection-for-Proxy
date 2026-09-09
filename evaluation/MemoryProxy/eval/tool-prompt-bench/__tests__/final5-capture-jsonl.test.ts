import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendFinal5CaptureEvent, sessionCapturePath, type CaptureEvent } from "../final5-http-capture.js";

describe("Final5 capture JSONL", () => {
  it("writes one parseable JSON object per physical line", () => {
    const directory = mkdtempSync(join(tmpdir(), "final5-capture-"));
    const base: CaptureEvent = {
      type: "provider.start",
      id: "request-1",
      sessionId: "session-1",
      timestamp: "2026-09-09T00:00:00.000Z",
    };
    try {
      appendFinal5CaptureEvent(directory, base);
      appendFinal5CaptureEvent(directory, { ...base, type: "provider.end", status: 200 });
      const lines = readFileSync(sessionCapturePath(directory, base.sessionId), "utf8").split(/\r?\n/).filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => JSON.parse(line).type)).toEqual(["provider.start", "provider.end"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
