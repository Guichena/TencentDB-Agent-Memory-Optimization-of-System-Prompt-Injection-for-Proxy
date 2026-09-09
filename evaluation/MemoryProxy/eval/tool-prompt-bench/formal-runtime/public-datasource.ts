import { isDeepStrictEqual } from "node:util";

import type { ProviderVisibleCase } from "../worlds/formal-schema.js";
import { loadFormalCaseBindings, type FormalCaseBindingSplitData } from "./case-bindings.js";
import type { FormalCaseBinding } from "./build-case-bindings.js";
import type { FormalDataFreeze } from "./freeze.js";
import {
  loadFormalProviderSplit,
  type FormalProviderSplit,
  type FormalReadText,
} from "./provider-loader.js";
import { loadFormalDatasetMetadata } from "./public-metadata.js";
import { loadFormalRuntimeFreezeManifest } from "./runtime-freeze.js";
import { REPO_BACKED_DATASET_REVISION } from "./repo-backed-selection.js";

export interface OpenFormalProviderSplitInput {
  readonly freeze: FormalDataFreeze;
  readonly split: FormalProviderSplit;
  readonly allowHiddenTest?: true;
  readonly readText?: FormalReadText;
  readonly projection?: "repo-backed-v2.1";
}

export interface FormalProviderRuntimeCase {
  readonly provider: ProviderVisibleCase;
  readonly binding: FormalCaseBinding;
}

export interface FormalPublicDatasourceSplit {
  readonly split: FormalProviderSplit;
  readonly count: number;
  readonly datasetContractRevision: string;
  readonly snapshotCanonicalSha256: string;
  readonly measurementV2GoldCanonicalSha256: string;
  readonly measurementV2PairCanonicalSha256: string;
  readonly runtimeContractsCanonicalSha256: string;
  readonly caseBindingsCanonicalSha256: string;
  readonly cases: readonly FormalProviderRuntimeCase[];
  readonly formalMetricEligible: false;
}

function assertBindingFreeze(
  bindings: FormalCaseBindingSplitData,
  expected: { readonly fileSha256: string; readonly canonicalSha256: string },
): void {
  if (bindings.fileSha256 !== expected.fileSha256
    || bindings.canonicalSha256 !== expected.canonicalSha256) {
    throw new Error("worktree case bindings do not match runtime freeze manifest");
  }
}

function assertProviderFreeze(
  provider: { readonly fileSha256: string; readonly canonicalSha256: string },
  expected: { readonly fileSha256: string; readonly canonicalSha256: string },
): void {
  if (provider.fileSha256 !== expected.fileSha256
    || provider.canonicalSha256 !== expected.canonicalSha256) {
    throw new Error("worktree provider split does not match runtime freeze manifest");
  }
}

/**
 * Gold-blind public datasource used by PrepareOnly runners. Hidden access is
 * rejected before status, manifest, provider, or binding readers are called.
 */
export function openFormalProviderSplit(input: OpenFormalProviderSplitInput): FormalPublicDatasourceSplit {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("hidden_test public datasource access is not authorized");
  }
  const metadata = loadFormalDatasetMetadata({ freeze: input.freeze, readText: input.readText });
  const manifest = loadFormalRuntimeFreezeManifest({ freeze: input.freeze, readText: input.readText });
  if (!isDeepStrictEqual(manifest.dataFreeze, metadata.dataFreeze)
    || manifest.datasetContractRevision !== metadata.datasetContractRevision
    || !isDeepStrictEqual(manifest.sources.contract, metadata.contractHashes)
    || !isDeepStrictEqual(manifest.sources.provider, metadata.providerHashes)
    || !isDeepStrictEqual(manifest.sources.snapshots, metadata.snapshotHashes)) {
    throw new Error("runtime freeze manifest does not match public dataset status");
  }
  const provider = loadFormalProviderSplit({
    freeze: input.freeze,
    split: input.split,
    allowHiddenTest: input.allowHiddenTest,
    readText: input.readText,
    projection: input.projection,
  });
  const bindings = loadFormalCaseBindings({
    freeze: input.freeze,
    split: input.split,
    allowHiddenTest: input.allowHiddenTest,
    readText: input.readText,
    projection: input.projection,
  });
  if (input.projection !== "repo-backed-v2.1") {
    assertProviderFreeze(provider, input.split === "dev"
      ? {
        fileSha256: manifest.sources.provider.devFileSha256,
        canonicalSha256: manifest.sources.provider.devCanonicalSha256,
      }
      : {
        fileSha256: manifest.sources.provider.hiddenFileSha256,
        canonicalSha256: manifest.sources.provider.hiddenCanonicalSha256,
      });
    assertBindingFreeze(bindings, manifest.artifacts.caseBindings);
  }

  const bindingById = new Map(bindings.rows.map((binding) => [binding.caseId, binding]));
  const cases = provider.cases.map((providerCase): FormalProviderRuntimeCase => {
    const binding = bindingById.get(providerCase.caseId);
    if (!binding) throw new Error(`provider case has no runtime binding: ${providerCase.caseId}`);
    bindingById.delete(providerCase.caseId);
    return Object.freeze({ provider: providerCase, binding });
  });
  if (bindingById.size !== 0 || cases.length !== provider.count || cases.length !== bindings.count) {
    throw new Error("provider and runtime bindings are not a 1:1 caseId join");
  }
  const dev = input.split === "dev";
  return Object.freeze({
    split: input.split,
    count: cases.length,
    datasetContractRevision: input.projection === "repo-backed-v2.1"
      ? REPO_BACKED_DATASET_REVISION
      : metadata.datasetContractRevision,
    snapshotCanonicalSha256: dev
      ? manifest.sources.snapshots.devCanonicalSha256
      : manifest.sources.snapshots.hiddenCanonicalSha256,
    measurementV2GoldCanonicalSha256: dev
      ? manifest.measurementV2.gold.devCanonicalSha256
      : manifest.measurementV2.gold.hiddenCanonicalSha256,
    measurementV2PairCanonicalSha256: dev
      ? manifest.measurementV2.pairs.devCanonicalSha256
      : manifest.measurementV2.pairs.hiddenCanonicalSha256,
    runtimeContractsCanonicalSha256: manifest.measurementV2.runtimeContractsCanonicalSha256,
    caseBindingsCanonicalSha256: bindings.canonicalSha256,
    cases: Object.freeze(cases),
    formalMetricEligible: false as const,
  });
}
