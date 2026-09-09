import { createHash } from "node:crypto";

import type { ProxyConfig } from "./types.js";

export const EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA =
  "task1.proxy-config-fingerprint.v2" as const;

export interface ExperimentConfigFingerprint {
  readonly schemaVersion: typeof EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA;
  /** Value-bound effective config with toolPromptProfile removed. */
  readonly baseSha256: string;
  /** The same value-bound projection plus the effective production toolPromptProfile. */
  readonly effectiveSha256: string;
}

type JsonProjection = null | boolean | number | string | JsonProjection[] | {
  readonly [key: string]: JsonProjection;
};

function projectConfig(value: unknown): JsonProjection | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Proxy config fingerprint cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => projectConfig(item) ?? null);
  }
  if (typeof value !== "object") return String(value);

  const output: Record<string, JsonProjection> = {};
  for (const childKey of Object.keys(value as Record<string, unknown>).sort()) {
    const projected = projectConfig((value as Record<string, unknown>)[childKey]);
    if (projected !== undefined) output[childKey] = projected;
  }
  return output;
}

function digest(value: JsonProjection): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/**
 * Produce comparison-only fingerprints for the formal Task 1 runner.
 * Secret values participate in the aggregate digest so credentials that select
 * different tenants/assets cannot be mistaken for the same experiment config.
 * Only the final SHA-256 values leave this function; config values are never
 * returned or logged by this module.
 */
export function fingerprintProxyConfigForExperiment(
  config: ProxyConfig,
): ExperimentConfigFingerprint {
  const effective = projectConfig(config);
  if (!effective || Array.isArray(effective) || typeof effective !== "object") {
    throw new Error("Proxy config fingerprint projection must be an object");
  }
  const injection = effective.injection;
  if (!injection || Array.isArray(injection) || typeof injection !== "object") {
    throw new Error("Proxy config fingerprint is missing injection config");
  }
  const profile = injection.toolPromptProfile;
  if (typeof profile !== "string" || profile.length === 0) {
    throw new Error("Proxy config fingerprint is missing toolPromptProfile");
  }
  const baseInjection = { ...injection };
  delete baseInjection.toolPromptProfile;
  const base = {
    ...effective,
    injection: baseInjection,
  };
  return Object.freeze({
    schemaVersion: EXPERIMENT_CONFIG_FINGERPRINT_SCHEMA,
    baseSha256: digest(base),
    effectiveSha256: digest({ baseSha256: digest(base), toolPromptProfile: profile }),
  });
}
