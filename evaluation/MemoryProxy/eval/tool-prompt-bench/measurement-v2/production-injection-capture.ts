import type { CapturedRealChainAudit } from "../real-chain-adapter.js";
import {
  validateProductionPromptSourceManifest,
  validateProviderPromptSourceEvidence,
  type ProductionPromptSourceKind,
  type ProductionPromptSourceManifest,
  type ProviderPromptSourceEvidence,
} from "../../../../../implementations/final/MemoryProxy/src/injection/production-source.js";
import { canonicalJsonClone, canonicalSha256, utf8Sha256 } from "./canonical-json.js";
import {
  buildCampaignIntegratedTokenLedger,
  buildFrozenCaptureSourceManifest,
  buildTokenLedger,
  buildTrustedTokenSourceManifest,
  TOKEN_CLASSIFICATION_CONTRACT,
  type ExpectedTokenSourceAttestation,
  type FrozenCaptureSourceProvenance,
  type TokenLedger,
  type TokenizerSeam,
  type TrustedTokenSourceManifest,
} from "./token-ledger.js";

const OPEN_WRAPPER = "<tdai_injections>";
const CLOSE_WRAPPER = "</tdai_injections>";
export const PRODUCTION_INJECTION_SEGMENTER_VERSION =
  TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion;

export type ProductionInjectionSegmentKind = ProductionPromptSourceKind;

export interface ProductionInjectionSegmentV2 {
  readonly order: number;
  readonly kind: ProductionInjectionSegmentKind;
  readonly injectionBlockId: string;
  readonly startUtf8Byte: number;
  readonly endUtf8ByteExclusive: number;
  readonly sourceId: string;
  readonly sha256: string;
  readonly text: string;
}

export interface ProductionInjectionCaptureManifestV2 {
  readonly schemaVersion: "task1.production-injection-capture.v2";
  readonly segmenterVersion: typeof PRODUCTION_INJECTION_SEGMENTER_VERSION;
  readonly productionSourceManifestSha256: string;
  readonly providerAuditSha256: string;
  readonly providerInjectionSha256: string;
  readonly providerInjectionTokens: number;
  readonly providerInjectionUtf8Bytes: number;
  readonly segments: ReadonlyArray<Omit<ProductionInjectionSegmentV2, "text">>;
  readonly canonicalSha256: string;
}

export interface CaptureProductionInjectionV2Input {
  readonly runId: string;
  readonly variantId: string;
  readonly providerVisibleInjection: string;
  readonly providerAudit: CapturedRealChainAudit;
  /** Sealed upstream from executed ContextBlocks/PromptUnits, never inferred here. */
  readonly productionSourceManifest: ProductionPromptSourceManifest;
  readonly tokenizer: TokenizerSeam;
}

export interface ProductionInjectionCaptureV2 {
  readonly segments: readonly ProductionInjectionSegmentV2[];
  readonly manifest: ProductionInjectionCaptureManifestV2;
  readonly sourceManifest: TrustedTokenSourceManifest;
  readonly tokenLedger: TokenLedger;
}

export interface FinalizeProductionInjectionCaptureV2Input {
  readonly capture: ProductionInjectionCaptureV2;
  /** Independently frozen at the provider observer/request boundary. */
  readonly providerSourceEvidence: ProviderPromptSourceEvidence;
  readonly tokenizer: TokenizerSeam;
}

export class ProductionInjectionCaptureError extends Error {
  constructor(
    readonly code:
      | "IDENTITY_INVALID"
      | "WRAPPER_INVALID"
      | "PROVIDER_AUDIT_MISMATCH"
      | "PRODUCTION_SOURCE_MISMATCH"
      | "SEGMENT_COVERAGE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "ProductionInjectionCaptureError";
  }
}

function requireIdentity(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProductionInjectionCaptureError("IDENTITY_INVALID", `${name} must be non-empty`);
  }
}

