/** Client hooks for the disabled-by-default MemoryCore Formal import seam. */
import type {
  ProductionRestoreTransport,
} from "./production-restore-executor.js";
import type {
  ServerTeamMemoryImportHook,
  ServerTeamMemoryImportInput,
} from "./server-team-production-requirements.js";

export class ServerTeamMemoryImportClientError extends Error {
  readonly code = "FORMAL_MEMORY_IMPORT_FAILED" as const;

  constructor(readonly requirementId: string, message: string) {
    super(`server_team Formal Memory import ${requirementId}: ${message}`);
    this.name = "ServerTeamMemoryImportClientError";
  }
}

export interface ServerTeamMemoryImportHooksConfig {
  readonly transport: ProductionRestoreTransport;
  readonly datasetSpaceId: string;
  readonly datasetUserId: string;
}

export interface ServerTeamMemoryImportEvidence {
  readonly kind: "l1" | "l2";
  readonly formalAssetId: string;
  readonly runtimeLocator:
    | Readonly<{ kind: "asset-id"; assetId: string }>
    | Readonly<{ kind: "scenario-path"; path: string }>;
  readonly contentSha256: string;
  readonly expectedAssetContentHash: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function parseEvidence(
  input: ServerTeamMemoryImportInput,
  expectedKind: "l1" | "l2",
  status: number,
  rawBody: unknown,
): ServerTeamMemoryImportEvidence {
  if (status < 200 || status >= 300 || !isRecord(rawBody) || rawBody.code !== 0
    || !isRecord(rawBody.data)) {
    throw new ServerTeamMemoryImportClientError(
      input.requirementId,
      `MemoryCore returned an unsuccessful response (HTTP ${status})`,
    );
  }
  const data = rawBody.data;
  if (data.kind !== expectedKind || data.formal_asset_id !== input.formalAssetId
    || data.expected_asset_content_hash !== input.expectedAssetContentHash
    || !isSha256(data.content_sha256) || !isRecord(data.runtime_locator)) {
    throw new ServerTeamMemoryImportClientError(
      input.requirementId,
      "MemoryCore import receipt does not match the requested asset",
    );
  }
  const locator = data.runtime_locator;
  if (expectedKind === "l1") {
    if (locator.kind !== "asset-id" || locator.assetId !== input.formalAssetId) {
      throw new ServerTeamMemoryImportClientError(input.requirementId, "invalid L1 runtime locator");
    }
  } else if (locator.kind !== "scenario-path" || typeof locator.path !== "string"
    || locator.path.trim().length === 0) {
    throw new ServerTeamMemoryImportClientError(input.requirementId, "invalid L2 runtime locator");
  }
  return {
    kind: expectedKind,
    formalAssetId: input.formalAssetId,
    runtimeLocator: locator as ServerTeamMemoryImportEvidence["runtimeLocator"],
    contentSha256: data.content_sha256,
    expectedAssetContentHash: input.expectedAssetContentHash,
  };
}

function buildHook(
  config: ServerTeamMemoryImportHooksConfig,
  kind: "l1" | "l2",
): ServerTeamMemoryImportHook {
  return async (input) => {
    const response = await config.transport({
      actionId: input.requirementId,
      serviceBoundary: "memory_core",
      method: "POST",
      endpoint: "/v3/formal-bench/import-memory",
      executionIdentity: {
        datasetSpaceId: config.datasetSpaceId,
        datasetUserId: config.datasetUserId,
      },
      headers: {},
      body: {
        kind,
        formal_asset_id: input.formalAssetId,
        expected_asset_content_hash: input.expectedAssetContentHash,
        team_id: input.isolation.team_id,
        user_id: input.isolation.user_id,
        agent_id: input.isolation.agent_id,
        payload: input.payload,
      },
    });
    return parseEvidence(input, kind, response.status, response.body);
  };
}

export function createServerTeamMemoryImportHooks(
  config: ServerTeamMemoryImportHooksConfig,
): Readonly<{
  importMemoryL1: ServerTeamMemoryImportHook;
  importMemoryL2: ServerTeamMemoryImportHook;
}> {
  return Object.freeze({
    importMemoryL1: buildHook(config, "l1"),
    importMemoryL2: buildHook(config, "l2"),
  });
}
