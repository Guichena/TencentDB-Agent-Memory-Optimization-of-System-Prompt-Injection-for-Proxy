import { canonicalSha256 } from "./formal-runtime/canonical.js";

export const FORMAL_EXECUTION_PREFLIGHT_RECEIPT_SCHEMA =
  "task1.formal-execution-preflight-receipt.v1" as const;

export type FormalAssetFamily = "memory" | "skill" | "knowledge";
export type FormalSessionStoreLayer = "l1" | "l2a" | "l2b" | "history-scan";
export type FormalPreflightCheckId =
  | "auth-user-mapping"
  | "metadata-identity"
  | "session-identity"
  | "visible-assets"
  | "write-side-disabled"
  | "fresh-session-namespace";

export interface FormalExpectedExecutionBinding {
  readonly datasetUserId: string;
  readonly spaceId: string;
  readonly teamId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly agentSource: string;
  readonly visibleAssetSetSha256: string;
}

/** Projection of the frozen dataset-user to runtime-user mapping artifact. */
export interface FormalLogicalIdentity {
  readonly datasetUserId: string;
  readonly spaceId: string;
  readonly teamId: string;
  readonly agentId: string;
  readonly taskId: string;
}

export interface FormalRuntimeIdentity {
  readonly resolvedAuthUserId: string;
  readonly spaceId: string;
  readonly teamId: string;
  readonly agentId: string;
  readonly taskId: string;
}

export type FormalRuntimeAssetLocator =
  | { readonly kind: "asset-id"; readonly assetId: string }
  | { readonly kind: "scenario-path"; readonly path: string }
  | {
    readonly kind: "conversation-message";
    readonly sessionId: string;
    readonly messageIds: readonly string[];
  }
  | {
    readonly kind: "core-scope";
    readonly spaceId: string;
    readonly teamId: string;
    readonly userId: string;
    readonly agentId: string;
  };

export interface FormalAssetLocatorMapping {
  readonly logicalAssetId: string;
  readonly family: FormalAssetFamily;
  readonly subtype: string;
  /** Actual Agent scope used to read this asset; defaults to the selected Agent. */
  readonly sourceAgentId?: string;
  readonly runtimeLocator: FormalRuntimeAssetLocator;
  readonly readBackReceiptSha256: string;
}

export interface FormalIdentityMappingObservation {
  readonly sourceArtifactSha256: string;
  readonly logicalIdentity: FormalLogicalIdentity;
  readonly runtimeIdentity: FormalRuntimeIdentity;
  readonly assetLocators: readonly FormalAssetLocatorMapping[];
}

/** Non-secret projection of the actual `/v3/meta/auth/verify` exchange. */
export interface FormalAuthVerifyObservation {
  readonly serviceId: string;
  readonly httpStatus: number;
  readonly envelopeCode: number;
  readonly responseValid: boolean;
  readonly resolvedUserId: string;
}

export interface FormalMetadataTeamObservation {
  readonly teamId: string;
  readonly agentIds: readonly string[];
  readonly taskIds: readonly string[];
}

/** Projection of the actual metadata responses used by Session Init. */
export interface FormalMetadataObservation {
  readonly serviceId: string;
  readonly resolvedUserId: string;
  readonly httpStatus: number;
  readonly envelopeCode: number;
  readonly teams: readonly FormalMetadataTeamObservation[];
}

export interface FormalObservedSessionIdentity {
  readonly sessionId: string;
  readonly spaceId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly agentSource: string;
}

export interface FormalSessionObservation {
  readonly request: FormalObservedSessionIdentity;
  readonly response: FormalObservedSessionIdentity & {
    readonly httpStatus: number;
    readonly envelopeCode: number;
  };
}

export interface FormalAssetReadBackItemObservation {
  readonly subtype: string;
  readonly runtimeLocator: FormalRuntimeAssetLocator;
}

