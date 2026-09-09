import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createFormalPrepareDataSource } from "./formal-prepare-datasource.js";
import { FORMAL_EPISODE_POLICY } from "./formal-episode-policy.js";
import {
  loadFormalSmokePreregistration,
  resolveFormalDataFreeze,
} from "./formal-runtime/index.js";
import { loadPrivateMeasurementSplit } from "./formal-runtime/private-loader.js";
import {
  assertFormalWorldContract,
  type FormalWorldContract,
} from "./worlds/formal-schema.js";

export interface FormalSmokeReadinessReport {
  readonly schemaVersion: "task1.formal-smoke-readiness.v1";
  readonly ready: boolean;
  readonly datasetRevision: "formal-v2.1-repo-backed-640";
  readonly caseCount: 40;
  readonly positiveCount: number;
  readonly noToolCount: number;
  readonly skillRouteCount: number;
  readonly episodePolicy: typeof FORMAL_EPISODE_POLICY;
  readonly checks: Readonly<Record<
    "activeProjection" | "t03DvcBinding" | "t18ObservableArguments" | "skillVisibilityRoutes",
    "pass" | "fail"
  >>;
  readonly errors: readonly string[];
}

export async function inspectFormalSmokeReadiness(
  repositoryRoot: string,
): Promise<FormalSmokeReadinessReport> {
  const freeze = resolveFormalDataFreeze({ repositoryRoot });
  const source = createFormalPrepareDataSource({ freeze });
  const [status, dev] = await Promise.all([
    source.readPublicStatus(),
    source.openProviderSplit("dev"),
  ]);
  const smoke = loadFormalSmokePreregistration({ freeze });
  const measurement = loadPrivateMeasurementSplit({
    freeze,
    split: "dev",
    projection: "repo-backed-v2.1",
  });
  const contract = JSON.parse(readFileSync(resolve(
    freeze.datasetRoot,
    "registry",
    "contracts",
    "formal-v2.json",
  ), "utf8")) as FormalWorldContract;
  assertFormalWorldContract(contract);

  const errors: string[] = [];
  const casesById = new Map(dev.cases.map((item) => [item.providerRecord.caseId, item]));
  const goldById = new Map(measurement.gold.map((item) => [item.caseId, item]));
  const annotationsById = new Map(contract.privateAnnotations.map((item) => [item.caseId, item]));
  const agentsById = new Map(contract.businessAgents.map((item) => [item.agentId, item]));
  const skillsById = new Map(contract.assets.skills.map((item) => [item.assetId, item]));

  if (status.datasetRevision !== "formal-v2.1-repo-backed-640"
    || dev.cases.length !== 320
    || measurement.goldCount !== 320
    || measurement.pairCount !== 120
    || smoke.caseIds.length !== 40) {
    errors.push("active projection counts or identity are incorrect");
  }
  for (const caseId of smoke.caseIds) {
    if (!casesById.has(caseId)) errors.push(`${caseId}: absent from active provider/bindings`);
    if (!goldById.has(caseId)) errors.push(`${caseId}: absent from active Gold`);
  }

  for (const caseId of ["T03-MEM-001-P", "T03-MEM-001-N"] as const) {
    const item = casesById.get(caseId);
    const workspace = item?.binding.workspace as {
      readonly repoSlug?: string;
      readonly baseCommit?: string;
    } | undefined;
    if (workspace?.repoSlug !== "iterative/dvc"
      || workspace.baseCommit !== "a2f1367a9a75849ef6ad7ee23a5bacc18580f102") {
      errors.push(`${caseId}: DVC workspace binding is incorrect`);
    }
  }

  const t18 = goldById.get("T18-MEM-05-P");
  const t18Exact = t18?.allowedSequences[0]?.steps[0]?.arguments?.exact ?? [];
  if (t18Exact.some((predicate) => predicate.path === "time_start" || predicate.path === "time_end")
    || !t18Exact.some((predicate) => predicate.path === "type" && predicate.value === "instruction")) {
    errors.push("T18-MEM-05-P contains unobservable date predicates or lost its visible type predicate");
  }

  let skillRouteCount = 0;
  for (const caseId of smoke.caseIds) {
    const annotation = annotationsById.get(caseId);
    if (annotation?.gold.family !== "skill") continue;
    skillRouteCount += 1;
    const publicCase = contract.publicCases.find((item) => item.caseId === caseId);
    const agent = publicCase ? agentsById.get(publicCase.identity.agentId) : undefined;
    const targetId = annotation.gold.targetAssetIds[0];
    const target = targetId ? skillsById.get(targetId) : undefined;
    const firstTool = annotation.gold.allowedFirstActions[0]?.tool;
    const bound = targetId !== undefined && agent?.boundSkillIds.includes(targetId) === true;
    if (!publicCase || !agent || !target || annotation.gold.targetAssetIds.length !== 1) {
      errors.push(`${caseId}: Skill route inputs are incomplete`);
    } else if ((firstTool === "skill_view" || firstTool === "skill_view_by_id") && !bound) {
      errors.push(`${caseId}: direct Skill target is absent from the agent listing`);
    } else if (firstTool === "skill_search" && bound) {
      errors.push(`${caseId}: search target is already exposed in the agent listing`);
    } else if (firstTool !== "skill_search" && firstTool !== "skill_view" && firstTool !== "skill_view_by_id") {
      errors.push(`${caseId}: unsupported first Skill route ${String(firstTool)}`);
    }
  }
  if (skillRouteCount !== 8) errors.push(`Smoke must contain 8 Skill positives, got ${skillRouteCount}`);

  const positiveCount = smoke.caseIds.filter((caseId) => goldById.get(caseId)?.expectation === "tool").length;
  const noToolCount = smoke.caseIds.filter((caseId) => goldById.get(caseId)?.expectation === "no-tool").length;
  const check = (prefixes: readonly string[]): "pass" | "fail" => (
    errors.some((error) => prefixes.some((prefix) => error.startsWith(prefix))) ? "fail" : "pass"
  );
  return Object.freeze({
    schemaVersion: "task1.formal-smoke-readiness.v1",
    ready: errors.length === 0,
    datasetRevision: "formal-v2.1-repo-backed-640",
    caseCount: 40,
    positiveCount,
    noToolCount,
    skillRouteCount,
    episodePolicy: FORMAL_EPISODE_POLICY,
    checks: Object.freeze({
      activeProjection: check(["active projection", "Smoke must", "T01", "T02", "T03", "T04", "T11", "T12", "T17", "T18"]),
      t03DvcBinding: check(["T03-MEM-001-P: DVC", "T03-MEM-001-N: DVC"]),
      t18ObservableArguments: check(["T18-MEM-05-P contains"]),
      skillVisibilityRoutes: skillRouteCount === 8 && !errors.some((error) => error.includes("Skill"))
        ? "pass"
        : "fail",
    }),
    errors: Object.freeze(errors),
  });
}
