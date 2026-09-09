import { isDeepStrictEqual } from "node:util";

import {
  canonicalSha256,
  loadFormalDatasetMetadata,
  loadFormalRuntimeFreezeManifest,
  loadFormalSmokePreregistration,
  loadRepoBackedSelection,
  openFormalProviderSplit,
  type FormalDataFreeze,
  type FormalDatasetMetadata,
  type FormalReadText,
  type FormalRuntimeFreezeManifest,
  type RepoBackedSelection,
} from "./formal-runtime/index.js";
import type {
  FormalPrepareDataSource,
  FormalPreparePublicStatus,
  FormalSplit,
} from "./formal-prepare-runner.js";
import {
  REPO_BACKED_COUNTS,
  REPO_BACKED_DATASET_REVISION,
} from "./formal-runtime/repo-backed-selection.js";

export interface CreateFormalPrepareDataSourceInput {
  readonly freeze: FormalDataFreeze;
  /** Read seam for no-I/O ordering tests; production leaves it undefined. */
  readonly readText?: FormalReadText;
}

interface PublicFreezeContext {
  readonly metadata: FormalDatasetMetadata;
  readonly manifest: FormalRuntimeFreezeManifest;
  readonly smokeCaseIds: readonly string[];
  readonly selection: RepoBackedSelection;
}

function assertPublicFreeze(
  metadata: FormalDatasetMetadata,
  manifest: FormalRuntimeFreezeManifest,
): void {
  if (!isDeepStrictEqual(manifest.dataFreeze, metadata.dataFreeze)
    || manifest.datasetContractRevision !== metadata.datasetContractRevision
    || !isDeepStrictEqual(manifest.sources.contract, metadata.contractHashes)
    || !isDeepStrictEqual(manifest.sources.provider, metadata.providerHashes)
    || !isDeepStrictEqual(manifest.sources.snapshots, metadata.snapshotHashes)) {
    throw new Error("formal public runtime freeze does not match the corrected data Tag/status");
  }
}

/**
 * Adapts R02-B's public, Gold-blind loaders to the PrepareOnly deep module.
 * Its dependency graph has no private loader. Hidden authorization remains an
 * explicit per-open capability and is forwarded unchanged to both B loaders.
 */
export function createFormalPrepareDataSource(
  input: CreateFormalPrepareDataSourceInput,
): FormalPrepareDataSource {
  let cached: PublicFreezeContext | undefined;

  const publicFreeze = (): PublicFreezeContext => {
    if (cached) return cached;
    const metadata = loadFormalDatasetMetadata({ freeze: input.freeze, readText: input.readText });
    const manifest = loadFormalRuntimeFreezeManifest({ freeze: input.freeze, readText: input.readText });
    assertPublicFreeze(metadata, manifest);
    const smoke = loadFormalSmokePreregistration({ freeze: input.freeze, readText: input.readText });
    const selection = loadRepoBackedSelection({
      datasetRoot: input.freeze.datasetRoot,
      readText: input.readText,
    });
    if (smoke.sha256 !== manifest.artifacts.devSmokePreregistration.selectionCanonicalSha256) {
      throw new Error("formal smoke preregistration does not match runtime freeze manifest");
    }
    cached = Object.freeze({ metadata, manifest, smokeCaseIds: smoke.caseIds, selection });
    return cached;
  };

  return Object.freeze({
    async readPublicStatus(): Promise<FormalPreparePublicStatus> {
      const { metadata, smokeCaseIds, selection } = publicFreeze();
      return Object.freeze({
        datasetRevision: REPO_BACKED_DATASET_REVISION,
        datasetTag: input.freeze.tag,
        datasetTagObject: input.freeze.tagObject,
        datasetCommit: input.freeze.commit,
        contractSha256: metadata.contractHashes.canonicalSha256,
        preregisteredSmokeCaseIds: smokeCaseIds,
        splits: Object.freeze({
          dev: Object.freeze({
            expectedCaseCount: REPO_BACKED_COUNTS.dev,
            providerInputSha256: selection.files["provider-dev"].activeFileSha256,
            privateGoldSha256: selection.files["gold-dev"].activeFileSha256,
            privateGoldHashScope: "repo-backed-v2.1-file" as const,
            pairContractSha256: selection.files["pairs-dev"].activeFileSha256,
            pairContractHashScope: "repo-backed-v2.1-file" as const,
            snapshotSha256: metadata.snapshotHashes.devCanonicalSha256,
          }),
          hidden_test: Object.freeze({
            expectedCaseCount: REPO_BACKED_COUNTS.hiddenTest,
            providerInputSha256: selection.files["provider-hidden"].activeFileSha256,
            privateGoldSha256: selection.files["gold-hidden"].activeFileSha256,
            privateGoldHashScope: "repo-backed-v2.1-file" as const,
            pairContractSha256: selection.files["pairs-hidden"].activeFileSha256,
            pairContractHashScope: "repo-backed-v2.1-file" as const,
            snapshotSha256: metadata.snapshotHashes.hiddenCanonicalSha256,
          }),
        }),
        formalMetricEligible: false as const,
      });
    },

    async openProviderSplit(
      split: FormalSplit,
      options?: { readonly allowHiddenTest?: true },
    ) {
      if (split === "hidden_test" && options?.allowHiddenTest !== true) {
        throw new Error("hidden_test Prepare datasource access is not authorized");
      }
      const { selection } = publicFreeze();
      const loaded = openFormalProviderSplit({
        freeze: input.freeze,
        split,
        allowHiddenTest: options?.allowHiddenTest,
        readText: input.readText,
        projection: "repo-backed-v2.1",
      });
      const cases = loaded.cases
        .map((item) => Object.freeze({
          split: item.binding.split as FormalSplit,
          providerRecord: item.provider,
          binding: item.binding,
        }));
      return Object.freeze({
        cases: Object.freeze(cases),
        caseBindingsFileSha256: selection.files["case-bindings"].activeFileSha256,
      });
    },

    canonicalProviderInputSha256(value: unknown): string {
      return canonicalSha256(value);
    },
  });
}
