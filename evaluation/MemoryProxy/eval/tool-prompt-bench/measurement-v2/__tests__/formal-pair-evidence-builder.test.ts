import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveFormalDataFreeze } from "../../formal-runtime/index.js";
import { loadPrivateMeasurementSplit } from "../../formal-runtime/private-loader.js";
import type { PrivateMeasurementSplitData } from "../../formal-runtime/private-loader.js";
import type { FormalWorldContract } from "../../worlds/formal-schema.js";
import { canonicalSha256 } from "../canonical-json.js";
import { buildFormalPairEvidenceV2 } from "../formal-pair-evidence-builder.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const FORMAL_CONTRACT_PATH = fileURLToPath(new URL(
  "../../formal-dataset/registry/contracts/formal-v2.json",
  import.meta.url,
));

function frozenDevInputs() {
  const freeze = resolveFormalDataFreeze({ repositoryRoot: REPOSITORY_ROOT });
  const privateMeasurement = loadPrivateMeasurementSplit({ freeze, split: "dev" });
  const formalWorld = JSON.parse(readFileSync(FORMAL_CONTRACT_PATH, "utf8")) as FormalWorldContract;
  const runs = sealedRuns(privateMeasurement, ["r01"]);
  return { formalWorld, privateMeasurement, runs };
}

function sealedRuns(
  privateMeasurement: PrivateMeasurementSplitData,
  repeatIds: readonly string[],
) {
  return privateMeasurement.gold.flatMap((gold, caseIndex) => (
    repeatIds.map((repeatId, repeatIndex) => {
      const ordinal = caseIndex * repeatIds.length + repeatIndex + 1;
      return {
        caseId: gold.caseId,
        repeatId,
        runId: `run-${gold.caseId}-${repeatId}`,
        rawEvidenceArtifactRef: `artifact://sealed/${gold.caseId}/${repeatId}/tool-trace`,
        rawEvidenceArtifactSha256: ordinal.toString(16).padStart(64, "0"),
        localStateId: `local-state-${gold.caseId}-${repeatId}`,
      };
    })
  ));
}

