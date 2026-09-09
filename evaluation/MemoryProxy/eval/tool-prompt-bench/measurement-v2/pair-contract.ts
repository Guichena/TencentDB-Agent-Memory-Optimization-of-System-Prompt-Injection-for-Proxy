import { isDeepStrictEqual } from "node:util";
import { canonicalJsonV2, sha256CanonicalJsonV2 } from "./canonical-json.js";

export type PairSplitV2 = "dev" | "hidden";

export const PAIR_CONTRACT_SCHEMA_VERSION = "2" as const;
export const PAIR_INVARIANT_PROJECTION_SCHEMA_VERSION = "pair-invariant-projection-v2" as const;

export type PairJsonValue =
  | null
  | boolean
  | number
  | string
  | PairJsonValue[]
  | { [key: string]: PairJsonValue };

export interface PairCaseProjectionV2 {
  readonly caseId: string;
  readonly split: PairSplitV2;
  readonly comparisonDocument: PairJsonValue;
}

export interface PairContractV2 {
  readonly schemaVersion: "2";
  readonly pairId: string;
  readonly positiveCaseId: string;
  readonly negativeCaseId: string;
  readonly causalFactorId: string;
  readonly allowedChangedPointers: readonly string[];
  readonly invariantProjectionSchemaVersion: string;
  readonly invariantFieldsSha256: string;
  readonly changedPointerCount: number;
  readonly minimalityReviewStatus: "approved" | "pending" | "rejected";
  readonly independenceKey: string;
  readonly split: PairSplitV2;
}

export interface ValidatedPairContractV2 {
  readonly contract: PairContractV2;
  readonly changedPointers: readonly string[];
  readonly computedInvariantFieldsSha256: string;
}

export const FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION = "frozen-pair-identity-manifest-v2" as const;

export interface FrozenPairIdentityRecordV2 {
  readonly pairId: string;
  readonly positiveCaseId: string;
  readonly negativeCaseId: string;
  readonly independenceKey: string;
  readonly split: PairSplitV2;
  readonly pairContractSha256: string;
}

export interface FrozenPairIdentityManifestV2 {
  readonly schemaVersion: typeof FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION;
  readonly records: readonly FrozenPairIdentityRecordV2[];
  readonly canonicalSha256: string;
}

export interface FrozenPairIdentityManifestValidationErrorV2 {
  readonly code: string;
  readonly message: string;
  readonly pointer?: string;
}

export type FrozenPairIdentityManifestValidationResultV2 =
  | { readonly ok: true; readonly value: FrozenPairIdentityManifestV2 }
  | { readonly ok: false; readonly errors: readonly FrozenPairIdentityManifestValidationErrorV2[] };

export const FROZEN_PAIR_SLOT_MANIFEST_SCHEMA_VERSION = "frozen-pair-slot-evidence-manifest-v2" as const;

export interface FrozenEvidenceReferenceV2 {
  readonly rawEvidenceArtifactRef: string;
  readonly rawEvidenceArtifactSha256: string;
  readonly runId: string;
}

export interface FrozenPairRepeatEvidenceBindingV2 {
  readonly repeatId: string;
  readonly positive: FrozenEvidenceReferenceV2;
  readonly negative: FrozenEvidenceReferenceV2;
}

export interface FrozenPairSlotBuildInputV2 {
  readonly validatedPair: ValidatedPairContractV2;
  readonly repeats: readonly FrozenPairRepeatEvidenceBindingV2[];
}

export interface FrozenPairSlotV2 extends FrozenPairIdentityRecordV2 {
  readonly slotOrdinal: number;
  readonly repeats: readonly FrozenPairRepeatEvidenceBindingV2[];
}

export interface FrozenPairSlotManifestV2 {
  readonly schemaVersion: typeof FROZEN_PAIR_SLOT_MANIFEST_SCHEMA_VERSION;
  readonly frozenPairSetRevision: string;
  readonly frozenPairSetSha256: string;
  readonly split: PairSplitV2;
  readonly expectedRepeatIds: readonly string[];
  readonly slots: readonly FrozenPairSlotV2[];
  readonly canonicalSha256: string;
}

export interface FrozenPairSlotManifestValidationErrorV2 {
  readonly code: string;
  readonly message: string;
  readonly pointer?: string;
}