function assertProviderAudit(
  text: string,
  audit: CapturedRealChainAudit,
  tokenizer: TokenizerSeam,
): void {
  const families: CapturedRealChainAudit["toolFamilies"] = [];
  if (/<tdai_memory_tools>|<memory-tools-guide>|<tdai_profile_memory>/u.test(text)) families.push("memory");
  if (/<skill_tools>|<available_skills>/u.test(text)) families.push("skill");
  if (/<knowledge_tools>/u.test(text)) families.push("knowledge");
  const tokens = tokenizer.count(text);
  const validAudit = audit !== null
    && typeof audit === "object"
    && audit.wrapperCount === 1
    && audit.userPromptCount === 1
    && /^[0-9a-f]{64}$/u.test(audit.userPromptSha256)
    && audit.injectionTokenEncoding === tokenizer.id
    && Number.isSafeInteger(tokens)
    && tokens >= 0
    && audit.injectionTokenCount === tokens
    && audit.injectionCharacterCount === text.length
    && audit.injectionUtf8ByteCount === Buffer.byteLength(text, "utf8")
    && audit.injectionSha256 === utf8Sha256(text)
    && audit.hasSessionContext === text.includes("<session_context>")
    && JSON.stringify(audit.toolFamilies) === JSON.stringify(families);
  if (!validAudit) {
    throw new ProductionInjectionCaptureError(
      "PROVIDER_AUDIT_MISMATCH",
      "provider audit does not bind the exact provider-visible injection and tokenizer",
    );
  }
}

function assertWrapper(text: string): void {
  if (!text.startsWith(`${OPEN_WRAPPER}\n`) || !text.endsWith(`\n${CLOSE_WRAPPER}`)) {
    throw new ProductionInjectionCaptureError(
      "WRAPPER_INVALID",
      "provider-visible injection must be one exact production TDAI wrapper",
    );
  }
  if (
    text.indexOf(OPEN_WRAPPER, OPEN_WRAPPER.length) !== -1
    || text.indexOf(CLOSE_WRAPPER) !== text.length - CLOSE_WRAPPER.length
  ) {
    throw new ProductionInjectionCaptureError(
      "WRAPPER_INVALID",
      "nested or repeated production wrappers are forbidden",
    );
  }
}

function provenanceFor(kind: ProductionInjectionSegmentKind): FrozenCaptureSourceProvenance {
  if (kind === "static-tool") return "frozen-capture-static-tool";
  if (kind === "execution-contract") return "frozen-capture-execution-contract";
  if (kind === "dynamic-asset") return "frozen-capture-dynamic-asset";
  return "frozen-capture-runtime-binding";
}

function attestationFor(
  sourceManifest: TrustedTokenSourceManifest,
  authority: ExpectedTokenSourceAttestation["authority"],
  providerEvidence?: ProviderPromptSourceEvidence,
): ExpectedTokenSourceAttestation {
  return {
    authority,
    sourceInventorySha256: sourceManifest.sourceInventorySha256,
    orderedSourceManifestSha256: sourceManifest.orderedSourceManifestSha256,
    sourceRootSha256: sourceManifest.sourceRootSha256,
    ...(providerEvidence
      ? {
          frozenProviderSourceManifestSha256: providerEvidence.sourceManifestSha256,
          providerRequestBindingSha256: providerEvidence.bindingSha256,
        }
      : {}),
  };
}

function ledgerInput(
  capture: Pick<ProductionInjectionCaptureV2, "segments" | "sourceManifest">,
  runId: string,
  variantId: string,
  tokenizer: TokenizerSeam,
  expectedSourceAttestation: ExpectedTokenSourceAttestation,
) {
  const providerVisibleInjection = capture.segments.map((segment) => segment.text).join("");
  return {
    variantId,
    runId,
    providerVisibleInjection,
    classification: {
      contractVersion: TOKEN_CLASSIFICATION_CONTRACT.contractVersion,
      contractSha256: TOKEN_CLASSIFICATION_CONTRACT.contractSha256,
      compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
      segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
    },
    sourceManifest: capture.sourceManifest,
    expectedSourceAttestation,
    segments: capture.segments.map((segment, order) => ({
      order,
      sourceId: capture.sourceManifest.orderedSources[order].sourceId,
      sourceSha256: segment.sha256,
      text: segment.text,
    })),
    tokenizer,
  };
}