export interface FormalAssetInventorySourceObservation {
  /** Identity actually sent on this read-back request. */
  readonly serviceId: string;
  readonly resolvedUserId: string;
  readonly teamId: string;
  readonly agentId: string;
  readonly family: FormalAssetFamily;
  readonly requestPath: string;
  readonly httpStatus: number;
  readonly envelopeCode: number;
  /** Hash of the exact successful read-back response content. */
  readonly contentSha256: string;
  /** Hash of the request/response receipt referenced by the mapping artifact. */
  readonly receiptSha256: string;
  readonly items: readonly FormalAssetReadBackItemObservation[];
}

/** Union of the actual Memory, Skill and Knowledge visibility-list responses. */
export interface FormalAssetInventoryObservation {
  readonly sources: readonly FormalAssetInventorySourceObservation[];
}

/** Raw effective config fields; there is deliberately no caller-supplied `disabled` verdict. */
export interface FormalEffectiveWriteConfigObservation {
  readonly configFingerprintSha256: string;
  readonly extractionEnabled: boolean;
  readonly extractionExtractorIds: readonly string[];
  readonly tdaiL0WriteEnabled: boolean;
  readonly skillLlmWriteEnabled: boolean;
  readonly analyseMarkerEnabled: boolean;
  readonly assetReflectionEnabled: boolean;
  readonly archiveWriteBackEnabled: boolean;
}

export interface FormalSessionStoreLookupObservation {
  readonly layer: FormalSessionStoreLayer;
  readonly matchedSessionIds: readonly string[];
}

/** Pre-registration store lookup results for the opaque session namespace. */
export interface FormalSessionNamespaceObservation {
  readonly sessionId: string;
  readonly preRegistrationLookups: readonly FormalSessionStoreLookupObservation[];
}

export interface FormalExecutionPreflightInput {
  readonly expected: FormalExpectedExecutionBinding;
  readonly identityMapping: FormalIdentityMappingObservation;
  readonly authVerify: FormalAuthVerifyObservation;
  readonly metadata: FormalMetadataObservation;
  readonly session: FormalSessionObservation;
  readonly assetInventory: FormalAssetInventoryObservation;
  readonly effectiveWriteConfig: FormalEffectiveWriteConfigObservation;
  readonly sessionNamespace: FormalSessionNamespaceObservation;
}

export interface FormalPreflightCheck {
  readonly id: FormalPreflightCheckId;
  readonly status: "pass" | "fail";
}

export interface FormalExecutionPreflightReceipt {
  readonly schemaVersion: typeof FORMAL_EXECUTION_PREFLIGHT_RECEIPT_SCHEMA;
  readonly ready: boolean;
  readonly logicalIdentity: Readonly<FormalLogicalIdentity>;
  readonly runtimeIdentity: Readonly<FormalRuntimeIdentity>;
  readonly sessionId: string;
  readonly agentSource: string;
  readonly visibleAssetSetSha256: string;
  readonly visibleAssetCount: number;
  readonly identityMappingSourceSha256: string;
  readonly effectiveConfigSha256: string;
  readonly assetReadBackReceipts: readonly Readonly<{
    readonly receiptSha256: string;
    readonly contentSha256: string;
  }>[];
  readonly checks: readonly FormalPreflightCheck[];
}

/**
 * Provenance added by the offline preflight CLI after both the frozen restore
 * plan and the sealed inspect envelope have passed their pinned parsers. The
 * raw evaluator deliberately cannot manufacture this binding on its own.
 */
export interface FormalPreflightProvenance {
  readonly restorePlanSha256: string;
  readonly snapshotId: string;
  readonly snapshotCanonicalSha256: string;
  readonly inspectEnvelopeCanonicalSha256: string;
}

export interface PinnedFormalExecutionPreflightReceipt
  extends FormalExecutionPreflightReceipt {
  readonly provenance: Readonly<FormalPreflightProvenance>;
}

