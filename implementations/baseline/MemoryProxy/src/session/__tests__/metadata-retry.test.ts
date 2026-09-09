import { describe, expect, it, vi } from "vitest";
import { isTransientMetadataError, withMetadataRetry } from "../metadata-retry.js";

describe("metadata retry", () => {
  it("retries a transient metadata fetch failure and returns the successful result", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("[metadata-client] /v3/meta/agent/list fetch failed: read ECONNRESET"))
      .mockResolvedValueOnce({ teams: ["team-1"] });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withMetadataRetry(operation, { sleep })).resolves.toEqual({ teams: ["team-1"] });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("does not retry permanent metadata errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("[metadata-client] /v3/meta/team/list HTTP 401"));

    await expect(withMetadataRetry(operation, { sleep: vi.fn() })).rejects.toThrow("HTTP 401");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes retryable HTTP status codes", () => {
    expect(isTransientMetadataError(new Error("HTTP 429"))).toBe(true);
    expect(isTransientMetadataError(new Error("HTTP 503"))).toBe(true);
    expect(isTransientMetadataError(new Error("HTTP 404"))).toBe(false);
  });
});