export function captureProductionInjectionV2(
  input: CaptureProductionInjectionV2Input,
): ProductionInjectionCaptureV2 {
  requireIdentity("runId", input.runId);
  requireIdentity("variantId", input.variantId);
  requireIdentity("tokenizer.id", input.tokenizer?.id);
  requireIdentity("tokenizer.version", input.tokenizer?.version);
  assertWrapper(input.providerVisibleInjection);
  assertProviderAudit(input.providerVisibleInjection, input.providerAudit, input.tokenizer);

  try {
    validateProductionPromptSourceManifest(
      input.productionSourceManifest,
      input.providerVisibleInjection,
    );
  } catch (error) {
    throw new ProductionInjectionCaptureError(
      "PRODUCTION_SOURCE_MISMATCH",
      error instanceof Error ? error.message : String(error),
    );
  }

  const segments: ProductionInjectionSegmentV2[] = input.productionSourceManifest.sources.map((source) => ({
    order: source.order,
    kind: source.sourceKind,
    injectionBlockId: source.injectionBlockId,
    startUtf8Byte: source.startUtf8Byte,
    endUtf8ByteExclusive: source.endUtf8ByteExclusive,
    sourceId: source.sourceId,
    sha256: source.sourceSha256,
    text: source.text,
  }));
  if (segments.map((segment) => segment.text).join("") !== input.providerVisibleInjection) {
    throw new ProductionInjectionCaptureError(
      "SEGMENT_COVERAGE_MISMATCH",
      "production sources must reconstruct provider-visible bytes exactly",
    );
  }

  const captureManifest = buildFrozenCaptureSourceManifest({
    segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
    sources: segments.map((segment) => ({
      provenance: provenanceFor(segment.kind),
      injectionBlockId: segment.injectionBlockId,
      sourceId: segment.sourceId,
      sourceSha256: segment.sha256,
    })),
  });
  const sourceManifest = buildTrustedTokenSourceManifest({
    compilerVersion: TOKEN_CLASSIFICATION_CONTRACT.compilerVersion,
    segmenterVersion: TOKEN_CLASSIFICATION_CONTRACT.segmenterVersion,
    compiledPromptBundles: [],
    captureManifest,
    providerOrder: segments.map((segment) => ({
      provenance: provenanceFor(segment.kind),
      injectionBlockId: segment.injectionBlockId,
      sourceId: segment.sourceId,
    })),
  });
  const provisional = { segments, sourceManifest };
  const tokenLedger = buildTokenLedger(ledgerInput(
    provisional,
    input.runId,
    input.variantId,
    input.tokenizer,
    attestationFor(sourceManifest, "synthetic-self-built"),
  ));
  if (
    tokenLedger.totalInjectionSha256 !== input.providerAudit.injectionSha256
    || tokenLedger.totalInjectionTokens !== input.providerAudit.injectionTokenCount
  ) {
    throw new ProductionInjectionCaptureError(
      "PROVIDER_AUDIT_MISMATCH",
      "reconstructed TokenLedger SHA or token count differs from the provider audit",
    );
  }

  const manifestWithoutSha = {
    schemaVersion: "task1.production-injection-capture.v2" as const,
    segmenterVersion: PRODUCTION_INJECTION_SEGMENTER_VERSION,
    productionSourceManifestSha256: input.productionSourceManifest.canonicalSha256,
    providerAuditSha256: canonicalSha256(input.providerAudit),
    providerInjectionSha256: input.providerAudit.injectionSha256,
    providerInjectionTokens: input.providerAudit.injectionTokenCount,
    providerInjectionUtf8Bytes: input.providerAudit.injectionUtf8ByteCount,
    segments: segments.map(({ text: _text, ...segment }) => segment),
  };
  const manifest = canonicalJsonClone({
    ...manifestWithoutSha,
    canonicalSha256: canonicalSha256(manifestWithoutSha),
  }) as unknown as ProductionInjectionCaptureManifestV2;
  return { segments, manifest, sourceManifest, tokenLedger };
}

/** Upgrade a byte-complete capture only after independent provider evidence. */
export function finalizeProductionInjectionCaptureV2(
  input: FinalizeProductionInjectionCaptureV2Input,
): ProductionInjectionCaptureV2 {
  const providerVisibleInjection = input.capture.segments.map((segment) => segment.text).join("");
  try {
    validateProviderPromptSourceEvidence(input.providerSourceEvidence, {
      providerVisibleText: providerVisibleInjection,
    });
  } catch (error) {
    throw new ProductionInjectionCaptureError(
      "PRODUCTION_SOURCE_MISMATCH",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    input.providerSourceEvidence.sourceManifestSha256
      !== input.capture.manifest.productionSourceManifestSha256
  ) {
    throw new ProductionInjectionCaptureError(
      "PRODUCTION_SOURCE_MISMATCH",
      "provider observer source manifest differs from the captured production sources",
    );
  }
  const tokenLedger = buildCampaignIntegratedTokenLedger(ledgerInput(
    input.capture,
    input.capture.tokenLedger.runId,
    input.capture.tokenLedger.variantId,
    input.tokenizer,
    attestationFor(
      input.capture.sourceManifest,
      "campaign-integration",
      input.providerSourceEvidence,
    ),
  ));
  return { ...input.capture, tokenLedger };
}
