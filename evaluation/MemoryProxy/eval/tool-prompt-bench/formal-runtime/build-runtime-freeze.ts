import { canonicalSha256, exactUtf8Sha256 } from "./canonical.js";
import { buildFormalCaseBindings } from "./build-case-bindings.js";
import {
  buildFormalSmokePreregistration,
  serializeFormalSmokePreregistration,
} from "./build-smoke-preregistration.js";
import type { FormalDataFreeze } from "./freeze.js";
import { loadPrivateMeasurementSplit } from "./private-loader.js";
import type { FormalReadText } from "./provider-loader.js";
import { loadFormalDatasetMetadata } from "./public-metadata.js";

export interface FormalRuntimeFreezeManifest {
  readonly schemaVersion: "task1.formal-runtime-freeze.v1";
  readonly datasetContractRevision: string;
  readonly dataFreeze: {
    readonly tag: string;
    readonly tagObject: string;
    readonly commit: string;
    readonly statusTagBlob: string;
    readonly statusFileSha256: string;
  };
  readonly counts: {
    readonly total: 800;
    readonly dev: 320;
    readonly hiddenTest: 480;
  };
  readonly sources: {
    readonly contract: { readonly fileSha256: string; readonly canonicalSha256: string };
    readonly provider: {
      readonly devFileSha256: string;
      readonly devCanonicalSha256: string;
      readonly hiddenFileSha256: string;
      readonly hiddenCanonicalSha256: string;
    };
    readonly snapshots: {
      readonly devCanonicalSha256: string;
      readonly hiddenCanonicalSha256: string;
    };
  };
  readonly measurementV2: {
    readonly manifestCanonicalSha256: string;
    readonly gold: {
      readonly devCanonicalSha256: string;
      readonly hiddenCanonicalSha256: string;
      readonly fullCanonicalSha256: string;
    };
    readonly pairs: {
      readonly devCanonicalSha256: string;
      readonly hiddenCanonicalSha256: string;
      readonly fullCanonicalSha256: string;
    };
    readonly runtimeContractsCanonicalSha256: string;
  };
  readonly artifacts: {
    readonly caseBindings: {
      readonly path: "formal-runtime/frozen/case-bindings.jsonl";
      readonly count: 800;
      readonly devCount: 320;
      readonly hiddenTestCount: 480;
      readonly fileSha256: string;
      readonly canonicalSha256: string;
    };
    readonly devSmokePreregistration: {
      readonly path: "formal-runtime/frozen/dev-smoke-preregistration.json";
      readonly count: 40;
      readonly fileSha256: string;
      readonly selectionCanonicalSha256: string;
    };
  };
  readonly formalMetricEligible: false;
}

export interface BuildFormalRuntimeFreezeManifestInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}

export function buildFormalRuntimeFreezeManifest(
  input: BuildFormalRuntimeFreezeManifestInput,
): FormalRuntimeFreezeManifest {
  const metadata = loadFormalDatasetMetadata(input);
  const bindings = buildFormalCaseBindings(input);
  const smoke = buildFormalSmokePreregistration(input);
  const smokeFileSha256 = exactUtf8Sha256(serializeFormalSmokePreregistration(smoke));
  const devMeasurement = loadPrivateMeasurementSplit({
    freeze: input.freeze,
    split: "dev",
    readText: input.readText,
  });
  const hiddenMeasurement = loadPrivateMeasurementSplit({
    freeze: input.freeze,
    split: "hidden_test",
    allowHiddenTest: true,
    readText: input.readText,
  });
  if (devMeasurement.hashes.manifestCanonicalSha256 !== hiddenMeasurement.hashes.manifestCanonicalSha256) {
    throw new Error("Measurement-v2 manifest hash differs by split load");
  }
  if (devMeasurement.hashes.runtimeContractsCanonicalSha256
    !== hiddenMeasurement.hashes.runtimeContractsCanonicalSha256) {
    throw new Error("Measurement-v2 runtime contracts differ by split load");
  }

  const fullGoldCanonicalSha256 = canonicalSha256(
    [...devMeasurement.gold, ...hiddenMeasurement.gold]
      .sort((left, right) => left.caseId.localeCompare(right.caseId)),
  );
  const fullPairCanonicalSha256 = canonicalSha256(
    [...devMeasurement.pairs, ...hiddenMeasurement.pairs]
      .sort((left, right) => left.pairId.localeCompare(right.pairId)),
  );
  return Object.freeze({
    schemaVersion: "task1.formal-runtime-freeze.v1" as const,
    datasetContractRevision: metadata.datasetContractRevision,
    dataFreeze: metadata.dataFreeze,
    counts: Object.freeze({ total: 800 as const, dev: 320 as const, hiddenTest: 480 as const }),
    sources: Object.freeze({
      contract: metadata.contractHashes,
      provider: metadata.providerHashes,
      snapshots: metadata.snapshotHashes,
    }),
    measurementV2: Object.freeze({
      manifestCanonicalSha256: devMeasurement.hashes.manifestCanonicalSha256,
      gold: Object.freeze({
        devCanonicalSha256: devMeasurement.hashes.goldCanonicalSha256,
        hiddenCanonicalSha256: hiddenMeasurement.hashes.goldCanonicalSha256,
        fullCanonicalSha256: fullGoldCanonicalSha256,
      }),
      pairs: Object.freeze({
        devCanonicalSha256: devMeasurement.hashes.pairCanonicalSha256,
        hiddenCanonicalSha256: hiddenMeasurement.hashes.pairCanonicalSha256,
        fullCanonicalSha256: fullPairCanonicalSha256,
      }),
      runtimeContractsCanonicalSha256: devMeasurement.hashes.runtimeContractsCanonicalSha256,
    }),
    artifacts: Object.freeze({
      caseBindings: Object.freeze({
        path: "formal-runtime/frozen/case-bindings.jsonl" as const,
        count: 800 as const,
        devCount: 320 as const,
        hiddenTestCount: 480 as const,
        fileSha256: bindings.fileSha256,
        canonicalSha256: bindings.canonicalSha256,
      }),
      devSmokePreregistration: Object.freeze({
        path: "formal-runtime/frozen/dev-smoke-preregistration.json" as const,
        count: 40 as const,
        fileSha256: smokeFileSha256,
        selectionCanonicalSha256: smoke.sha256,
      }),
    }),
    formalMetricEligible: false as const,
  });
}

export function serializeFormalRuntimeFreezeManifest(manifest: FormalRuntimeFreezeManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
