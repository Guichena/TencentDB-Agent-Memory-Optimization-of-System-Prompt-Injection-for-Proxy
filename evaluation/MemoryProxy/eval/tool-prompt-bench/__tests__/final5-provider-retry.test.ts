import { describe, expect, it } from "vitest";
import { isRetryableProviderRejection } from "../final5-real-executor.js";

describe("provider rejection retry classification", () => {
  const rejection = 'unexpected status 404: {"error":{"code":"model_not_found","message":"Model \\"gpt-5.6-luna\\" is not available for this group"}}';
  const throttled = '{"type":"turn.failed","error":{"message":"exceeded retry limit, last status: 429 Too Many Requests"}}';

  it("retries an upstream group rejection before any model work", () => {
    expect(isRetryableProviderRejection(rejection, 0)).toBe(true);
  });

  it("does not retry after a completed turn", () => {
    expect(isRetryableProviderRejection(rejection, 1)).toBe(false);
  });

  it("retries a terminal provider throttle before the turn completes", () => {
    expect(isRetryableProviderRejection(throttled, 0)).toBe(true);
  });

  it("does not retry a throttle after a completed turn", () => {
    expect(isRetryableProviderRejection(throttled, 1)).toBe(false);
  });

  it("does not mistake unrelated numeric output for throttling", () => {
    expect(isRetryableProviderRejection("processed 429 files", 0)).toBe(false);
  });
});
