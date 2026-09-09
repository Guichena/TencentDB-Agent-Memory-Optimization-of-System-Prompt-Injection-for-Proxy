import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { exactUtf8Sha256 } from "./canonical.js";
import type { FormalDataFreeze } from "./freeze.js";
import type { FormalReadText } from "./provider-loader.js";

export interface LoadFormalDatasetMetadataInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}

export interface FormalDatasetMetadata {
  readonly datasetContractRevision: string;
  readonly dataFreeze: {
    readonly tag: string;
    readonly tagObject: string;
    readonly commit: string;
    readonly statusTagBlob: string;
    readonly statusFileSha256: string;
  };
  readonly dataContractReady: true;
  readonly counts: {
    readonly total: number;
    readonly dev: number;
    readonly hiddenTest: number;
    readonly pairs: number;
  };
  readonly contractHashes: {
    readonly fileSha256: string;
    readonly canonicalSha256: string;
  };
  readonly snapshotHashes: {
    readonly devCanonicalSha256: string;
    readonly hiddenCanonicalSha256: string;
  };
  readonly providerHashes: {
    readonly devFileSha256: string;
    readonly devCanonicalSha256: string;
    readonly hiddenFileSha256: string;
    readonly hiddenCanonicalSha256: string;
  };
  readonly formalMetricEligible: false;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string`);
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} must be a count`);
  return value as number;
}

function hash(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${label} must be a sha256`);
  return result;
}

/** Reads the one public status file and projects only runtime freeze metadata. */
export function loadFormalDatasetMetadata(input: LoadFormalDatasetMetadataInput): FormalDatasetMetadata {
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const path = resolve(input.freeze.datasetRoot, "DATASET-BUILD-STATUS.json");
  const statusText = readText(path);
  const statusFileSha256 = exactUtf8Sha256(statusText.replace(/\r\n/gu, "\n"));
  if (statusFileSha256 !== input.freeze.statusFileSha256) {
    throw new Error("worktree dataset status does not match the frozen Tag blob");
  }
  const status = record(JSON.parse(statusText) as unknown, "dataset status");
  if (status.dataContractReady !== true) throw new Error("dataset status is not data-contract ready");
  if (status.formalMetricEligible !== false) {
    throw new Error("dataset status must remain formalMetricEligible=false before Measurement");
  }
  const counts = record(status.target_counts, "dataset status.target_counts");
  const artifacts = record(status.formal_v2_artifacts, "dataset status.formal_v2_artifacts");
  const tagEligibility = record(status.tag_eligibility, "dataset status.tag_eligibility");
  if (tagEligibility[input.freeze.tag]
    !== "approved_20_team_data_contract_input_with_verified_packaged_source_bytes") {
    throw new Error("dataset status does not approve the frozen formal-v2.1 Tag");
  }
  return Object.freeze({
    datasetContractRevision: text(status.dataset_revision, "dataset status.dataset_revision"),
    dataFreeze: Object.freeze({
      tag: input.freeze.tag,
      tagObject: input.freeze.tagObject,
      commit: input.freeze.commit,
      statusTagBlob: input.freeze.statusTagBlob,
      statusFileSha256: input.freeze.statusFileSha256,
    }),
    dataContractReady: true as const,
    counts: Object.freeze({
      total: count(counts.cases, "target_counts.cases"),
      dev: count(counts.dev_cases, "target_counts.dev_cases"),
      hiddenTest: count(counts.hidden_test_cases, "target_counts.hidden_test_cases"),
      pairs: count(counts.pairs, "target_counts.pairs"),
    }),
    contractHashes: Object.freeze({
      fileSha256: hash(artifacts.contract_file_sha256, "formal_v2_artifacts.contract_file_sha256"),
      canonicalSha256: hash(artifacts.contract_canonical_sha256, "formal_v2_artifacts.contract_canonical_sha256"),
    }),
    snapshotHashes: Object.freeze({
      devCanonicalSha256: hash(artifacts.snapshot_dev_canonical_sha256, "formal_v2_artifacts.snapshot_dev_canonical_sha256"),
      hiddenCanonicalSha256: hash(artifacts.snapshot_hidden_canonical_sha256, "formal_v2_artifacts.snapshot_hidden_canonical_sha256"),
    }),
    providerHashes: Object.freeze({
      devFileSha256: hash(artifacts.provider_dev_file_sha256, "formal_v2_artifacts.provider_dev_file_sha256"),
      devCanonicalSha256: hash(artifacts.provider_dev_canonical_sha256, "formal_v2_artifacts.provider_dev_canonical_sha256"),
      hiddenFileSha256: hash(artifacts.provider_hidden_file_sha256, "formal_v2_artifacts.provider_hidden_file_sha256"),
      hiddenCanonicalSha256: hash(artifacts.provider_hidden_canonical_sha256, "formal_v2_artifacts.provider_hidden_canonical_sha256"),
    }),
    formalMetricEligible: false as const,
  });
}
