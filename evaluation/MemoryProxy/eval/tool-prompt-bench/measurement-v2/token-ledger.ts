import { TOOL_PROMPT_COMPILER_VERSION } from "../../../../../implementations/final/MemoryProxy/src/injection/tool-prompt/compiler.js";
import type {
  CompiledToolPrompt,
  PromptUnitKind,
  ToolPromptFamily,
  ToolPromptSurface,
} from "../../../../../implementations/final/MemoryProxy/src/injection/tool-prompt/types.js";
import { PRODUCTION_PROMPT_SOURCE_SEGMENTER_VERSION } from "../../../../../implementations/final/MemoryProxy/src/injection/production-source.js";
import { canonicalJsonClone, canonicalSha256, utf8Sha256 } from "./canonical-json.js";

export const TOKEN_LEDGER_COMPONENTS = [
  "staticTemplate",
  "executionContract",
  "runtimeBinding",
  "dynamicAsset",
] as const;

export type TokenLedgerComponent = (typeof TOKEN_LEDGER_COMPONENTS)[number];

export type TokenLedgerSourceKind = PromptUnitKind | "runtime-binding";

const SOURCE_KIND_TO_COMPONENT: Readonly<Record<TokenLedgerSourceKind, TokenLedgerComponent>> =
  Object.freeze({
    "legacy-body": "staticTemplate",
    policy: "staticTemplate",
    "execution-grammar": "executionContract",
    "tool-card": "staticTemplate",
    "dynamic-assets": "dynamicAsset",
    "runtime-binding": "runtimeBinding",
  });

const TOKEN_CLASSIFICATION_CONTRACT_DEFINITION = Object.freeze({
  contractId: "task1.m2.prompt-unit-classification",
  contractVersion: "1",
  compilerVersion: TOOL_PROMPT_COMPILER_VERSION,
  segmenterVersion: PRODUCTION_PROMPT_SOURCE_SEGMENTER_VERSION,
  orderedSourceRule: "zero_based_contiguous_unique_source_id_byte_complete",
  sourceKindToComponent: SOURCE_KIND_TO_COMPONENT,
});

export const TOKEN_CLASSIFICATION_CONTRACT = Object.freeze({
  ...TOKEN_CLASSIFICATION_CONTRACT_DEFINITION,
  contractSha256: canonicalSha256(TOKEN_CLASSIFICATION_CONTRACT_DEFINITION),
});

export interface TokenizerSeam {
  id: string;
  version: string;
  count(text: string): number;
}

export interface TokenLedgerSegment {
  order: number;
  sourceId: string;
  sourceSha256: string;
  text: string;
}

export interface TokenLedgerSourceDescriptor {
  order: number;
  sourceId: string;
  sourceLocalId: string;
  sourceKind: TokenLedgerSourceKind;
  sourceSha256: string;
  injectionBlockId: string;
  compilerFamily: ToolPromptFamily | null;
  compilerSurface: ToolPromptSurface | null;
  provenance:
    | "compiled-tool-prompt-unit"
    | "frozen-capture-static-tool"
    | "frozen-capture-execution-contract"
    | "frozen-capture-dynamic-asset"
    | "frozen-capture-runtime-binding";
}

export type FrozenCaptureSourceProvenance =
  | "frozen-capture-static-tool"
  | "frozen-capture-execution-contract"
  | "frozen-capture-dynamic-asset"
  | "frozen-capture-runtime-binding";

export interface FrozenCaptureSourceDescriptor {
  provenance: FrozenCaptureSourceProvenance;
  injectionBlockId: string;
  sourceId: string;
  sourceSha256: string;
}

export interface FrozenCaptureManifestSourceDescriptor extends FrozenCaptureSourceDescriptor {
  order: number;
}

export interface FrozenCaptureSourceManifest {
  schemaVersion: 1;
  segmenterVersion: string;
  sources: readonly FrozenCaptureManifestSourceDescriptor[];
  canonicalSha256: string;
}

export interface BuildFrozenCaptureSourceManifestInput {
  segmenterVersion: string;
  sources: readonly FrozenCaptureSourceDescriptor[];
}

export interface CompiledPromptBundle {
  injectionBlockId: string;
  compiledPrompt: CompiledToolPrompt;
}