function requireNonBlank(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireSha256(name: string, value: unknown): string {
  const text = requireNonBlank(name, value);
  if (!/^[a-f0-9]{64}$/iu.test(text)) throw new Error(`${name} must be a SHA-256 hex digest`);
  return text.toLowerCase();
}

function requireInteger(name: string, value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value as number;
}

function requireStringArray(name: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item, index) => requireNonBlank(`${name}[${index}]`, item));
}

function validateRuntimeLocator(name: string, locator: FormalRuntimeAssetLocator): void {
  if (!locator || typeof locator !== "object" || Array.isArray(locator)) {
    throw new Error(`${name} must be an object`);
  }
  if (locator.kind === "asset-id") {
    requireNonBlank(`${name}.assetId`, locator.assetId);
    return;
  }
  if (locator.kind === "scenario-path") {
    requireNonBlank(`${name}.path`, locator.path);
    return;
  }
  if (locator.kind === "conversation-message") {
    requireNonBlank(`${name}.sessionId`, locator.sessionId);
    const messageIds = requireStringArray(`${name}.messageIds`, locator.messageIds);
    if (messageIds.length === 0 || new Set(messageIds).size !== messageIds.length) {
      throw new Error(`${name}.messageIds must contain unique message ids`);
    }
    return;
  }
  if (locator.kind === "core-scope") {
    requireNonBlank(`${name}.spaceId`, locator.spaceId);
    requireNonBlank(`${name}.teamId`, locator.teamId);
    requireNonBlank(`${name}.userId`, locator.userId);
    requireNonBlank(`${name}.agentId`, locator.agentId);
    return;
  }
  throw new Error(`${name}.kind is unsupported`);
}

function locatorKey(locator: FormalRuntimeAssetLocator): string {
  if (locator.kind === "asset-id") {
    return canonicalSha256({ kind: locator.kind, assetId: locator.assetId });
  }
  if (locator.kind === "scenario-path") {
    return canonicalSha256({ kind: locator.kind, path: locator.path });
  }
  if (locator.kind === "conversation-message") {
    return canonicalSha256({
      kind: locator.kind,
      sessionId: locator.sessionId,
      messageIds: [...locator.messageIds].sort((left, right) => left.localeCompare(right)),
    });
  }
  return canonicalSha256({
    kind: locator.kind,
    spaceId: locator.spaceId,
    teamId: locator.teamId,
    userId: locator.userId,
    agentId: locator.agentId,
  });
}

function isActualReadBackPath(
  family: FormalAssetFamily,
  subtype: string,
  requestPath: string,
): boolean {
  if (family === "memory") {
    if (subtype === "l0") return requestPath === "/v3/conversation/query";
    if (subtype === "l1") return requestPath === "/v3/atomic/query";
    if (subtype === "l2") return requestPath === "/v3/scenario/ls" || requestPath === "/v3/scenario/read";
    if (subtype === "l3") return requestPath === "/v3/core/read";
    return false;
  }
  if (family === "skill") {
    return requestPath === "/v3/skill/listing"
      || requestPath === "/v3/skill/search"
      || requestPath === "/v3/skill/get"
      || requestPath === "/v3/skill/get-by-name";
  }
  return requestPath === "/v3/meta/agent-fixed-asset/list-with-detail"
    || requestPath === "/v3/tools/list";
}

function sameIdentity(
  observed: FormalObservedSessionIdentity,
  expected: FormalExpectedExecutionBinding,
  runtime: FormalRuntimeIdentity,
): boolean {
  return observed.sessionId === expected.sessionId
    && observed.spaceId === runtime.spaceId
    && observed.teamId === runtime.teamId
    && observed.userId === runtime.resolvedAuthUserId
    && observed.agentId === runtime.agentId
    && observed.taskId === runtime.taskId
    && observed.agentSource === expected.agentSource;
}

function check(id: FormalPreflightCheckId, passed: boolean): FormalPreflightCheck {
  return Object.freeze({ id, status: passed ? "pass" as const : "fail" as const });
}