describe("buildFormalPairEvidenceV2", () => {
  it("builds the frozen Dev discovery Pair campaign from the complete sealed case matrix", () => {
    const input = frozenDevInputs();
    const result = buildFormalPairEvidenceV2({
      ...input,
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    });

    expect(result.campaign).toMatchObject({
      schemaVersion: "pair-summary-campaign-v2",
      split: "dev",
      variantId: "V0",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      provider: "openai",
      apiProtocol: "responses-v1",
      adapterVersion: "memory-proxy-provider-observer-v1",
      assetSnapshotSha256: "61223e7e3623f511c05ecb29faed67d577d468bfb20c14e3780b51b4621a94ab",
      expectedRepeatIds: ["r01"],
      frozenPairSetRevision: "task1-data-formal-v2.1",
      frozenPairSetSha256: input.privateMeasurement.hashes.pairCanonicalSha256,
      strictPairExactEnabled: false,
      scoringPolicySha256: "abd2448c425839fcc812f2e335acd86b1bfc22515366f40b8ae16e8e94fb7153",
    });
    expect(result.validatedPairs).toHaveLength(120);
    expect(result.campaign.expectedPairIds).toHaveLength(120);
    expect(result.campaign.frozenPairSlotManifest.slots).toHaveLength(120);
    expect(result.runEvidence).toHaveLength(320);
    expect(result.campaign.frozenPairSlotEvidenceRootSha256)
      .toBe(result.campaign.frozenPairSlotManifest.canonicalSha256);
  });

  it("rejects a missing natural coding negative from the full case by repeat matrix", () => {
    const input = frozenDevInputs();
    const pairedCaseIds = new Set(input.privateMeasurement.pairs.flatMap((pair) => [
      pair.positiveCaseId,
      pair.negativeCaseId,
    ]));
    const naturalCodingNegative = input.privateMeasurement.gold.find((gold) => (
      gold.expectation === "no-tool" && !pairedCaseIds.has(gold.caseId)
    ));
    expect(naturalCodingNegative).toBeDefined();

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      runs: input.runs.filter((run) => run.caseId !== naturalCodingNegative!.caseId),
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `missing formal case/repeat slot: ${naturalCodingNegative!.caseId}/r01`,
      "u",
    ));
  });

  it("rejects a duplicate case by repeat evidence slot", () => {
    const input = frozenDevInputs();
    const duplicate = input.runs[0];

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      runs: [...input.runs, duplicate],
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `duplicate formal case/repeat slot: ${duplicate.caseId}/r01`,
      "u",
    ));
  });

  it("rejects an unexpected repeat outside the Selection Contract matrix", () => {
    const input = frozenDevInputs();
    const source = input.runs[0];

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      runs: [...input.runs, {
        ...source,
        repeatId: "r02",
        runId: `${source.runId}-unexpected-r02`,
        rawEvidenceArtifactRef: `${source.rawEvidenceArtifactRef}-unexpected-r02`,
        rawEvidenceArtifactSha256: "f".repeat(64),
        localStateId: `${source.localStateId}-unexpected-r02`,
      }],
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `unexpected formal case/repeat slot: ${source.caseId}/r02`,
      "u",
    ));
  });

  it("binds the complete private Gold membership to the frozen formal World split", () => {
    const input = frozenDevInputs();
    const pairedCaseIds = new Set(input.privateMeasurement.pairs.flatMap((pair) => [
      pair.positiveCaseId,
      pair.negativeCaseId,
    ]));
    const removed = input.privateMeasurement.gold.find((gold) => !pairedCaseIds.has(gold.caseId));
    expect(removed).toBeDefined();
    const prunedPrivateMeasurement = {
      ...input.privateMeasurement,
      goldCount: input.privateMeasurement.goldCount - 1,
      gold: input.privateMeasurement.gold.filter((gold) => gold.caseId !== removed!.caseId),
    } as unknown as PrivateMeasurementSplitData;

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      privateMeasurement: prunedPrivateMeasurement,
      runs: input.runs.filter((run) => run.caseId !== removed!.caseId),
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `private Gold membership does not match frozen formal World: missing ${removed!.caseId}`,
      "u",
    ));
  });

  it("binds the complete private Pair membership to the frozen formal registry", () => {
    const input = frozenDevInputs();
    const removed = input.privateMeasurement.pairs[0];
    const prunedPrivateMeasurement = {
      ...input.privateMeasurement,
      pairCount: input.privateMeasurement.pairCount - 1,
      pairs: input.privateMeasurement.pairs.slice(1),
    } as unknown as PrivateMeasurementSplitData;

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      privateMeasurement: prunedPrivateMeasurement,
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `private Pair membership does not match frozen formal registry: missing ${removed.pairId}`,
      "u",
    ));
  });

  it("rejects private Pair content that is not derived from its frozen registry Pair", () => {
    const input = frozenDevInputs();
    const changed = input.privateMeasurement.pairs[0];
    const substitutedPrivateMeasurement = {
      ...input.privateMeasurement,
      pairs: [{
        ...changed,
        causalFactorId: "task1:substituted_after_the_run",
      }, ...input.privateMeasurement.pairs.slice(1)],
    } as unknown as PrivateMeasurementSplitData;

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      privateMeasurement: substitutedPrivateMeasurement,
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(new RegExp(
      `${changed.pairId}: private Pair content does not match frozen formal registry`,
      "u",
    ));
  });

  it("recomputes the private Pair root instead of trusting a post-run hash value", () => {
    const input = frozenDevInputs();
    const substitutedPrivateMeasurement = {
      ...input.privateMeasurement,
      hashes: {
        ...input.privateMeasurement.hashes,
        pairCanonicalSha256: "a".repeat(64),
      },
    } as unknown as PrivateMeasurementSplitData;

    expect(() => buildFormalPairEvidenceV2({
      ...input,
      privateMeasurement: substitutedPrivateMeasurement,
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    })).toThrowError(/private Pair canonical root does not match its frozen loader hash/u);
  });

  it("uses the frozen three-repeat policy for the authorized Hidden campaign", () => {
    const freeze = resolveFormalDataFreeze({ repositoryRoot: REPOSITORY_ROOT });
    const privateMeasurement = loadPrivateMeasurementSplit({
      freeze,
      split: "hidden_test",
      allowHiddenTest: true,
    });
    const formalWorld = JSON.parse(readFileSync(FORMAL_CONTRACT_PATH, "utf8")) as FormalWorldContract;
    const result = buildFormalPairEvidenceV2({
      privateMeasurement,
      formalWorld,
      runs: sealedRuns(privateMeasurement, ["r01", "r02", "r03"]),
      repeatStage: "hidden",
      variantId: "DEV_FROZEN_FINAL",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    });

    expect(result.campaign).toMatchObject({
      split: "hidden",
      expectedRepeatIds: ["r01", "r02", "r03"],
      expectedPairIds: expect.any(Array),
    });
    expect(result.validatedPairs).toHaveLength(180);
    expect(result.campaign.expectedPairIds).toHaveLength(180);
    expect(result.campaign.frozenPairSlotManifest.slots).toHaveLength(180);
    expect(result.runEvidence).toHaveLength(1_440);
  });

  it("produces one canonical Pair input regardless of sealed run discovery order", () => {
    const input = frozenDevInputs();
    const build = (runs: typeof input.runs) => buildFormalPairEvidenceV2({
      ...input,
      runs,
      repeatStage: "dev_discovery",
      variantId: "V0",
      apiProtocol: "responses-v1",
      executionIdentitySha256: "e".repeat(64),
    });

    expect(canonicalSha256(build([...input.runs].reverse())))
      .toBe(canonicalSha256(build(input.runs)));
  });
});