export type TokenSourceManifestReference =
  | {
      provenance: "compiled-tool-prompt-unit";
      injectionBlockId: string;
      unitId: string;
    }
  | {
      provenance:
        | "frozen-capture-static-tool"
        | "frozen-capture-execution-contract"
        | "frozen-capture-dynamic-asset"
        | "frozen-capture-runtime-binding";
      injectionBlockId: string;
      sourceId: string;
    };

export interface BuildTrustedTokenSourceManifestInput {
  compilerVersion: string;
  segmenterVersion: string;
  compiledPromptBundles: readonly CompiledPromptBundle[];
  captureManifest: FrozenCaptureSourceManifest;
  providerOrder: readonly TokenSourceManifestReference[];
}

export interface TrustedTokenSourceManifest {
  schemaVersion: 1;
  contractId: typeof TOKEN_CLASSIFICATION_CONTRACT.contractId;
  contractVersion: string;
  contractSha256: string;
  compilerVersion: string;
  segmenterVersion: string;
  captureManifestSha256: string;
  sourceInventorySha256: string;
  orderedSourceManifestSha256: string;
  sourceRootSha256: string;
  orderedSources: readonly TokenLedgerSourceDescriptor[];
  canonicalSha256: string;
}

export interface ExpectedTokenSourceAttestation {
  authority: "campaign-integration" | "synthetic-self-built";
  sourceInventorySha256: string;
  orderedSourceManifestSha256: string;
  sourceRootSha256: string;
  /** Present only after the provider observer sealed an independent manifest. */
  frozenProviderSourceManifestSha256?: string;
  /** Binds correlation id + raw provider request hash + source manifest. */
  providerRequestBindingSha256?: string;
}

export interface TokenClassificationContractReference {
  contractVersion: string;
  contractSha256: string;
  compilerVersion: string;
  segmenterVersion: string;
}

export interface BuildTokenLedgerInput {
  variantId: string;
  runId: string;
  providerVisibleInjection: string;
  classification: TokenClassificationContractReference;
  sourceManifest: TrustedTokenSourceManifest;
  expectedSourceAttestation: ExpectedTokenSourceAttestation;
  segments: readonly TokenLedgerSegment[];
  tokenizer: TokenizerSeam;
}

export interface TokenTextMeasurement {
  tokens: number;
  utf8Bytes: number;
  sha256: string;
}

export interface TokenLedger {
  schemaVersion: 2;
  measurementModuleId: "M2";
  variantId: string;
  runId: string;
  tokenizer: { id: string; version: string };
  classification: {
    contractId: typeof TOKEN_CLASSIFICATION_CONTRACT.contractId;
    contractVersion: string;
    contractSha256: string;
    compilerVersion: string;
    segmenterVersion: string;
    trustedSourceManifestSha256: string;
    captureManifestSha256: string;
    sourceInventorySha256: string;
    orderedSourceManifestSha256: string;
    sourceRootSha256: string;
    expectedSourceAttestation: ExpectedTokenSourceAttestation;
    orderedSources: readonly TokenLedgerSourceDescriptor[];
    sourceKindToComponent: Readonly<Record<TokenLedgerSourceKind, TokenLedgerComponent>>;
    formalCompilerClosure:
      | {
          status: "ready";
          blocker: null;
          owner: "Integration";
        }
      | {
          status: "blocked";
          blocker:
            | "SELF_BUILT_SOURCE_ATTESTATION_NOT_FORMAL"
            | "FORMAL_PROVIDER_SOURCE_ATTESTATION_NOT_FINALIZED";
          owner: "Integration";
        };
  };
  componentTokenAccounting: "independently_encoded_non_additive";
  totalInjectionTokens: number;
  toolDescriptionStaticTokens: number;
  staticTemplateTokens: number;
  executionContractTokens: number;
  runtimeBindingTokens: number;
  dynamicAssetTokens: number;
  totalInjectionUtf8Bytes: number;
  toolDescriptionStaticUtf8Bytes: number;
  totalInjectionSha256: string;
  toolDescriptionStaticSha256: string;
  componentMeasurements: Record<TokenLedgerComponent, TokenTextMeasurement>;
  canonicalSha256: string;
}