export type FrozenPairSlotManifestValidationResultV2 =
  | { readonly ok: true; readonly value: FrozenPairSlotManifestV2 }
  | { readonly ok: false; readonly errors: readonly FrozenPairSlotManifestValidationErrorV2[] };

export interface PairContractValidationErrorV2 {
  readonly code: string;
  readonly message: string;
  readonly pointer?: string;
}

export type PairContractValidationResultV2 =
  | { readonly ok: true; readonly value: ValidatedPairContractV2 }
  | { readonly ok: false; readonly errors: readonly PairContractValidationErrorV2[] };

const ALLOWED_DELTA = "__PAIR_ALLOWED_DELTA__";
const MISSING = Symbol("pair-contract-missing");
type PresentOrMissing = PairJsonValue | typeof MISSING;

function pointerJoin(parent: string, key: string): string {
  const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
  return `${parent}/${escaped}`;
}

function isRecord(value: PresentOrMissing): value is Record<string, PairJsonValue> {
  return value !== MISSING && value !== null && typeof value === "object" && !Array.isArray(value);
}

function changedPointers(
  positive: PresentOrMissing,
  negative: PresentOrMissing,
  pointer = "",
): string[] {
  if (positive !== MISSING && negative !== MISSING && isDeepStrictEqual(positive, negative)) return [];
  if (positive === MISSING || negative === MISSING) return [pointer || "/"];

  if (Array.isArray(positive) && Array.isArray(negative)) {
    const pointers: string[] = [];
    const length = Math.max(positive.length, negative.length);
    for (let index = 0; index < length; index += 1) {
      pointers.push(...changedPointers(
        index < positive.length ? positive[index] : MISSING,
        index < negative.length ? negative[index] : MISSING,
        pointerJoin(pointer, String(index)),
      ));
    }
    return pointers;
  }

  if (isRecord(positive) && isRecord(negative)) {
    const pointers: string[] = [];
    const keys = [...new Set([...Object.keys(positive), ...Object.keys(negative)])].sort();
    for (const key of keys) {
      pointers.push(...changedPointers(
        Object.prototype.hasOwnProperty.call(positive, key) ? positive[key] : MISSING,
        Object.prototype.hasOwnProperty.call(negative, key) ? negative[key] : MISSING,
        pointerJoin(pointer, key),
      ));
    }
    return pointers;
  }

  return [pointer || "/"];
}