function validateStructure(input: FormalExecutionPreflightInput): void {
  const expected = input.expected;
  for (const [name, value] of Object.entries({
    datasetUserId: expected.datasetUserId,
    spaceId: expected.spaceId,
    teamId: expected.teamId,
    agentId: expected.agentId,
    taskId: expected.taskId,
    sessionId: expected.sessionId,
    agentSource: expected.agentSource,
  })) requireNonBlank(`expected.${name}`, value);
  requireSha256("expected.visibleAssetSetSha256", expected.visibleAssetSetSha256);

  requireSha256("identityMapping.sourceArtifactSha256", input.identityMapping.sourceArtifactSha256);
  for (const [name, value] of Object.entries({
    datasetUserId: input.identityMapping.logicalIdentity.datasetUserId,
    spaceId: input.identityMapping.logicalIdentity.spaceId,
    teamId: input.identityMapping.logicalIdentity.teamId,
    agentId: input.identityMapping.logicalIdentity.agentId,
    taskId: input.identityMapping.logicalIdentity.taskId,
  })) {
    requireNonBlank(`identityMapping.logicalIdentity.${name}`, value);
  }
  for (const [name, value] of Object.entries({
    resolvedAuthUserId: input.identityMapping.runtimeIdentity.resolvedAuthUserId,
    spaceId: input.identityMapping.runtimeIdentity.spaceId,
    teamId: input.identityMapping.runtimeIdentity.teamId,
    agentId: input.identityMapping.runtimeIdentity.agentId,
    taskId: input.identityMapping.runtimeIdentity.taskId,
  })) {
    requireNonBlank(`identityMapping.runtimeIdentity.${name}`, value);
  }
  if (!Array.isArray(input.identityMapping.assetLocators)) {
    throw new Error("identityMapping.assetLocators must be an array");
  }
  input.identityMapping.assetLocators.forEach((mapping, index) => {
    requireNonBlank(`identityMapping.assetLocators[${index}].logicalAssetId`, mapping.logicalAssetId);
    if (mapping.family !== "memory" && mapping.family !== "skill" && mapping.family !== "knowledge") {
      throw new Error(`identityMapping.assetLocators[${index}].family is unsupported`);
    }
    requireNonBlank(`identityMapping.assetLocators[${index}].subtype`, mapping.subtype);
    if (mapping.sourceAgentId !== undefined) {
      requireNonBlank(`identityMapping.assetLocators[${index}].sourceAgentId`, mapping.sourceAgentId);
    }
    validateRuntimeLocator(`identityMapping.assetLocators[${index}].runtimeLocator`, mapping.runtimeLocator);
    requireSha256(
      `identityMapping.assetLocators[${index}].readBackReceiptSha256`,
      mapping.readBackReceiptSha256,
    );
  });

  requireNonBlank("authVerify.serviceId", input.authVerify.serviceId);
  requireInteger("authVerify.httpStatus", input.authVerify.httpStatus);
  requireInteger("authVerify.envelopeCode", input.authVerify.envelopeCode);
  requireNonBlank("authVerify.resolvedUserId", input.authVerify.resolvedUserId);

  requireNonBlank("metadata.serviceId", input.metadata.serviceId);
  requireNonBlank("metadata.resolvedUserId", input.metadata.resolvedUserId);
  requireInteger("metadata.httpStatus", input.metadata.httpStatus);
  requireInteger("metadata.envelopeCode", input.metadata.envelopeCode);
  if (!Array.isArray(input.metadata.teams)) throw new Error("metadata.teams must be an array");
  input.metadata.teams.forEach((team, index) => {
    requireNonBlank(`metadata.teams[${index}].teamId`, team.teamId);
    requireStringArray(`metadata.teams[${index}].agentIds`, team.agentIds);
    requireStringArray(`metadata.teams[${index}].taskIds`, team.taskIds);
  });

  for (const [side, observed] of [["request", input.session.request], ["response", input.session.response]] as const) {
    for (const [name, value] of Object.entries({
      sessionId: observed.sessionId,
      spaceId: observed.spaceId,
      teamId: observed.teamId,
      userId: observed.userId,
      agentId: observed.agentId,
      taskId: observed.taskId,
      agentSource: observed.agentSource,
    })) {
      requireNonBlank(`session.${side}.${name}`, value);
    }
  }
  requireInteger("session.response.httpStatus", input.session.response.httpStatus);
  requireInteger("session.response.envelopeCode", input.session.response.envelopeCode);

  if (!Array.isArray(input.assetInventory.sources)) throw new Error("assetInventory.sources must be an array");
  input.assetInventory.sources.forEach((source, index) => {
    requireNonBlank(`assetInventory.sources[${index}].serviceId`, source.serviceId);
    requireNonBlank(`assetInventory.sources[${index}].resolvedUserId`, source.resolvedUserId);
    requireNonBlank(`assetInventory.sources[${index}].teamId`, source.teamId);
    requireNonBlank(`assetInventory.sources[${index}].agentId`, source.agentId);
    if (source.family !== "memory" && source.family !== "skill" && source.family !== "knowledge") {
      throw new Error(`assetInventory.sources[${index}].family is unsupported`);
    }
    requireNonBlank(`assetInventory.sources[${index}].requestPath`, source.requestPath);
    requireInteger(`assetInventory.sources[${index}].httpStatus`, source.httpStatus);
    requireInteger(`assetInventory.sources[${index}].envelopeCode`, source.envelopeCode);
    requireSha256(`assetInventory.sources[${index}].contentSha256`, source.contentSha256);
    requireSha256(`assetInventory.sources[${index}].receiptSha256`, source.receiptSha256);
    if (!Array.isArray(source.items)) throw new Error(`assetInventory.sources[${index}].items must be an array`);
    (source.items as readonly FormalAssetReadBackItemObservation[]).forEach((item, itemIndex) => {
      requireNonBlank(`assetInventory.sources[${index}].items[${itemIndex}].subtype`, item.subtype);
      validateRuntimeLocator(
        `assetInventory.sources[${index}].items[${itemIndex}].runtimeLocator`,
        item.runtimeLocator,
      );
    });
  });

  requireSha256(
    "effectiveWriteConfig.configFingerprintSha256",
    input.effectiveWriteConfig.configFingerprintSha256,
  );
  requireStringArray(
    "effectiveWriteConfig.extractionExtractorIds",
    input.effectiveWriteConfig.extractionExtractorIds,
  );
  requireNonBlank("sessionNamespace.sessionId", input.sessionNamespace.sessionId);
  if (!Array.isArray(input.sessionNamespace.preRegistrationLookups)) {
    throw new Error("sessionNamespace.preRegistrationLookups must be an array");
  }
  input.sessionNamespace.preRegistrationLookups.forEach((lookup, index) => {
    if (!(["l1", "l2a", "l2b", "history-scan"] as const).includes(lookup.layer)) {
      throw new Error(`sessionNamespace.preRegistrationLookups[${index}].layer is unsupported`);
    }
    requireStringArray(
      `sessionNamespace.preRegistrationLookups[${index}].matchedSessionIds`,
      lookup.matchedSessionIds,
    );
  });
}