export class TokenLedgerInfrastructureError extends Error {
  constructor(
    readonly code:
      | "IDENTITY_INVALID"
      | "INVALID_TOKENIZER"
      | "CLASSIFICATION_CONTRACT_MISMATCH"
      | "CLASSIFICATION_MANIFEST_HASH_MISMATCH"
      | "CLASSIFICATION_SOURCE_UNKNOWN"
      | "CLASSIFICATION_SEGMENT_MISSING"
      | "CLASSIFICATION_SOURCE_DUPLICATE"
      | "CLASSIFICATION_SOURCE_REORDERED"
      | "CLASSIFICATION_SOURCE_HASH_MISMATCH"
      | "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH"
      | "EXPECTED_SOURCE_ATTESTATION_MISSING"
      | "EXPECTED_SOURCE_INVENTORY_MISMATCH"
      | "EXPECTED_ORDERED_SOURCE_MANIFEST_MISMATCH"
      | "EXPECTED_SOURCE_ROOT_MISMATCH"
      | "CAPTURE_MANIFEST_MISSING"
      | "CAPTURE_MANIFEST_HASH_MISMATCH"
      | "SEGMENT_COVERAGE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "TokenLedgerInfrastructureError";
  }
}

function measure(text: string, tokenizer: TokenizerSeam): TokenTextMeasurement {
  const tokens = tokenizer.count(text);
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new TokenLedgerInfrastructureError(
      "INVALID_TOKENIZER",
      `tokenizer ${tokenizer.id}@${tokenizer.version} returned an invalid token count`,
    );
  }
  return {
    tokens,
    utf8Bytes: Buffer.byteLength(text, "utf8"),
    sha256: utf8Sha256(text),
  };
}

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function manifestWithoutSha(
  manifest: TrustedTokenSourceManifest,
): Omit<TrustedTokenSourceManifest, "canonicalSha256"> {
  const { canonicalSha256: _canonicalSha256, ...withoutSha } = manifest;
  return withoutSha;
}

function captureManifestWithoutSha(
  manifest: FrozenCaptureSourceManifest,
): Omit<FrozenCaptureSourceManifest, "canonicalSha256"> {
  const { canonicalSha256: _canonicalSha256, ...withoutSha } = manifest;
  return withoutSha;
}

export function buildFrozenCaptureSourceManifest(
  input: BuildFrozenCaptureSourceManifestInput,
): FrozenCaptureSourceManifest {
  if (input.segmenterVersion !== TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_CONTRACT_MISMATCH",
      "capture sources must use the frozen capture segmenter version",
    );
  }
  if (!Array.isArray(input.sources)) {
    throw new TokenLedgerInfrastructureError(
      "CAPTURE_MANIFEST_MISSING",
      "capture sources must be supplied by the capture-stage manifest builder",
    );
  }
  const identities = new Set<string>();
  const sources = input.sources.map((source, order) => {
    if (
      source === null
      || typeof source !== "object"
      || !isIdentity(source.injectionBlockId)
      || !isIdentity(source.sourceId)
      || !isSha256(source.sourceSha256)
      || (
        source.provenance !== "frozen-capture-static-tool"
        && source.provenance !== "frozen-capture-execution-contract"
        && source.provenance !== "frozen-capture-dynamic-asset"
        && source.provenance !== "frozen-capture-runtime-binding"
      )
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        `capture-stage source descriptor is invalid at order ${order}`,
      );
    }
    const identity = canonicalSha256({
      injectionBlockId: source.injectionBlockId,
      sourceId: source.sourceId,
    });
    if (identities.has(identity)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        `capture-stage source descriptor is duplicated at order ${order}`,
      );
    }
    identities.add(identity);
    return { order, ...source };
  });
  const withoutSha = {
    schemaVersion: 1 as const,
    segmenterVersion: input.segmenterVersion,
    sources,
  };
  return canonicalJsonClone({
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  }) as unknown as FrozenCaptureSourceManifest;
}

