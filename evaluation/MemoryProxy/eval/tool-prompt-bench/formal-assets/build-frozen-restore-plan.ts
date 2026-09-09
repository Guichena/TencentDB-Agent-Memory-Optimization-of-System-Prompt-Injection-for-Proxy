import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertFormalWorldContract,
  type FormalSplit,
  type FormalWorldContract,
} from "../worlds/formal-schema.js";
import { canonicalSha256, exactUtf8Sha256 } from "../formal-runtime/canonical.js";
import { loadFormalCaseBindings } from "../formal-runtime/case-bindings.js";
import {
  FORMAL_DATA_COMMIT,
  FORMAL_DATA_TAG,
  FORMAL_DATA_TAG_OBJECT,
  resolveFormalDataFreeze,
  type FormalDataFreeze,
  type ResolveFormalDataFreezeInput,
} from "../formal-runtime/freeze.js";
import type { FormalReadText } from "../formal-runtime/provider-loader.js";
import { loadFormalDatasetMetadata } from "../formal-runtime/public-metadata.js";
import { loadFormalRuntimeFreezeManifest } from "../formal-runtime/runtime-freeze.js";
import {
  authorizeFormalAssetRestoreSelection,
  compileFormalAssetRestorePlan,
  projectFormalAssetRestoreSource,
  type FormalAssetRestorePlan,
} from "./restore-plan.js";

export interface BuildFrozenFormalAssetRestorePlanInput {
  readonly repositoryRoot: string;
  readonly split: FormalSplit;
  readonly allowHiddenTest?: true;
  readonly readText?: FormalReadText;
  readonly resolveFreeze?: (input: ResolveFormalDataFreezeInput) => FormalDataFreeze;
}

function assertResolvedFreeze(freeze: FormalDataFreeze): void {
  if (freeze.tag !== FORMAL_DATA_TAG
    || freeze.tagObject !== FORMAL_DATA_TAG_OBJECT
    || freeze.commit !== FORMAL_DATA_COMMIT
    || freeze.objectType !== "tag"
    || freeze.formalMetricEligible !== false) {
    throw new Error("resolved formal data freeze does not match task1-data-formal-v2.1");
  }
}

function normalizedFileSha256(text: string): string {
  return exactUtf8Sha256(text.replace(/\r\n/gu, "\n"));
}

/** Validate the five write-side fields actually frozen by the authoring contract. */
function assertAuthoringWritePolicy(policy: FormalWorldContract["world"]["runtimePolicy"]): void {
  if (policy.allowLlmWrite !== false
    || policy.extraction?.enabled !== false
    || !Array.isArray(policy.extraction?.extractors)
    || policy.extraction.extractors.length !== 0
    || policy.assetReflection !== false
    || policy.writeL0 !== false
    || policy.archiveWriteBack !== false) {
    throw new Error("formal-v2 authoring policy must disable every frozen write side effect");
  }
}

export function buildFrozenFormalAssetRestorePlan(
  input: BuildFrozenFormalAssetRestorePlanInput,
): FormalAssetRestorePlan {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("hidden_test formal asset restore is not authorized");
  }

  const resolveFreeze = input.resolveFreeze ?? resolveFormalDataFreeze;
  const freeze = resolveFreeze({ repositoryRoot: input.repositoryRoot, tag: FORMAL_DATA_TAG });
  assertResolvedFreeze(freeze);
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));

  const metadata = loadFormalDatasetMetadata({ freeze, readText });
  const manifest = loadFormalRuntimeFreezeManifest({ freeze, readText });
  const expectedFreeze = {
    tag: freeze.tag,
    tagObject: freeze.tagObject,
    commit: freeze.commit,
    statusTagBlob: freeze.statusTagBlob,
    statusFileSha256: freeze.statusFileSha256,
  };
  if (!isDeepStrictEqual(metadata.dataFreeze, expectedFreeze)
    || !isDeepStrictEqual(manifest.dataFreeze, expectedFreeze)
    || manifest.datasetContractRevision !== metadata.datasetContractRevision
    || !isDeepStrictEqual(manifest.sources.contract, metadata.contractHashes)
    || !isDeepStrictEqual(manifest.sources.snapshots, metadata.snapshotHashes)) {
    throw new Error("formal restore inputs do not agree on the frozen data revision");
  }

  const bindings = loadFormalCaseBindings({
    freeze,
    split: input.split,
    allowHiddenTest: input.allowHiddenTest,
    readText,
  });
  if (bindings.fileSha256 !== manifest.artifacts.caseBindings.fileSha256
    || bindings.canonicalSha256 !== manifest.artifacts.caseBindings.canonicalSha256
    || bindings.count !== (input.split === "dev" ? metadata.counts.dev : metadata.counts.hiddenTest)) {
    throw new Error("formal restore case bindings do not match the frozen runtime manifest");
  }

  const contractPath = resolve(freeze.datasetRoot, "registry", "contracts", "formal-v2.json");
  const contractText = readText(contractPath);
  if (normalizedFileSha256(contractText) !== metadata.contractHashes.fileSha256) {
    throw new Error("formal-v2 contract file hash does not match public status");
  }
  const contract = JSON.parse(contractText) as FormalWorldContract;
  if (canonicalSha256(contract) !== metadata.contractHashes.canonicalSha256) {
    throw new Error("formal-v2 contract canonical hash does not match public status");
  }
  assertFormalWorldContract(contract);
  assertAuthoringWritePolicy(contract.world.runtimePolicy);

  const snapshotId = contract.world.snapshotIds[input.split];
  const snapshot = contract.snapshots.find((candidate) => candidate.snapshotId === snapshotId);
  if (!snapshot || snapshot.split !== input.split) {
    throw new Error(`formal-v2 contract has no ${input.split} snapshot ${snapshotId}`);
  }
  const expectedSnapshotHash = input.split === "dev"
    ? metadata.snapshotHashes.devCanonicalSha256
    : metadata.snapshotHashes.hiddenCanonicalSha256;
  if (canonicalSha256(snapshot) !== expectedSnapshotHash) {
    throw new Error(`${input.split} snapshot canonical hash does not match public status`);
  }
  if (canonicalSha256(contract.world.runtimePolicy) !== snapshot.runtimePolicySha256) {
    throw new Error(`${input.split} snapshot runtime policy hash does not match the frozen contract policy`);
  }

  const selection = authorizeFormalAssetRestoreSelection({
    split: input.split,
    allowHiddenTest: input.allowHiddenTest,
  });
  const source = projectFormalAssetRestoreSource({
    selection,
    revision: {
      tag: freeze.tag,
      tagObject: freeze.tagObject,
      commit: freeze.commit,
      contractCanonicalSha256: metadata.contractHashes.canonicalSha256,
      snapshotCanonicalSha256: expectedSnapshotHash,
    },
    contract,
  });
  return compileFormalAssetRestorePlan({ selection, source, bindings: bindings.rows });
}