function pointerCovers(allowed: string, actual: string): boolean {
  return actual === allowed || actual.startsWith(`${allowed}/`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPairSplit(value: unknown): value is PairSplitV2 {
  return value === "dev" || value === "hidden";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isJsonPointer(pointer: string): boolean {
  return /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(pointer);
}

function structuralErrors(
  contract: unknown,
  positiveCase: unknown,
  negativeCase: unknown,
): PairContractValidationErrorV2[] {
  const errors: PairContractValidationErrorV2[] = [];
  for (const [name, value] of [
    ["contract", contract],
    ["positiveCase", positiveCase],
    ["negativeCase", negativeCase],
  ] as const) {
    try {
      canonicalJsonV2(value);
    } catch {
      errors.push({
        code: "INVALID_RUNTIME_JSON",
        message: `${name} must contain only strict canonical JSON values`,
        pointer: `/${name}`,
      });
    }
  }
  if (errors.length > 0) return errors;

  const contractFields = new Set([
    "schemaVersion",
    "pairId",
    "positiveCaseId",
    "negativeCaseId",
    "causalFactorId",
    "allowedChangedPointers",
    "invariantProjectionSchemaVersion",
    "invariantFieldsSha256",
    "changedPointerCount",
    "minimalityReviewStatus",
    "independenceKey",
    "split",
  ]);
  const pairCaseFields = new Set(["caseId", "split", "comparisonDocument"]);
  if (!isPlainRecord(contract)) {
    errors.push({ code: "INVALID_CONTRACT_SHAPE", message: "contract must be an object" });
  } else {
    const unknownFields = Object.keys(contract).filter((field) => !contractFields.has(field));
    for (const field of unknownFields) {
      errors.push({
        code: "UNKNOWN_RUNTIME_FIELD",
        message: `unknown Pair Contract runtime field: ${field}`,
        pointer: `/${field}`,
      });
    }
    if (!Array.isArray(contract.allowedChangedPointers)
      || !contract.allowedChangedPointers.every((pointer) => typeof pointer === "string")) {
      errors.push({
        code: "INVALID_CONTRACT_SHAPE",
        message: "allowedChangedPointers must be a string array",
        pointer: "/allowedChangedPointers",
      });
    }
  }

  for (const [side, pairCase] of [
    ["positive", positiveCase],
    ["negative", negativeCase],
  ] as const) {
    if (!isPlainRecord(pairCase)) {
      errors.push({
        code: "INVALID_CONTRACT_SHAPE",
        message: `${side} case must contain caseId, split, and a JSON comparisonDocument`,
      });
      continue;
    }
    const unknownFields = Object.keys(pairCase).filter((field) => !pairCaseFields.has(field));
    for (const field of unknownFields) {
      errors.push({
        code: "UNKNOWN_RUNTIME_FIELD",
        message: `unknown ${side} case runtime field: ${field}`,
        pointer: `/${side}Case/${field}`,
      });
    }
    if (typeof pairCase.caseId !== "string"
      || pairCase.caseId.trim().length === 0
      || !isPairSplit(pairCase.split)
      || !Object.prototype.hasOwnProperty.call(pairCase, "comparisonDocument")) {
      errors.push({
        code: "INVALID_CONTRACT_SHAPE",
        message: `${side} case must contain caseId, split, and a JSON comparisonDocument`,
      });
    }
  }
  return errors;
}

function maskAllowed(
  positive: PresentOrMissing,
  negative: PresentOrMissing,
  allowedPointers: readonly string[],
  pointer = "",
): readonly [PairJsonValue, PairJsonValue] {
  if (allowedPointers.some((allowed) => pointerCovers(allowed, pointer))) {
    return [ALLOWED_DELTA, ALLOWED_DELTA];
  }

  if (Array.isArray(positive) && Array.isArray(negative)) {
    const positiveMasked: PairJsonValue[] = [];
    const negativeMasked: PairJsonValue[] = [];
    const length = Math.max(positive.length, negative.length);
    for (let index = 0; index < length; index += 1) {
      const [maskedPositive, maskedNegative] = maskAllowed(
        index < positive.length ? positive[index] : MISSING,
        index < negative.length ? negative[index] : MISSING,
        allowedPointers,
        pointerJoin(pointer, String(index)),
      );
      positiveMasked.push(maskedPositive);
      negativeMasked.push(maskedNegative);
    }
    return [positiveMasked, negativeMasked];
  }

  if (isRecord(positive) && isRecord(negative)) {
    // Null-prototype records preserve JSON keys such as "__proto__" as data
    // instead of invoking Object.prototype's legacy setter during projection.
    const positiveMasked = Object.create(null) as Record<string, PairJsonValue>;
    const negativeMasked = Object.create(null) as Record<string, PairJsonValue>;
    const keys = [...new Set([...Object.keys(positive), ...Object.keys(negative)])].sort();
    for (const key of keys) {
      const [maskedPositive, maskedNegative] = maskAllowed(
        Object.prototype.hasOwnProperty.call(positive, key) ? positive[key] : MISSING,
        Object.prototype.hasOwnProperty.call(negative, key) ? negative[key] : MISSING,
        allowedPointers,
        pointerJoin(pointer, key),
      );
      positiveMasked[key] = maskedPositive;
      negativeMasked[key] = maskedNegative;
    }
    return [positiveMasked, negativeMasked];
  }

  if (positive === MISSING || negative === MISSING) {
    const missingMarker = "__PAIR_INVARIANT_MISSING__";
    return [positive === MISSING ? missingMarker : positive, negative === MISSING ? missingMarker : negative];
  }

  return [positive, negative];
}

function invariantHash(schemaVersion: string, invariantFields: PairJsonValue): string {
  return sha256CanonicalJsonV2({ invariantFields, invariantProjectionSchemaVersion: schemaVersion });
}

export function computePairContractCanonicalSha256V2(contract: PairContractV2): string {
  return sha256CanonicalJsonV2(contract);
}

export function computeFrozenPairIdentityManifestSha256V2(
  records: readonly FrozenPairIdentityRecordV2[],
): string {
  return sha256CanonicalJsonV2({
    schemaVersion: FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION,
    records: [...records].sort((left, right) => (
      left.pairId < right.pairId ? -1 : left.pairId > right.pairId ? 1 : 0
    )),
  });
}

export function buildFrozenPairIdentityManifestV2(
  validatedPairs: readonly ValidatedPairContractV2[],
): FrozenPairIdentityManifestV2 {
  if (validatedPairs.length === 0) {
    throw new Error("frozen pair identity manifest requires at least one validated pair");
  }
  const records = validatedPairs
    .map(({ contract }): FrozenPairIdentityRecordV2 => ({
      pairId: contract.pairId,
      positiveCaseId: contract.positiveCaseId,
      negativeCaseId: contract.negativeCaseId,
      independenceKey: contract.independenceKey,
      split: contract.split,
      pairContractSha256: computePairContractCanonicalSha256V2(contract),
    }))
    .sort((left, right) => (
      left.pairId < right.pairId ? -1 : left.pairId > right.pairId ? 1 : 0
    ));
  if (new Set(records.map((record) => record.pairId)).size !== records.length) {
    throw new Error("frozen pair identity manifest pairId values must be unique");
  }
  return {
    schemaVersion: FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION,
    records,
    canonicalSha256: computeFrozenPairIdentityManifestSha256V2(records),
  };
}

export function validateFrozenPairIdentityManifestV2(
  input: unknown,
): FrozenPairIdentityManifestValidationResultV2 {
  if (!isPlainRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "INVALID_IDENTITY_MANIFEST_SHAPE", message: "identity manifest must be an object" }],
    };
  }
  const errors: FrozenPairIdentityManifestValidationErrorV2[] = [];
  if (input.schemaVersion !== FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION) {
    errors.push({
      code: "UNSUPPORTED_IDENTITY_MANIFEST_SCHEMA",
      message: `schemaVersion must be ${FROZEN_PAIR_IDENTITY_MANIFEST_SCHEMA_VERSION}`,
      pointer: "/schemaVersion",
    });
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    errors.push({
      code: "INVALID_IDENTITY_MANIFEST_RECORDS",
      message: "identity manifest records must be a non-empty array",
      pointer: "/records",
    });
  }
  const records = Array.isArray(input.records) ? input.records : [];
  for (const [index, record] of records.entries()) {
    if (!isPlainRecord(record)) {
      errors.push({
        code: "INVALID_IDENTITY_RECORD_SHAPE",
        message: "identity record must be an object",
        pointer: `/records/${index}`,
      });
      continue;
    }
    for (const field of [
      "pairId",
      "positiveCaseId",
      "negativeCaseId",
      "independenceKey",
    ] as const) {
      if (typeof record[field] !== "string" || record[field].trim().length === 0) {
        errors.push({
          code: "INVALID_IDENTITY_RECORD_FIELD",
          message: `${field} must be a non-blank string`,
          pointer: `/records/${index}/${field}`,
        });
      }
    }
    if (!isPairSplit(record.split)) {
      errors.push({
        code: "INVALID_IDENTITY_RECORD_SPLIT",
        message: "split must be dev or hidden",
        pointer: `/records/${index}/split`,
      });
    }
    if (typeof record.pairContractSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(record.pairContractSha256)) {
      errors.push({
        code: "INVALID_IDENTITY_RECORD_SHA256",
        message: "pairContractSha256 must be a lowercase SHA-256 digest",
        pointer: `/records/${index}/pairContractSha256`,
      });
    }
  }
  const pairIds = records
    .filter(isPlainRecord)
    .map((record) => record.pairId)
    .filter((pairId): pairId is string => typeof pairId === "string");
  if (new Set(pairIds).size !== pairIds.length) {
    errors.push({
      code: "DUPLICATE_IDENTITY_RECORD",
      message: "identity manifest pairId values must be unique",
      pointer: "/records",
    });
  }
  if (typeof input.canonicalSha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.canonicalSha256)) {
    errors.push({
      code: "INVALID_IDENTITY_MANIFEST_SHA256",
      message: "canonicalSha256 must be a lowercase SHA-256 digest",
      pointer: "/canonicalSha256",
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  const manifest = input as unknown as FrozenPairIdentityManifestV2;
  if (manifest.canonicalSha256 !== computeFrozenPairIdentityManifestSha256V2(manifest.records)) {
    return {
      ok: false,
      errors: [{
        code: "IDENTITY_MANIFEST_SHA256_MISMATCH",
        message: "canonicalSha256 does not match frozen identity records",
        pointer: "/canonicalSha256",
      }],
    };
  }
  return { ok: true, value: manifest };
}

type FrozenPairSlotManifestBodyV2 = Omit<FrozenPairSlotManifestV2, "canonicalSha256">;

export function computeFrozenPairSlotManifestSha256V2(
  body: FrozenPairSlotManifestBodyV2,
): string {
  return sha256CanonicalJsonV2(body);
}

export function buildFrozenPairSlotManifestV2(
  inputs: readonly FrozenPairSlotBuildInputV2[],
  frozenPairSet: {
    readonly revision: string;
    readonly sha256: string;
  },
): FrozenPairSlotManifestV2 {
  if (inputs.length === 0) throw new Error("frozen pair slot manifest requires at least one slot");
  if (frozenPairSet.revision.trim().length === 0 || !isSha256(frozenPairSet.sha256)) {
    throw new Error("frozen pair slot manifest requires a revision and SHA-256 frozen-set root");
  }
  const sortedInputs = [...inputs].sort((left, right) => (
    left.validatedPair.contract.pairId < right.validatedPair.contract.pairId
      ? -1
      : left.validatedPair.contract.pairId > right.validatedPair.contract.pairId ? 1 : 0
  ));
  const split = sortedInputs[0].validatedPair.contract.split;
  if (sortedInputs.some(({ validatedPair }) => validatedPair.contract.split !== split)) {
    throw new Error("frozen pair slot manifest cannot mix splits");
  }
  const expectedRepeatIds = [...new Set(
    sortedInputs[0].repeats.map((repeat) => repeat.repeatId),
  )].sort();
  if (expectedRepeatIds.length === 0) throw new Error("frozen pair slots require evidence repeats");
  const slots = sortedInputs.map(({ validatedPair, repeats }, slotOrdinal): FrozenPairSlotV2 => {
    const contract = validatedPair.contract;
    const sortedRepeats = [...repeats].sort((left, right) => (
      left.repeatId < right.repeatId ? -1 : left.repeatId > right.repeatId ? 1 : 0
    ));
    if (canonicalJsonV2(sortedRepeats.map((repeat) => repeat.repeatId)) !== canonicalJsonV2(expectedRepeatIds)) {
      throw new Error(`frozen pair slot ${contract.pairId} repeat set does not match the campaign`);
    }
    return {
      slotOrdinal,
      pairId: contract.pairId,
      positiveCaseId: contract.positiveCaseId,
      negativeCaseId: contract.negativeCaseId,
      independenceKey: contract.independenceKey,
      split: contract.split,
      pairContractSha256: computePairContractCanonicalSha256V2(contract),
      repeats: sortedRepeats,
    };
  });
  if (new Set(slots.map((slot) => slot.pairId)).size !== slots.length) {
    throw new Error("frozen pair slot pairId values must be unique");
  }
  const evidenceRefs: string[] = [];
  const evidenceShas: string[] = [];
  const runIds: string[] = [];
  for (const slot of slots) {
    for (const repeat of slot.repeats) {
      if (repeat.repeatId.trim().length === 0) throw new Error("repeatId must be non-blank");
      for (const side of [repeat.positive, repeat.negative]) {
        if (side.rawEvidenceArtifactRef.trim().length === 0
          || side.runId.trim().length === 0
          || !isSha256(side.rawEvidenceArtifactSha256)) {
          throw new Error("frozen evidence references require non-blank refs/run IDs and SHA-256 content IDs");
        }
        evidenceRefs.push(side.rawEvidenceArtifactRef);
        evidenceShas.push(side.rawEvidenceArtifactSha256);
        runIds.push(side.runId);
      }
    }
  }
  if (new Set(evidenceRefs).size !== evidenceRefs.length
    || new Set(evidenceShas).size !== evidenceShas.length
    || new Set(runIds).size !== runIds.length) {
    throw new Error("frozen pair slots must not reuse evidence refs, evidence SHA-256 values, or run IDs");
  }
  const body: FrozenPairSlotManifestBodyV2 = {
    schemaVersion: FROZEN_PAIR_SLOT_MANIFEST_SCHEMA_VERSION,
    frozenPairSetRevision: frozenPairSet.revision,
    frozenPairSetSha256: frozenPairSet.sha256,
    split,
    expectedRepeatIds,
    slots,
  };
  return { ...body, canonicalSha256: computeFrozenPairSlotManifestSha256V2(body) };
}

export function validateFrozenPairSlotManifestV2(
  input: unknown,
): FrozenPairSlotManifestValidationResultV2 {
  try {
    canonicalJsonV2(input);
  } catch {
    return {
      ok: false,
      errors: [{ code: "INVALID_SLOT_MANIFEST_JSON", message: "slot manifest must be strict JSON" }],
    };
  }
  if (!isPlainRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "INVALID_SLOT_MANIFEST_SHAPE", message: "slot manifest must be an object" }],
    };
  }
  const errors: FrozenPairSlotManifestValidationErrorV2[] = [];
  if (input.schemaVersion !== FROZEN_PAIR_SLOT_MANIFEST_SCHEMA_VERSION) {
    errors.push({ code: "UNSUPPORTED_SLOT_MANIFEST_SCHEMA", message: "unsupported slot manifest schema" });
  }
  if (typeof input.frozenPairSetRevision !== "string" || input.frozenPairSetRevision.trim().length === 0) {
    errors.push({ code: "INVALID_SLOT_MANIFEST_FREEZE", message: "frozenPairSetRevision must be non-blank" });
  }
  if (!isSha256(input.frozenPairSetSha256) || !isSha256(input.canonicalSha256)) {
    errors.push({ code: "INVALID_SLOT_MANIFEST_SHA256", message: "slot manifest hashes must be SHA-256" });
  }
  if (!isPairSplit(input.split)) {
    errors.push({ code: "INVALID_SLOT_MANIFEST_SPLIT", message: "slot manifest split must be dev or hidden" });
  }
  if (!Array.isArray(input.expectedRepeatIds)
    || input.expectedRepeatIds.length === 0
    || input.expectedRepeatIds.some((repeatId) => typeof repeatId !== "string" || repeatId.trim().length === 0)
    || new Set(input.expectedRepeatIds).size !== input.expectedRepeatIds.length) {
    errors.push({ code: "INVALID_SLOT_MANIFEST_REPEATS", message: "expectedRepeatIds must be non-empty and unique" });
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    errors.push({ code: "INVALID_SLOT_MANIFEST_SLOTS", message: "slots must be a non-empty array" });
  }
  if (errors.length > 0) return { ok: false, errors };

  const manifest = input as unknown as FrozenPairSlotManifestV2;
  const pairIds: string[] = [];
  const evidenceRefs: string[] = [];
  const evidenceShas: string[] = [];
  const runIds: string[] = [];
  for (const [slotIndex, slot] of manifest.slots.entries()) {
    if (!isPlainRecord(slot)
      || slot.slotOrdinal !== slotIndex
      || typeof slot.pairId !== "string" || slot.pairId.trim().length === 0
      || typeof slot.positiveCaseId !== "string" || slot.positiveCaseId.trim().length === 0
      || typeof slot.negativeCaseId !== "string" || slot.negativeCaseId.trim().length === 0
      || typeof slot.independenceKey !== "string" || slot.independenceKey.trim().length === 0
      || slot.split !== manifest.split
      || !isSha256(slot.pairContractSha256)
      || !Array.isArray(slot.repeats)) {
      errors.push({ code: "INVALID_PAIR_SLOT", message: `invalid frozen pair slot ${slotIndex}` });
      continue;
    }
    pairIds.push(slot.pairId);
    const repeatIds: string[] = [];
    let repeatShapesValid = true;
    for (const repeat of slot.repeats) {
      if (!isPlainRecord(repeat)
        || typeof repeat.repeatId !== "string"
        || repeat.repeatId.trim().length === 0
        || !isPlainRecord(repeat.positive)
        || !isPlainRecord(repeat.negative)) {
        errors.push({ code: "INVALID_SLOT_EVIDENCE", message: `invalid evidence in slot ${slotIndex}` });
        repeatShapesValid = false;
        continue;
      }
      repeatIds.push(repeat.repeatId);
      for (const side of [repeat.positive, repeat.negative]) {
        if (typeof side.rawEvidenceArtifactRef !== "string"
          || side.rawEvidenceArtifactRef.trim().length === 0
          || typeof side.runId !== "string" || side.runId.trim().length === 0
          || !isSha256(side.rawEvidenceArtifactSha256)) {
          errors.push({ code: "INVALID_SLOT_EVIDENCE", message: `invalid evidence in slot ${slotIndex}` });
          continue;
        }
        evidenceRefs.push(side.rawEvidenceArtifactRef);
        evidenceShas.push(side.rawEvidenceArtifactSha256);
        runIds.push(side.runId);
      }
    }
    if (repeatShapesValid
      && canonicalJsonV2([...repeatIds].sort())
        !== canonicalJsonV2([...manifest.expectedRepeatIds].sort())) {
      errors.push({ code: "SLOT_REPEAT_SET_MISMATCH", message: `slot ${slotIndex} repeat set mismatch` });
    }
  }
  if (new Set(pairIds).size !== pairIds.length) {
    errors.push({ code: "DUPLICATE_PAIR_SLOT", message: "slot pairId values must be unique" });
  }
  if (pairIds.some((pairId, index) => index > 0 && pairIds[index - 1] >= pairId)) {
    errors.push({ code: "NON_CANONICAL_SLOT_ORDER", message: "slots must be ordered by pairId" });
  }
  if (new Set(evidenceRefs).size !== evidenceRefs.length
    || new Set(evidenceShas).size !== evidenceShas.length
    || new Set(runIds).size !== runIds.length) {
    errors.push({ code: "DUPLICATE_SLOT_EVIDENCE", message: "evidence and run references must be globally unique" });
  }
  if (errors.length > 0) return { ok: false, errors };
  const { canonicalSha256, ...body } = manifest;
  if (canonicalSha256 !== computeFrozenPairSlotManifestSha256V2(body)) {
    return {
      ok: false,
      errors: [{ code: "SLOT_MANIFEST_SHA256_MISMATCH", message: "slot manifest canonical SHA mismatch" }],
    };
  }
  return { ok: true, value: manifest };
}