/**
 * Cross-check execution-time observations without opening credentials or
 * trusting a caller-computed readiness flag. The returned receipt contains no
 * user key, service token, Authorization header, or source response body.
 */
export function evaluateFormalExecutionPreflight(
  input: FormalExecutionPreflightInput,
): FormalExecutionPreflightReceipt {
  validateStructure(input);
  const expected = input.expected;
  const mappedLogical = input.identityMapping.logicalIdentity;
  const mappedRuntime = input.identityMapping.runtimeIdentity;

  const authMappingPasses = input.authVerify.serviceId === mappedRuntime.spaceId
    && input.authVerify.httpStatus === 200
    && input.authVerify.envelopeCode === 0
    && input.authVerify.responseValid === true
    && input.authVerify.resolvedUserId === mappedRuntime.resolvedAuthUserId
    && mappedLogical.datasetUserId === expected.datasetUserId
    && mappedLogical.spaceId === expected.spaceId
    && mappedLogical.teamId === expected.teamId
    && mappedLogical.agentId === expected.agentId
    && mappedLogical.taskId === expected.taskId;

  const selectedTeam = input.metadata.teams.find((team) => team.teamId === mappedRuntime.teamId);
  const metadataPasses = input.metadata.serviceId === mappedRuntime.spaceId
    && input.metadata.resolvedUserId === mappedRuntime.resolvedAuthUserId
    && input.metadata.httpStatus === 200
    && input.metadata.envelopeCode === 0
    && selectedTeam !== undefined
    && selectedTeam.agentIds.includes(mappedRuntime.agentId)
    && selectedTeam.taskIds.includes(mappedRuntime.taskId);

  const sessionPasses = sameIdentity(input.session.request, expected, mappedRuntime)
    && input.session.response.httpStatus === 200
    && input.session.response.envelopeCode === 0
    && sameIdentity(input.session.response, expected, mappedRuntime);

  const sourceFamilies = new Set<FormalAssetFamily>();
  let inventorySourcesPass = true;
  const observedKeys: string[] = [];
  const successfulObservedKeys = new Set<string>();
  const observedReceiptHashes: string[] = [];
  for (const source of input.assetInventory.sources) {
    sourceFamilies.add(source.family);
    observedReceiptHashes.push(source.receiptSha256.toLowerCase());
    if (source.serviceId !== mappedRuntime.spaceId
      || source.resolvedUserId !== mappedRuntime.resolvedAuthUserId
      || source.teamId !== mappedRuntime.teamId) {
      inventorySourcesPass = false;
    }
    const sourcePasses = source.httpStatus === 200 && source.envelopeCode === 0;
    if (!sourcePasses) inventorySourcesPass = false;
    for (const item of source.items) {
      if (!isActualReadBackPath(source.family, item.subtype, source.requestPath)) {
        inventorySourcesPass = false;
      }
      const key = [
        source.receiptSha256.toLowerCase(),
        source.family,
        item.subtype,
        source.agentId,
        locatorKey(item.runtimeLocator),
      ].join("\u001f");
      observedKeys.push(key);
      if (sourcePasses) successfulObservedKeys.add(key);
    }
  }
  if (new Set(observedReceiptHashes).size !== observedReceiptHashes.length) inventorySourcesPass = false;
  if (new Set(observedKeys).size !== observedKeys.length) inventorySourcesPass = false;

  const locatorMappings = input.identityMapping.assetLocators;
  const logicalAssetIds = locatorMappings.map((mapping) => mapping.logicalAssetId);
  if (new Set(logicalAssetIds).size !== logicalAssetIds.length) inventorySourcesPass = false;
  const mappingKeys = locatorMappings.map((mapping) => [
    mapping.readBackReceiptSha256.toLowerCase(),
    mapping.family,
    mapping.subtype,
    mapping.sourceAgentId ?? mappedRuntime.agentId,
    locatorKey(mapping.runtimeLocator),
  ].join("\u001f"));
  if (new Set(mappingKeys).size !== mappingKeys.length) inventorySourcesPass = false;
  const expectedKeys = new Set(mappingKeys);
  if (expectedKeys.size !== successfulObservedKeys.size
    || observedKeys.some((key) => !expectedKeys.has(key))
    || mappingKeys.some((key) => !successfulObservedKeys.has(key))) {
    inventorySourcesPass = false;
  }
  for (const mapping of locatorMappings) {
    const sourceAgentId = mapping.sourceAgentId ?? mappedRuntime.agentId;
    if (!selectedTeam?.agentIds.includes(sourceAgentId)) inventorySourcesPass = false;
    if (mapping.runtimeLocator.kind === "core-scope"
      && (mapping.runtimeLocator.spaceId !== mappedRuntime.spaceId
        || mapping.runtimeLocator.teamId !== mappedRuntime.teamId
        || mapping.runtimeLocator.userId !== mappedRuntime.resolvedAuthUserId
        || mapping.runtimeLocator.agentId !== sourceAgentId)) {
      inventorySourcesPass = false;
    }
  }
  const successfulLogicalAssetIds = locatorMappings
    .filter((_mapping, index) => successfulObservedKeys.has(mappingKeys[index]))
    .map((mapping) => mapping.logicalAssetId);
  const computedVisibleAssetSetSha256 = canonicalSha256({
    teamId: expected.teamId,
    userId: expected.datasetUserId,
    agentId: expected.agentId,
    assetIds: [...successfulLogicalAssetIds].sort((left, right) => left.localeCompare(right)),
  });
  const visibleAssetsPass = inventorySourcesPass
    && sourceFamilies.size === 3
    && sourceFamilies.has("memory")
    && sourceFamilies.has("skill")
    && sourceFamilies.has("knowledge")
    && computedVisibleAssetSetSha256 === expected.visibleAssetSetSha256;

  const writeConfig = input.effectiveWriteConfig;
  const writeSideDisabled = writeConfig.extractionEnabled === false
    && writeConfig.extractionExtractorIds.length === 0
    && writeConfig.tdaiL0WriteEnabled === false
    && writeConfig.skillLlmWriteEnabled === false
    && writeConfig.analyseMarkerEnabled === false
    && writeConfig.assetReflectionEnabled === false
    && writeConfig.archiveWriteBackEnabled === false;

  const requiredLayers: readonly FormalSessionStoreLayer[] = ["l1", "l2a", "l2b", "history-scan"];
  const lookupLayers = input.sessionNamespace.preRegistrationLookups.map((lookup) => lookup.layer);
  const freshNamespace = input.sessionNamespace.sessionId === expected.sessionId
    && lookupLayers.length === requiredLayers.length
    && new Set(lookupLayers).size === requiredLayers.length
    && requiredLayers.every((layer) => lookupLayers.includes(layer))
    && input.sessionNamespace.preRegistrationLookups.every((lookup) => lookup.matchedSessionIds.length === 0);

  const checks = Object.freeze([
    check("auth-user-mapping", authMappingPasses),
    check("metadata-identity", metadataPasses),
    check("session-identity", sessionPasses),
    check("visible-assets", visibleAssetsPass),
    check("write-side-disabled", writeSideDisabled),
    check("fresh-session-namespace", freshNamespace),
  ]);
  const logicalIdentity = Object.freeze({
    datasetUserId: expected.datasetUserId,
    spaceId: expected.spaceId,
    teamId: expected.teamId,
    agentId: expected.agentId,
    taskId: expected.taskId,
  });
  const runtimeIdentity = Object.freeze({
    resolvedAuthUserId: input.authVerify.resolvedUserId,
    spaceId: input.session.response.spaceId,
    teamId: input.session.response.teamId,
    agentId: input.session.response.agentId,
    taskId: input.session.response.taskId,
  });
  const assetReadBackReceipts = Object.freeze(input.assetInventory.sources
    .map((source) => Object.freeze({
      receiptSha256: source.receiptSha256.toLowerCase(),
      contentSha256: source.contentSha256.toLowerCase(),
    }))
    .sort((left, right) => left.receiptSha256.localeCompare(right.receiptSha256)));
  return Object.freeze({
    schemaVersion: FORMAL_EXECUTION_PREFLIGHT_RECEIPT_SCHEMA,
    ready: checks.every((item) => item.status === "pass"),
    logicalIdentity,
    runtimeIdentity,
    sessionId: input.session.response.sessionId,
    agentSource: input.session.response.agentSource,
    visibleAssetSetSha256: computedVisibleAssetSetSha256,
    visibleAssetCount: successfulLogicalAssetIds.length,
    identityMappingSourceSha256: input.identityMapping.sourceArtifactSha256.toLowerCase(),
    effectiveConfigSha256: input.effectiveWriteConfig.configFingerprintSha256.toLowerCase(),
    assetReadBackReceipts,
    checks,
  });
}