export function buildTrustedTokenSourceManifest(
  input: BuildTrustedTokenSourceManifestInput,
): TrustedTokenSourceManifest {
  if (
    input.compilerVersion !== TOKEN_CLASSIFICATION_CONTRACT.compilerVersion
    || input.segmenterVersion !== TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion
  ) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_CONTRACT_MISMATCH",
      "trusted sources must use the frozen compiler and capture segmenter versions",
    );
  }

  const captureManifest = input.captureManifest;
  if (
    captureManifest === null
    || typeof captureManifest !== "object"
    || captureManifest.schemaVersion !== 1
    || captureManifest.segmenterVersion !== input.segmenterVersion
    || !Array.isArray(captureManifest.sources)
  ) {
    throw new TokenLedgerInfrastructureError(
      "CAPTURE_MANIFEST_MISSING",
      "trusted token sources require a unified frozen capture-stage manifest",
    );
  }
  let observedCaptureManifestSha256: string | null = null;
  try {
    observedCaptureManifestSha256 = canonicalSha256(captureManifestWithoutSha(captureManifest));
  } catch {
    observedCaptureManifestSha256 = null;
  }
  if (observedCaptureManifestSha256 !== captureManifest.canonicalSha256) {
    throw new TokenLedgerInfrastructureError(
      "CAPTURE_MANIFEST_HASH_MISMATCH",
      "frozen capture manifest canonical hash does not match its contents",
    );
  }

  const inventory = new Map<string, Omit<TokenLedgerSourceDescriptor, "order">>();
  const referenceKey = (
    provenance: TokenLedgerSourceDescriptor["provenance"],
    injectionBlockId: string,
    sourceLocalId: string,
  ): string => canonicalSha256({ provenance, injectionBlockId, sourceLocalId });
  const qualified = (parts: readonly string[]): string => (
    parts.map((part) => encodeURIComponent(part)).join(":")
  );
  const addSource = (
    lookupKey: string,
    source: Omit<TokenLedgerSourceDescriptor, "order">,
  ): void => {
    if (
      !isIdentity(source.sourceId)
      || !isIdentity(source.sourceLocalId)
      || !isIdentity(source.injectionBlockId)
      || inventory.has(lookupKey)
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_DUPLICATE",
        "trusted source identities must be non-empty and unique in each qualified block scope",
      );
    }
    if (!Object.prototype.hasOwnProperty.call(SOURCE_KIND_TO_COMPONENT, source.sourceKind)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_UNKNOWN",
        `unknown compiler/capture source kind: ${String(source.sourceKind)}`,
      );
    }
    if (!isSha256(source.sourceSha256)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_HASH_MISMATCH",
        `trusted source hash is invalid for ${source.sourceId}`,
      );
    }
    inventory.set(lookupKey, source);
  };

  const compiledBlockIds = new Set<string>();
  for (const bundle of input.compiledPromptBundles) {
    const { injectionBlockId, compiledPrompt } = bundle;
    if (!isIdentity(injectionBlockId) || compiledBlockIds.has(injectionBlockId)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_DUPLICATE",
        "compiled prompt bundle block identities must be non-empty and unique",
      );
    }
    compiledBlockIds.add(injectionBlockId);
    if (
      compiledPrompt.compilerVersion !== input.compilerVersion
      || !isSha256(compiledPrompt.contentSha256)
      || compiledPrompt.contentSha256 !== utf8Sha256(compiledPrompt.content)
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_CONTRACT_MISMATCH",
        `compiled prompt bundle is not bound to the frozen compiler output: ${injectionBlockId}`,
      );
    }
    for (const unit of compiledPrompt.units) {
      if (unit.family !== compiledPrompt.family) {
        throw new TokenLedgerInfrastructureError(
          "CLASSIFICATION_CONTRACT_MISMATCH",
          `compiled prompt unit family mismatch in block ${injectionBlockId}`,
        );
      }
      const provenance = "compiled-tool-prompt-unit" as const;
      const lookupKey = referenceKey(provenance, injectionBlockId, unit.id);
      addSource(lookupKey, {
        sourceId: qualified([
          "compiled",
          compiledPrompt.family,
          compiledPrompt.surface,
          injectionBlockId,
          unit.id,
        ]),
        sourceLocalId: unit.id,
        sourceKind: unit.kind,
        sourceSha256: utf8Sha256(unit.content),
        injectionBlockId,
        compilerFamily: compiledPrompt.family,
        compilerSurface: compiledPrompt.surface,
        provenance,
      });
    }
  }
  for (const [captureOrder, source] of captureManifest.sources.entries()) {
    if (
      source === null
      || typeof source !== "object"
      || source.order !== captureOrder
      || !isIdentity(source.injectionBlockId)
      || !isIdentity(source.sourceId)
      || !isSha256(source.sourceSha256)
      || (
        source.provenance !== "frozen-capture-static-tool"
        && source.provenance !== "frozen-capture-execution-contract"
        && source.provenance !== "frozen-capture-dynamic-asset"
        && source.provenance !== "frozen-capture-runtime-binding"
      )
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        `frozen capture source order is invalid at order ${captureOrder}`,
      );
    }
    const sourceKind = source.provenance === "frozen-capture-static-tool"
      ? "legacy-body" as const
      : source.provenance === "frozen-capture-execution-contract"
        ? "execution-grammar" as const
      : source.provenance === "frozen-capture-dynamic-asset"
        ? "dynamic-assets" as const
        : "runtime-binding" as const;
    const sourceKindIdentity = sourceKind === "legacy-body"
      ? "static-tool"
      : sourceKind === "execution-grammar"
        ? "execution-contract"
      : sourceKind === "dynamic-assets"
        ? "dynamic-asset"
        : "runtime-binding";
    addSource(referenceKey(source.provenance, source.injectionBlockId, source.sourceId), {
      sourceId: qualified(["capture", source.injectionBlockId, sourceKindIdentity, source.sourceId]),
      sourceLocalId: source.sourceId,
      sourceKind,
      sourceSha256: source.sourceSha256,
      injectionBlockId: source.injectionBlockId,
      compilerFamily: null,
      compilerSurface: null,
      provenance: source.provenance,
    });
  }

  if (inventory.size === 0 || input.providerOrder.length !== inventory.size) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "trusted provider order must cover every compiler/capture source exactly once",
    );
  }
  const seen = new Set<string>();
  const orderedSources = input.providerOrder.map((reference, order) => {
    const sourceLocalId = reference.provenance === "compiled-tool-prompt-unit"
      ? reference.unitId
      : reference.sourceId;
    const source = inventory.get(referenceKey(
      reference.provenance,
      reference.injectionBlockId,
      sourceLocalId,
    ));
    if (source === undefined) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_UNKNOWN",
        `provider order references an unknown trusted source: ${sourceLocalId}`,
      );
    }
    if (seen.has(source.sourceId)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_DUPLICATE",
        `provider order repeats trusted source: ${source.sourceId}`,
      );
    }
    seen.add(source.sourceId);
    return { order, ...source };
  });
  if (seen.size !== inventory.size) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "trusted provider order omits a compiler/capture source",
    );
  }

  const sourceInventory = [...inventory.values()].sort((left, right) => (
    left.sourceId.localeCompare(right.sourceId)
  ));
  const sourceInventorySha256 = canonicalSha256(sourceInventory);
  const orderedSourceManifestSha256 = canonicalSha256(orderedSources);
  const sourceRootSha256 = canonicalSha256({
    contractId: TOKEN_CLASSIFICATION_CONTRACT.contractId,
    contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
    contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
    compilerVersion: input.compilerVersion,
    segmenterVersion: input.segmenterVersion,
    captureManifestSha256: captureManifest.canonicalSha256,
    sourceInventorySha256,
    orderedSourceManifestSha256,
  });
  const withoutSha = {
    schemaVersion: 1 as const,
    contractId: TOKEN_CLASSIFICATION_CONTRACT.contractId,
    contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
    contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
    compilerVersion: input.compilerVersion,
    segmenterVersion: input.segmenterVersion,
    captureManifestSha256: captureManifest.canonicalSha256,
    sourceInventorySha256,
    orderedSourceManifestSha256,
    sourceRootSha256,
    orderedSources,
  };
  return canonicalJsonClone({
    ...withoutSha,
    canonicalSha256: canonicalSha256(withoutSha),
  }) as unknown as TrustedTokenSourceManifest;
}

