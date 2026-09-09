/** Minimal HTTP transport for the local server_team production data plane. */
import type {
  ProductionRestoreTransport,
  ProductionRestoreTransportRequest,
} from "./production-restore-executor.js";

export type ServerTeamProductionTransportErrorCode =
  | "INVALID_CONFIG"
  | "SERVICE_MAPPING_MISSING"
  | "SERVICE_MAPPING_MISMATCH"
  | "INVALID_CORRELATION_HEADER"
  | "FETCH_FAILED"
  | "INVALID_JSON_RESPONSE";

export class ServerTeamProductionTransportError extends Error {
  constructor(
    readonly code: ServerTeamProductionTransportErrorCode,
    readonly actionId: string,
    message: string,
  ) {
    super(`server_team production transport [${code}] ${actionId}: ${message}`);
    this.name = "ServerTeamProductionTransportError";
  }
}

type FetchImplementation = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface ServerTeamProductionTransportConfig {
  readonly memoryCoreBaseUrl: string;
  readonly memoryKnowledgeBaseUrl: string;
  /** Runtime-only MemoryCore gateway credential. */
  readonly memoryCoreApiKey: string;
  /** Runtime-only secret. It is never added to MemoryKnowledge requests. */
  readonly userKey: string;
  readonly serviceIdsByDatasetSpaceId: Readonly<Record<string, string>>;
  readonly fetchImpl?: FetchImplementation;
}

function invalidConfig(message: string): never {
  throw new ServerTeamProductionTransportError("INVALID_CONFIG", "configuration", message);
}

function normalizeBaseUrl(label: string, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfig(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalidConfig(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return invalidConfig(`${label} must not contain credentials, query, or fragment`);
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  return parsed;
}

function nonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidConfig(`${label} must be a non-empty string`);
  }
  return value;
}

function actionUrl(base: URL, endpoint: string): string {
  return new URL(endpoint.replace(/^\/+/, ""), base).toString();
}

function correlationHeaders(
  request: ProductionRestoreTransportRequest,
  runtimeServiceId: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ServerTeamProductionTransportError(
        "INVALID_CORRELATION_HEADER",
        request.actionId,
        `${name} must resolve to a non-empty string`,
      );
    }
    result[name.toLowerCase()] = value;
  }
  const declaredServiceId = result["x-tdai-service-id"];
  if (declaredServiceId !== undefined && declaredServiceId !== runtimeServiceId) {
    throw new ServerTeamProductionTransportError(
      "SERVICE_MAPPING_MISMATCH",
      request.actionId,
      "plan correlation service id differs from the runtime Space mapping",
    );
  }
  result["x-tdai-service-id"] = runtimeServiceId;
  return result;
}

/**
 * Build a transport that routes each frozen action to the correct production
 * service. Fetch/network failures are deliberately reported without their raw
 * error text so credentials embedded by a host runtime cannot leak to output.
 */
export function createServerTeamProductionTransport(
  config: ServerTeamProductionTransportConfig,
): ProductionRestoreTransport {
  const memoryCoreBaseUrl = normalizeBaseUrl("memoryCoreBaseUrl", config.memoryCoreBaseUrl);
  const memoryKnowledgeBaseUrl = normalizeBaseUrl(
    "memoryKnowledgeBaseUrl",
    config.memoryKnowledgeBaseUrl,
  );
  const memoryCoreApiKey = nonBlank("memoryCoreApiKey", config.memoryCoreApiKey);
  const userKey = nonBlank("userKey", config.userKey);
  const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  if (typeof fetchImpl !== "function") return invalidConfig("fetch implementation is unavailable");

  return async (request) => {
    const runtimeServiceId = config.serviceIdsByDatasetSpaceId[
      request.executionIdentity.datasetSpaceId
    ];
    if (typeof runtimeServiceId !== "string" || runtimeServiceId.trim().length === 0) {
      throw new ServerTeamProductionTransportError(
        "SERVICE_MAPPING_MISSING",
        request.actionId,
        `no runtime service id for dataset Space ${request.executionIdentity.datasetSpaceId}`,
      );
    }

    const headers = {
      "content-type": "application/json",
      ...correlationHeaders(request, runtimeServiceId),
      ...(request.serviceBoundary === "memory_core"
        ? {
          authorization: `Bearer ${memoryCoreApiKey}`,
          "x-tdai-user-key": userKey,
        }
        : {}),
    };
    const baseUrl = request.serviceBoundary === "memory_core"
      ? memoryCoreBaseUrl
      : memoryKnowledgeBaseUrl;

    let response: Response;
    try {
      response = await fetchImpl(actionUrl(baseUrl, request.endpoint), {
        method: request.method,
        headers,
        body: JSON.stringify(request.body),
      });
    } catch {
      throw new ServerTeamProductionTransportError(
        "FETCH_FAILED",
        request.actionId,
        "request did not receive an HTTP response",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServerTeamProductionTransportError(
        "INVALID_JSON_RESPONSE",
        request.actionId,
        `HTTP ${response.status} response was not JSON`,
      );
    }
    return { status: response.status, body };
  };
}