export function validatePairContractV2(
  contractInput: unknown,
  positiveCaseInput: unknown,
  negativeCaseInput: unknown,
): PairContractValidationResultV2 {
  const shapeErrors = structuralErrors(contractInput, positiveCaseInput, negativeCaseInput);
  if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };

  const contract = contractInput as PairContractV2;
  const positiveCase = positiveCaseInput as PairCaseProjectionV2;
  const negativeCase = negativeCaseInput as PairCaseProjectionV2;
  const errors: PairContractValidationErrorV2[] = [];
  const requiredStrings: ReadonlyArray<readonly [string, unknown]> = [
    ["pairId", contract.pairId],
    ["positiveCaseId", contract.positiveCaseId],
    ["negativeCaseId", contract.negativeCaseId],
    ["causalFactorId", contract.causalFactorId],
    ["invariantProjectionSchemaVersion", contract.invariantProjectionSchemaVersion],
    ["invariantFieldsSha256", contract.invariantFieldsSha256],
    ["independenceKey", contract.independenceKey],
  ];
  for (const [field, value] of requiredStrings) {
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push({
        code: "MISSING_REQUIRED_FIELD",
        message: `${field} must be a non-empty string`,
        pointer: `/${field}`,
      });
    }
  }
  if (contract.schemaVersion !== PAIR_CONTRACT_SCHEMA_VERSION) {
    errors.push({
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `schemaVersion must be ${PAIR_CONTRACT_SCHEMA_VERSION}`,
      pointer: "/schemaVersion",
    });
  }
  if (contract.invariantProjectionSchemaVersion !== PAIR_INVARIANT_PROJECTION_SCHEMA_VERSION) {
    errors.push({
      code: "UNSUPPORTED_INVARIANT_PROJECTION_SCHEMA",
      message: `invariantProjectionSchemaVersion must be ${PAIR_INVARIANT_PROJECTION_SCHEMA_VERSION}`,
      pointer: "/invariantProjectionSchemaVersion",
    });
  }
  if (!isPairSplit(contract.split)) {
    errors.push({ code: "INVALID_SPLIT", message: "split must be dev or hidden", pointer: "/split" });
  }
  if (!Number.isInteger(contract.changedPointerCount) || contract.changedPointerCount < 0) {
    errors.push({
      code: "INVALID_CHANGED_POINTER_COUNT",
      message: "changedPointerCount must be a non-negative integer",
      pointer: "/changedPointerCount",
    });
  }
  if (typeof contract.invariantFieldsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(contract.invariantFieldsSha256)) {
    errors.push({
      code: "INVALID_SHA256",
      message: "invariantFieldsSha256 must be a lowercase SHA-256 hex digest",
      pointer: "/invariantFieldsSha256",
    });
  }
  if (contract.allowedChangedPointers.length === 0) {
    errors.push({
      code: "EMPTY_ALLOWED_POINTERS",
      message: "allowedChangedPointers must contain the pre-registered causal delta",
      pointer: "/allowedChangedPointers",
    });
  }
  for (const pointer of contract.allowedChangedPointers) {
    if (pointer === "/") {
      errors.push({
        code: "ROOT_POINTER_NOT_ALLOWED",
        message: "the document root cannot be an allowed causal delta",
        pointer,
      });
    } else if (!isJsonPointer(pointer)) {
      errors.push({ code: "INVALID_JSON_POINTER", message: `${pointer} is not a valid JSON Pointer`, pointer });
    }
  }
  if (new Set(contract.allowedChangedPointers).size !== contract.allowedChangedPointers.length) {
    errors.push({
      code: "DUPLICATE_ALLOWED_POINTER",
      message: "allowedChangedPointers must not contain duplicates",
      pointer: "/allowedChangedPointers",
    });
  }
  for (let left = 0; left < contract.allowedChangedPointers.length; left += 1) {
    for (let right = left + 1; right < contract.allowedChangedPointers.length; right += 1) {
      const a = contract.allowedChangedPointers[left];
      const b = contract.allowedChangedPointers[right];
      if (a !== b && (pointerCovers(a, b) || pointerCovers(b, a))) {
        errors.push({
          code: "OVERLAPPING_ALLOWED_POINTERS",
          message: `${a} and ${b} overlap; freeze only the minimal pointer set`,
          pointer: "/allowedChangedPointers",
        });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const actualChangedPointers = changedPointers(
    positiveCase.comparisonDocument,
    negativeCase.comparisonDocument,
  ).sort();
  const outsideAllowlist = actualChangedPointers.filter((pointer) => (
    !contract.allowedChangedPointers.some((allowed) => pointerCovers(allowed, pointer))
  ));
  const [positiveInvariant, negativeInvariant] = maskAllowed(
    positiveCase.comparisonDocument,
    negativeCase.comparisonDocument,
    contract.allowedChangedPointers,
  );
  const computedInvariantFieldsSha256 = invariantHash(
    contract.invariantProjectionSchemaVersion,
    positiveInvariant,
  );

  if (
    contract.positiveCaseId !== positiveCase.caseId
    || contract.negativeCaseId !== negativeCase.caseId
    || positiveCase.caseId === negativeCase.caseId
  ) {
    errors.push({
      code: "CASE_ID_MISMATCH",
      message: "pair case identities must be distinct and match the compared cases",
    });
  }
  if (contract.minimalityReviewStatus !== "approved") {
    errors.push({
      code: "MINIMALITY_NOT_APPROVED",
      message: "minimalityReviewStatus must be approved",
    });
  }
  if (
    positiveCase.split !== negativeCase.split
    || contract.split !== positiveCase.split
    || contract.split !== negativeCase.split
  ) {
    errors.push({
      code: "SPLIT_MISMATCH",
      message: "both pair cases and the contract must use the same split",
    });
  }
  if (contract.changedPointerCount !== actualChangedPointers.length) {
    errors.push({
      code: "CHANGED_POINTER_COUNT_MISMATCH",
      message: `changedPointerCount=${contract.changedPointerCount} but observed ${actualChangedPointers.length}`,
    });
  }
  for (const allowed of contract.allowedChangedPointers) {
    if (!actualChangedPointers.some((actual) => pointerCovers(allowed, actual))) {
      errors.push({
        code: "UNUSED_ALLOWED_POINTER",
        message: `allowed pointer ${allowed} does not cover an observed change`,
        pointer: allowed,
      });
    }
  }
  if (outsideAllowlist.length > 0) {
    errors.push(...outsideAllowlist.map((pointer) => ({
      code: "CHANGE_OUTSIDE_ALLOWLIST",
      message: `changed pointer ${pointer} is outside allowedChangedPointers`,
      pointer,
    })));
  }
  if (!isDeepStrictEqual(positiveInvariant, negativeInvariant)) {
    errors.push({
      code: "INVARIANT_PROJECTION_MISMATCH",
      message: "positive and negative invariant projections differ",
    });
  }
  if (computedInvariantFieldsSha256 !== contract.invariantFieldsSha256) {
    errors.push({
      code: "INVARIANT_HASH_MISMATCH",
      message: "invariantFieldsSha256 does not match the computed invariant projection",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      contract,
      changedPointers: actualChangedPointers,
      computedInvariantFieldsSha256,
    },
  };
}