function validateClassification(input: BuildTokenLedgerInput): void {
  const classification = input.classification;
  if (
    classification === null
    || typeof classification !== "object"
    || classification.contractVersion !== TOKEN_CLASSIFICATION_CONTRACT.contractVersion
    || classification.contractSha256 !== TOKEN_CLASSIFICATION_CONTRACT.contractSha256
    || classification.compilerVersion !== TOKEN_CLASSIFICATION_CONTRACT.compilerVersion
    || classification.segmenterVersion !== TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion
  ) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_CONTRACT_MISMATCH",
      "token segments must use the frozen compiler/segmenter classification contract",
    );
  }
  const manifest = input.sourceManifest;
  if (
    manifest === null
    || typeof manifest !== "object"
    || manifest.contractId !== TOKEN_CLASSIFICATION_CONTRACT.contractId
    || manifest.contractVersion !== TOKEN_CLASSIFICATION_CONTRACT.contractVersion
    || manifest.contractSha256 !== TOKEN_CLASSIFICATION_CONTRACT.contractSha256
    || manifest.compilerVersion !== TOKEN_CLASSIFICATION_CONTRACT.compilerVersion
    || manifest.segmenterVersion !== TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion
  ) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_CONTRACT_MISMATCH",
      "source manifest must use the frozen compiler/capture classification contract",
    );
  }
  let observedManifestSha256: string | null = null;
  try {
    observedManifestSha256 = canonicalSha256(manifestWithoutSha(manifest));
  } catch {
    observedManifestSha256 = null;
  }
  if (observedManifestSha256 !== manifest.canonicalSha256) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_MANIFEST_HASH_MISMATCH",
      "source manifest canonical hash does not match its frozen contents",
    );
  }
  if (!Array.isArray(manifest.orderedSources) || manifest.orderedSources.length === 0) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "trusted source manifest must contain an ordered source inventory",
    );
  }
  const manifestSourceIds = new Set<string>();
  for (const [index, source] of manifest.orderedSources.entries()) {
    if (
      source.order !== index
      || !isIdentity(source.sourceId)
      || !isIdentity(source.sourceLocalId)
      || !isIdentity(source.injectionBlockId)
      || !isSha256(source.sourceSha256)
      || manifestSourceIds.has(source.sourceId)
      || !Object.prototype.hasOwnProperty.call(SOURCE_KIND_TO_COMPONENT, source.sourceKind)
      || (
        source.provenance === "frozen-capture-static-tool"
        && source.sourceKind !== "legacy-body"
      )
      || (
        source.provenance === "frozen-capture-execution-contract"
        && source.sourceKind !== "execution-grammar"
      )
      || (
        source.provenance === "frozen-capture-dynamic-asset"
        && source.sourceKind !== "dynamic-assets"
      )
      || (
        source.provenance === "frozen-capture-runtime-binding"
        && source.sourceKind !== "runtime-binding"
      )
      || (
        source.provenance === "compiled-tool-prompt-unit"
        && (source.compilerFamily === null || source.compilerSurface === null)
      )
      || (
        source.provenance !== "compiled-tool-prompt-unit"
        && (source.compilerFamily !== null || source.compilerSurface !== null)
      )
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        `trusted source descriptor is invalid at order ${index}`,
      );
    }
    manifestSourceIds.add(source.sourceId);
  }
  const derivedInventory = manifest.orderedSources
    .map(({ order: _order, ...source }) => source)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  if (canonicalSha256(derivedInventory) !== manifest.sourceInventorySha256) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_MANIFEST_HASH_MISMATCH",
      "trusted source inventory hash does not match its ordered descriptors",
    );
  }
  if (canonicalSha256(manifest.orderedSources) !== manifest.orderedSourceManifestSha256) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_MANIFEST_HASH_MISMATCH",
      "trusted ordered source manifest hash does not match its descriptors",
    );
  }
  const derivedSourceRootSha256 = canonicalSha256({
    contractId: manifest.contractId,
    contractVersion: manifest.contractVersion,
    contractSha256: manifest.contractSha256,
    compilerVersion: manifest.compilerVersion,
    segmenterVersion: manifest.segmenterVersion,
    captureManifestSha256: manifest.captureManifestSha256,
    sourceInventorySha256: manifest.sourceInventorySha256,
    orderedSourceManifestSha256: manifest.orderedSourceManifestSha256,
  });
  if (derivedSourceRootSha256 !== manifest.sourceRootSha256) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_MANIFEST_HASH_MISMATCH",
      "trusted source root hash does not match its frozen source hashes",
    );
  }
  const expected = input.expectedSourceAttestation;
  if (
    expected === null
    || typeof expected !== "object"
    || (expected.authority !== "campaign-integration" && expected.authority !== "synthetic-self-built")
    || !isSha256(expected.sourceInventorySha256)
    || !isSha256(expected.orderedSourceManifestSha256)
    || !isSha256(expected.sourceRootSha256)
  ) {
    throw new TokenLedgerInfrastructureError(
      "EXPECTED_SOURCE_ATTESTATION_MISSING",
      "a typed campaign/Integration source attestation is required before token accounting",
    );
  }
  if (expected.sourceInventorySha256 !== manifest.sourceInventorySha256) {
    throw new TokenLedgerInfrastructureError(
      "EXPECTED_SOURCE_INVENTORY_MISMATCH",
      "trusted source inventory does not match the campaign/Integration expectation",
    );
  }
  if (expected.orderedSourceManifestSha256 !== manifest.orderedSourceManifestSha256) {
    throw new TokenLedgerInfrastructureError(
      "EXPECTED_ORDERED_SOURCE_MANIFEST_MISMATCH",
      "trusted source order does not match the campaign/Integration expectation",
    );
  }
  if (expected.sourceRootSha256 !== manifest.sourceRootSha256) {
    throw new TokenLedgerInfrastructureError(
      "EXPECTED_SOURCE_ROOT_MISMATCH",
      "trusted source root does not match the campaign/Integration expectation",
    );
  }
  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "at least one classified source segment is required",
    );
  }

  if (input.segments.length !== manifest.orderedSources.length) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "ledger text segments must cover every trusted manifest source",
    );
  }

  const orders = input.segments.map((segment) => segment.order);
  if (
    orders.some((order) => !Number.isSafeInteger(order) || order < 0)
    || [...orders].sort((left, right) => left - right).some((order, index) => order !== index)
  ) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SEGMENT_MISSING",
      "classified source orders must form one zero-based contiguous sequence",
    );
  }
  if (orders.some((order, index) => order !== index)) {
    throw new TokenLedgerInfrastructureError(
      "CLASSIFICATION_SOURCE_REORDERED",
      "classified source segments must be supplied in provider-visible order",
    );
  }

  const seenSourceIds = new Set<string>();
  for (const [index, segment] of input.segments.entries()) {
    const trustedSource = manifest.orderedSources[index];
    if (!isIdentity(segment.sourceId) || seenSourceIds.has(segment.sourceId)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_DUPLICATE",
        "classified source identities must be non-empty and unique",
      );
    }
    seenSourceIds.add(segment.sourceId);
    if (Object.prototype.hasOwnProperty.call(segment, "sourceKind")) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        "ledger text segments cannot declare or override trusted source kinds",
      );
    }
    if (
      trustedSource === undefined
      || segment.order !== trustedSource.order
      || segment.sourceId !== trustedSource.sourceId
      || segment.sourceSha256 !== trustedSource.sourceSha256
    ) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_MANIFEST_MISMATCH",
        `ledger text segment does not match trusted source manifest at order ${index}`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(segment.sourceSha256)
      || segment.sourceSha256 !== utf8Sha256(segment.text)) {
      throw new TokenLedgerInfrastructureError(
        "CLASSIFICATION_SOURCE_HASH_MISMATCH",
        `source hash does not match classified text for ${segment.sourceId}`,
      );
    }
  }
}

