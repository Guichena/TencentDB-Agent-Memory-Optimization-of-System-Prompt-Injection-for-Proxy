import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertFormalWorldContract,
  toProviderVisibleCase,
  type FormalWorldContract,
  type WorkspaceRef,
} from "../worlds/formal-schema.js";
import { canonicalSha256 as canonicalSha256V1 } from "../worlds/formal-snapshot.js";
import { canonicalSha256 } from "./canonical.js";
import type { FormalDataFreeze } from "./freeze.js";
import { loadFormalProviderSplit, type FormalReadText } from "./provider-loader.js";
import { loadFormalDatasetMetadata } from "./public-metadata.js";

export type FormalBindingSplit = "dev" | "hidden_test";

export interface FormalRuntimeIdentitySeed {
  readonly spaceId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly taskId: string;
  /** A seed only. Runners must derive a fresh session id per run/Variant/attempt. */
  readonly sessionSeed: string;
  readonly agentSource: "codex";
}

export interface FormalCaseBinding {
  readonly caseId: string;
  readonly split: FormalBindingSplit;
  readonly identity: FormalRuntimeIdentitySeed;
  readonly snapshotId: string;
  readonly workspace: WorkspaceRef;
  readonly visibleAssetSetSha256: string;
}

export interface BuildFormalCaseBindingsInput {
  readonly freeze: FormalDataFreeze;
  readonly readText?: FormalReadText;
}

export interface BuiltFormalCaseBindings {
  readonly count: 800;
  readonly splitCounts: { readonly dev: 320; readonly hiddenTest: 480 };
  readonly rows: readonly FormalCaseBinding[];
  readonly fileSha256: string;
  readonly canonicalSha256: string;
  readonly sourceHashes: {
    readonly contractCanonicalSha256: string;
    readonly providerDevCanonicalSha256: string;
    readonly providerHiddenCanonicalSha256: string;
  };
  readonly formalMetricEligible: false;
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function opaqueTransportId(
  prefix: "task" | "session",
  value: Record<string, string>,
): string {
  return `${prefix}-${canonicalSha256({
    domain: `task1.formal-runtime.${prefix}-id.v1`,
    ...value,
  }).slice(0, 32)}`;
}

export function serializeFormalCaseBindings(rows: readonly FormalCaseBinding[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

/**
 * Offline-only compiler. It may inspect the full frozen World contract, then
 * emits an exact allowlist that contains neither provider text nor private data.
 */
export function buildFormalCaseBindings(input: BuildFormalCaseBindingsInput): BuiltFormalCaseBindings {
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const metadata = loadFormalDatasetMetadata({ freeze: input.freeze, readText });
  const dev = loadFormalProviderSplit({ freeze: input.freeze, split: "dev", readText });
  const hidden = loadFormalProviderSplit({
    freeze: input.freeze,
    split: "hidden_test",
    allowHiddenTest: true,
    readText,
  });

  if (dev.count !== metadata.counts.dev || hidden.count !== metadata.counts.hiddenTest) {
    throw new Error("provider split counts do not match public dataset status");
  }
  if (dev.fileSha256 !== metadata.providerHashes.devFileSha256
    || dev.canonicalSha256 !== metadata.providerHashes.devCanonicalSha256) {
    throw new Error("dev provider hash does not match public dataset status");
  }
  if (hidden.fileSha256 !== metadata.providerHashes.hiddenFileSha256
    || hidden.canonicalSha256 !== metadata.providerHashes.hiddenCanonicalSha256) {
    throw new Error("hidden provider hash does not match public dataset status");
  }

  const contractText = readText(resolve(
    input.freeze.datasetRoot,
    "registry",
    "contracts",
    "formal-v2.json",
  ));
  const contract = JSON.parse(contractText) as FormalWorldContract;
  assertFormalWorldContract(contract);
  const contractFileSha256 = sha256Text(contractText);
  const contractCanonicalSha256 = canonicalSha256V1(contract);
  if (contractFileSha256 !== metadata.contractHashes.fileSha256
    || contractCanonicalSha256 !== metadata.contractHashes.canonicalSha256) {
    throw new Error("formal World contract hash does not match public dataset status");
  }

  const providerById = new Map(
    [...dev.cases, ...hidden.cases].map((providerCase) => [providerCase.caseId, providerCase]),
  );
  if (providerById.size !== metadata.counts.total) {
    throw new Error("provider case ids are not a 1:1 set");
  }
  const splitByTeam = new Map(contract.teams.map((team) => [team.teamId, team.split]));
  const rows = contract.publicCases.map((formalCase): FormalCaseBinding => {
    const providerCase = providerById.get(formalCase.caseId);
    if (!providerCase) throw new Error(`binding has no provider row: ${formalCase.caseId}`);
    if (!isDeepStrictEqual(providerCase, toProviderVisibleCase(formalCase))) {
      throw new Error(`provider row drift for ${formalCase.caseId}`);
    }
    providerById.delete(formalCase.caseId);
    const split = splitByTeam.get(formalCase.identity.teamId);
    if (split !== "dev" && split !== "hidden_test") {
      throw new Error(`binding has unknown split for ${formalCase.caseId}`);
    }
    return deepFreeze({
      caseId: formalCase.caseId,
      split,
      identity: {
        spaceId: formalCase.identity.spaceId,
        teamId: formalCase.identity.teamId,
        userId: formalCase.identity.userId,
        agentId: formalCase.identity.agentId,
        taskId: opaqueTransportId("task", {
          dataCommit: input.freeze.commit,
          spaceId: formalCase.identity.spaceId,
          teamId: formalCase.identity.teamId,
          sourceTaskId: formalCase.identity.taskId,
        }),
        sessionSeed: opaqueTransportId("session", {
          dataCommit: input.freeze.commit,
          caseId: formalCase.caseId,
          sourceSessionId: formalCase.identity.sessionId,
        }),
        agentSource: formalCase.identity.agentSource,
      },
      snapshotId: formalCase.snapshotId,
      workspace: structuredClone(formalCase.workspace),
      visibleAssetSetSha256: formalCase.visibleAssetSetSha256,
    });
  }).sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (providerById.size !== 0) {
    throw new Error(`provider rows without bindings: ${[...providerById.keys()].join(",")}`);
  }
  const devCount = rows.filter((row) => row.split === "dev").length;
  const hiddenCount = rows.filter((row) => row.split === "hidden_test").length;
  if (rows.length !== 800 || devCount !== 320 || hiddenCount !== 480) {
    throw new Error(`formal binding counts must be 800/320/480, got ${rows.length}/${devCount}/${hiddenCount}`);
  }
  const serialized = serializeFormalCaseBindings(rows);
  return Object.freeze({
    count: 800 as const,
    splitCounts: Object.freeze({ dev: 320 as const, hiddenTest: 480 as const }),
    rows: Object.freeze(rows),
    fileSha256: sha256Text(serialized),
    canonicalSha256: canonicalSha256(rows),
    sourceHashes: Object.freeze({
      contractCanonicalSha256,
      providerDevCanonicalSha256: dev.canonicalSha256,
      providerHiddenCanonicalSha256: hidden.canonicalSha256,
    }),
    formalMetricEligible: false as const,
  });
}