export function buildTokenLedger(input: BuildTokenLedgerInput): TokenLedger {
  return buildTokenLedgerInternal(input, false);
}

/**
 * Integration-only upgrade. A campaign authority string alone is deliberately
 * insufficient: both independent provider-observer hashes are mandatory.
 */
export function buildCampaignIntegratedTokenLedger(
  input: BuildTokenLedgerInput,
): TokenLedger {
  const expected = input.expectedSourceAttestation;
  if (
    expected.authority !== "campaign-integration"
    || !isSha256(expected.frozenProviderSourceManifestSha256)
    || !isSha256(expected.providerRequestBindingSha256)
  ) {
    throw new TokenLedgerInfrastructureError(
      "EXPECTED_SOURCE_ATTESTATION_MISSING",
      "campaign Integration requires independently frozen provider-source evidence",
    );
  }
  return buildTokenLedgerInternal(input, true);
}

function buildTokenLedgerInternal(
  input: BuildTokenLedgerInput,
  campaignIntegrated: boolean,
): TokenLedger {
  if (
    !isIdentity(input.runId)
    || !isIdentity(input.variantId)
    || !isIdentity(input.tokenizer.id)
    || !isIdentity(input.tokenizer.version)
  ) {
    throw new TokenLedgerInfrastructureError(
      "IDENTITY_INVALID",
      "runId, variantId, tokenizer id, and tokenizer version must be non-empty",
    );
  }
  validateClassification(input);
  const orderedSources = input.sourceManifest.orderedSources;
  const reconstructed = input.segments.map((segment) => segment.text).join("");
  if (reconstructed !== input.providerVisibleInjection) {
    throw new TokenLedgerInfrastructureError(
      "SEGMENT_COVERAGE_MISMATCH",
      "ordered ledger segments must cover the provider-visible injection byte-for-byte",
    );
  }

  const componentText = Object.fromEntries(
    TOKEN_LEDGER_COMPONENTS.map((component) => [
      component,
      input.segments
        .filter((_segment, index) => (
          SOURCE_KIND_TO_COMPONENT[orderedSources[index].sourceKind] === component
        ))
        .map((segment) => segment.text)
        .join(""),
    ]),
  ) as Record<TokenLedgerComponent, string>;
  const toolDescriptionStatic = input.segments
    .filter((_segment, index) => {
      const component = SOURCE_KIND_TO_COMPONENT[orderedSources[index].sourceKind];
      return component === "staticTemplate" || component === "executionContract";
    })
    .map((segment) => segment.text)
    .join("");
  const total = measure(input.providerVisibleInjection, input.tokenizer);
  const staticDescription = measure(toolDescriptionStatic, input.tokenizer);
  const componentMeasurements = Object.fromEntries(
    TOKEN_LEDGER_COMPONENTS.map((component) => [component, measure(componentText[component], input.tokenizer)]),
  ) as Record<TokenLedgerComponent, TokenTextMeasurement>;
  const formalCompilerClosure: TokenLedger["classification"]["formalCompilerClosure"] =
    campaignIntegrated
      ? {
          status: "ready",
          blocker: null,
          owner: "Integration",
        }
      : {
          status: "blocked",
          blocker: input.expectedSourceAttestation.authority === "synthetic-self-built"
            ? "SELF_BUILT_SOURCE_ATTESTATION_NOT_FORMAL"
            : "FORMAL_PROVIDER_SOURCE_ATTESTATION_NOT_FINALIZED",
          owner: "Integration",
        };

  const withoutCanonicalSha = {
    schemaVersion: 2 as const,
    measurementModuleId: "M2" as const,
    variantId: input.variantId,
    runId: input.runId,
    tokenizer: { id: input.tokenizer.id, version: input.tokenizer.version },
    classification: {
      contractId: TOKEN_CLASSIFICATION_CONTRACT.contractId,
      contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
      contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
      compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
      segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
      trustedSourceManifestSha256: input.sourceManifest.canonicalSha256,
      captureManifestSha256: input.sourceManifest.captureManifestSha256,
      sourceInventorySha256: input.sourceManifest.sourceInventorySha256,
      orderedSourceManifestSha256: input.sourceManifest.orderedSourceManifestSha256,
      sourceRootSha256: input.sourceManifest.sourceRootSha256,
      expectedSourceAttestation: input.expectedSourceAttestation,
      orderedSources,
      sourceKindToComponent: SOURCE_KIND_TO_COMPONENT,
      formalCompilerClosure,
    },
    componentTokenAccounting: "independently_encoded_non_additive" as const,
    totalInjectionTokens: total.tokens,
    toolDescriptionStaticTokens: staticDescription.tokens,
    staticTemplateTokens: componentMeasurements.staticTemplate.tokens,
    executionContractTokens: componentMeasurements.executionContract.tokens,
    runtimeBindingTokens: componentMeasurements.runtimeBinding.tokens,
    dynamicAssetTokens: componentMeasurements.dynamicAsset.tokens,
    totalInjectionUtf8Bytes: total.utf8Bytes,
    toolDescriptionStaticUtf8Bytes: staticDescription.utf8Bytes,
    totalInjectionSha256: total.sha256,
    toolDescriptionStaticSha256: staticDescription.sha256,
    componentMeasurements,
  };

  return {
    ...withoutCanonicalSha,
    canonicalSha256: canonicalSha256(withoutCanonicalSha),
  };
}
