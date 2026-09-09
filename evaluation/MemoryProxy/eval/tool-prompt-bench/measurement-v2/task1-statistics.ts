// D1a 统计纯函数：比例区间、配对差值与 McNemar 不一致计数、cluster bootstrap、
// Team Macro、基础设施缺失保守界。
// 只消费调用方提供的合成二元结果与 ID：不猜测 CALL/NO_CALL，不重新评分，不含 CLI。
// 规范依据：指标规范 §15/§18/§20（TASK1-METRICS-EXPERIMENT-RECORDING-GUIDE.md）与
// D1 设计“统计实现”（06_D1_正式评分与统计报告.md）。

export const FROZEN_STATISTICS_SEED = 20260905;
export const FROZEN_BOOTSTRAP_REPLICATES = 10000;
export const FROZEN_CONFIDENCE_LEVEL = 0.95;

/** 双侧 95% 置信水平对应的标准正态分位数 z_{0.975}。 */
export const Z_95_TWO_SIDED = 1.959963984540054;

/** 少 cluster 警示阈值。模块默认值，非规范强制值，报告需按实际 cluster 数说明。 */
export const MIN_RELIABLE_CLUSTERS = 8;
/** 配对差值小样本警示阈值。模块默认值，非规范强制值。 */
export const SMALL_SAMPLE_MIN_PAIRED_CASES = 30;

export const PERCENTILE_INTERVAL_METHOD_V2 = "percentile_linear_interpolation" as const;

export const WILSON_INTERPRETATION_V2 =
  "Wilson 95% 仅为描述性区间；它不消除、不校正 Team/来源聚类带来的样本相关性，不构成任何非劣或等效结论。";

export const TEAM_INDEPENDENCE_CAVEAT_V2 =
  "共享相邻 Team 资产窗口使 Team 之间存在依赖，cluster bootstrap 区间是条件性区间，不能声称各 Team 完全独立或独立性已得到保证。";

export const SOURCE_CLUSTER_SENSITIVITY_NOTE_V2 =
  "repo/source 连通 cluster 重采样只是预注册的敏感性分析，不得替代主口径，也不得依据其结果回改主口径。";

export const FCR_DIRECTION_NOTE_V2 =
  "差值方向固定 V4-V0，作用于 successDefinition 定义的“成功”指示。FCR 等越小越好的指标必须先取反为“无误调用成功”再计算，报告 FCR 差值时用 fcrDifferenceFromNoFalseCallSuccessDifference 取相反数回转，不得偷换报告方向。";

export const MISSING_BOUNDS_NOTE_V2 =
  "保守缺失敏感性界限：未知事件按全部失败（下界）与全部成功（上界）赋值；这不是统计置信区间，不能用于显著性或非劣推断。";

export const NON_INFERIORITY_NOTE_V2 =
  "非劣结论必须由 Test 前冻结的界值与区间共同支持；p>0.05 不能转成“已证明非劣”，零 discordance、少 cluster 或小样本也不能自动通过。";

export const NO_BEST_OF_N_NOTE_V2 =
  "重复聚合规则必须预先冻结，禁止 best-of-N；本模块不做任何重复结果挑选。";

export interface StatisticsConfigV2 {
  readonly seed: number;
  readonly bootstrapReplicates: number;
  readonly confidenceLevel: number;
}

export const FROZEN_STATISTICS_CONFIG_V2: StatisticsConfigV2 = {
  seed: FROZEN_STATISTICS_SEED,
  bootstrapReplicates: FROZEN_BOOTSTRAP_REPLICATES,
  confidenceLevel: FROZEN_CONFIDENCE_LEVEL,
};

export function validateStatisticsConfig(config: StatisticsConfigV2): StatisticsConfigV2 {
  if (config.seed !== FROZEN_STATISTICS_SEED) {
    throw new RangeError(
      `statistics seed is frozen at ${FROZEN_STATISTICS_SEED}, got ${String(config.seed)}`,
    );
  }
  if (config.bootstrapReplicates !== FROZEN_BOOTSTRAP_REPLICATES) {
    throw new RangeError(
      `bootstrapReplicates is frozen at ${FROZEN_BOOTSTRAP_REPLICATES}, got ${String(config.bootstrapReplicates)}`,
    );
  }
  if (config.confidenceLevel !== FROZEN_CONFIDENCE_LEVEL) {
    throw new RangeError(
      `confidenceLevel is frozen at ${FROZEN_CONFIDENCE_LEVEL}, got ${String(config.confidenceLevel)}`,
    );
  }
  return config;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, got ${String(value)}`);
  }
}

function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
}

function assertUniqueCaseIds(caseIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const caseId of caseIds) {
    assertNonEmptyString(caseId, "caseId");
    if (seen.has(caseId)) {
      throw new RangeError(`duplicate paired caseId: ${caseId}`);
    }
    seen.add(caseId);
  }
}

export interface WilsonIntervalV2 {
  readonly lower: number;
  readonly upper: number;
}

export interface RatioWithWilson95V2 {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
  readonly wilson95: WilsonIntervalV2 | null;
  readonly status: "observed" | "not_applicable_zero_denominator";
  readonly interpretation: string;
}

export function ratioWithWilson95(numerator: number, denominator: number): RatioWithWilson95V2 {
  assertNonNegativeInteger(numerator, "numerator");
  assertNonNegativeInteger(denominator, "denominator");
  if (numerator > denominator) {
    throw new RangeError(`numerator ${numerator} must not exceed denominator ${denominator}`);
  }
  if (denominator === 0) {
    return {
      numerator,
      denominator,
      value: null,
      wilson95: null,
      status: "not_applicable_zero_denominator",
      interpretation: WILSON_INTERPRETATION_V2,
    };
  }
  const p = numerator / denominator;
  const z2 = Z_95_TWO_SIDED * Z_95_TWO_SIDED;
  const denominatorTerm = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / denominatorTerm;
  const half =
    (Z_95_TWO_SIDED *
      Math.sqrt((p * (1 - p)) / denominator + z2 / (4 * denominator * denominator))) /
    denominatorTerm;
  // k=n 时上界、k=0 时下界在数学上恰为 1/0；仅回贴 1e-12 以内的浮点噪声。
  const boundarySnapEpsilon = 1e-12;
  const rawLower = Math.max(0, center - half);
  const rawUpper = Math.min(1, center + half);
  return {
    numerator,
    denominator,
    value: p,
    wilson95: {
      lower: rawLower < boundarySnapEpsilon ? 0 : rawLower,
      upper: rawUpper > 1 - boundarySnapEpsilon ? 1 : rawUpper,
    },
    status: "observed",
    interpretation: WILSON_INTERPRETATION_V2,
  };
}

export interface VariantBinaryOutcomeV2 {
  readonly caseId: string;
  /** 该 Variant 上此 Case 的二元结果；true 表示 successDefinition 定义下的“成功”。 */
  readonly success: boolean;
}

export interface PairedBinaryCaseV2 {
  readonly caseId: string;
  /** true 表示 V0 侧在该 Case 上“成功”（按 successDefinition）。 */
  readonly v0: boolean;
  /** true 表示 V4 侧在该 Case 上“成功”（按 successDefinition）。 */
  readonly v4: boolean;
}

export interface PairedIntersectionV2 {
  readonly pairs: readonly PairedBinaryCaseV2[];
  readonly v0OnlyCaseIds: readonly string[];
  readonly v4OnlyCaseIds: readonly string[];
}

/** 按同 Case 交集配对两 Variant 的二元结果；单侧独有 Case 不进入配对，另行列出。 */
export function intersectPairedBinaryCases(
  v0: readonly VariantBinaryOutcomeV2[],
  v4: readonly VariantBinaryOutcomeV2[],
): PairedIntersectionV2 {
  assertUniqueCaseIds(v0.map((outcome) => outcome.caseId));
  assertUniqueCaseIds(v4.map((outcome) => outcome.caseId));
  const v4ByCaseId = new Map(v4.map((outcome) => [outcome.caseId, outcome.success]));
  const v4Seen = new Set<string>();
  const pairs: PairedBinaryCaseV2[] = [];
  const v4OnlyCaseIds: string[] = [];
  const v0OnlyCaseIds: string[] = [];
  for (const outcome of v0) {
    const v4Success = v4ByCaseId.get(outcome.caseId);
    if (v4Success === undefined) {
      v0OnlyCaseIds.push(outcome.caseId);
    } else {
      pairs.push({ caseId: outcome.caseId, v0: outcome.success, v4: v4Success });
      v4Seen.add(outcome.caseId);
    }
  }
  for (const outcome of v4) {
    if (!v4Seen.has(outcome.caseId)) {
      v4OnlyCaseIds.push(outcome.caseId);
    }
  }
  return { pairs, v0OnlyCaseIds, v4OnlyCaseIds };
}

export interface PairedDifferenceInputV2 {
  readonly pairs: readonly PairedBinaryCaseV2[];
  readonly metricId: string;
  /** “成功”的定义，例如 ECR 触发成功、TSR 首动作正确、或 FCR 取反后的“无误调用”。 */
  readonly successDefinition: string;
  /** Test 前冻结的非劣界值；未冻结时必须传 null，不得事后补。 */
  readonly nonInferiorityMargin: number | null;
}

export type PairedDifferenceStatusV2 =
  | "no_paired_cases"
  | "zero_discordance"
  | "small_paired_sample";

export interface PairedDifferenceResultV2 {
  readonly metricId: string;
  readonly successDefinition: string;
  readonly direction: "v4_minus_v0";
  readonly pairedCaseCount: number;
  readonly v0SuccessCount: number;
  readonly v4SuccessCount: number;
  readonly v0Rate: number | null;
  readonly v4Rate: number | null;
  /** 成功指示尺度上的 V4 率 − V0 率；配对数为 0 时为 null。 */
  readonly value: number | null;
  readonly concordantBothSuccess: number;
  readonly concordantBothFail: number;
  /** McNemar b：V0 失败 / V4 成功。 */
  readonly discordantV0FailV4Pass: number;
  /** McNemar c：V0 成功 / V4 失败。 */
  readonly discordantV0PassV4Fail: number;
  readonly discordantTotal: number;
  readonly mcnemarExactTwoSidedP: number | null;
  readonly nonInferiorityStatus: "no_margin_prespecified" | "margin_prespecified";
  readonly nonInferiorityNote: string;
  readonly statuses: readonly PairedDifferenceStatusV2[];
  readonly notes: readonly string[];
}

/** 精确 McNemar 双侧 p 值：m=b+c，p=min(1, 2·P(X≤min(b,c)))，X~Binom(m, 0.5)。 */
function mcnemarExactTwoSidedPValue(b: number, c: number): number | null {
  const m = b + c;
  if (m === 0) {
    return null;
  }
  let term = Math.pow(0.5, m);
  let tail = term;
  const minCount = Math.min(b, c);
  for (let i = 1; i <= minCount; i += 1) {
    term = (term * (m - i + 1)) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

export function pairedDifferenceV4MinusV0(input: PairedDifferenceInputV2): PairedDifferenceResultV2 {
  assertNonEmptyString(input.metricId, "metricId");
  assertNonEmptyString(input.successDefinition, "successDefinition");
  assertUniqueCaseIds(input.pairs.map((pair) => pair.caseId));
  if (
    input.nonInferiorityMargin !== null &&
    (!Number.isFinite(input.nonInferiorityMargin) || input.nonInferiorityMargin < 0)
  ) {
    throw new RangeError(
      `nonInferiorityMargin must be null or a finite non-negative number, got ${String(input.nonInferiorityMargin)}`,
    );
  }
  const pairs = input.pairs;
  const n = pairs.length;
  let v0SuccessCount = 0;
  let v4SuccessCount = 0;
  let concordantBothSuccess = 0;
  let concordantBothFail = 0;
  let discordantB = 0;
  let discordantC = 0;
  for (const pair of pairs) {
    if (pair.v0) v0SuccessCount += 1;
    if (pair.v4) v4SuccessCount += 1;
    if (pair.v0 && pair.v4) concordantBothSuccess += 1;
    else if (!pair.v0 && !pair.v4) concordantBothFail += 1;
    else if (!pair.v0 && pair.v4) discordantB += 1;
    else discordantC += 1;
  }
  const value = n === 0 ? null : (v4SuccessCount - v0SuccessCount) / n;
  const statuses: PairedDifferenceStatusV2[] = [];
  if (n === 0) {
    statuses.push("no_paired_cases");
  }
  if (n > 0 && discordantB + discordantC === 0) {
    statuses.push("zero_discordance");
  }
  if (n > 0 && n < SMALL_SAMPLE_MIN_PAIRED_CASES) {
    statuses.push("small_paired_sample");
  }
  const notes: string[] = [FCR_DIRECTION_NOTE_V2, NON_INFERIORITY_NOTE_V2];
  if (statuses.includes("zero_discordance")) {
    notes.push(
      "McNemar 无不一致对（b=c=0）：检验没有可依据的证据，不能据此宣称等价、非劣或无差异。",
    );
  }
  if (statuses.includes("small_paired_sample")) {
    notes.push(
      `配对样本量 ${n} 低于模块小样本警示阈值 ${SMALL_SAMPLE_MIN_PAIRED_CASES}，差值与 p 值仅作描述。`,
    );
  }
  return {
    metricId: input.metricId,
    successDefinition: input.successDefinition,
    direction: "v4_minus_v0",
    pairedCaseCount: n,
    v0SuccessCount,
    v4SuccessCount,
    v0Rate: n === 0 ? null : v0SuccessCount / n,
    v4Rate: n === 0 ? null : v4SuccessCount / n,
    value,
    concordantBothSuccess,
    concordantBothFail,
    discordantV0FailV4Pass: discordantB,
    discordantV0PassV4Fail: discordantC,
    discordantTotal: discordantB + discordantC,
    mcnemarExactTwoSidedP: mcnemarExactTwoSidedPValue(discordantB, discordantC),
    nonInferiorityStatus:
      input.nonInferiorityMargin === null ? "no_margin_prespecified" : "margin_prespecified",
    nonInferiorityNote: NON_INFERIORITY_NOTE_V2,
    statuses,
    notes,
  };
}

/**
 * 把“无误调用成功”尺度上的差值回转为 FCR 尺度（误调用率差值，V4-V0，越小越好）。
 * 输入必须是 pairedDifferenceV4MinusV0 在 successDefinition="no_false_call" 下的 value。
 */
export function fcrDifferenceFromNoFalseCallSuccessDifference(
  noFalseCallSuccessDifference: number,
): number {
  return -noFalseCallSuccessDifference;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 确定性 cluster 重抽样序列：每个 replicate 抽 clusterCount 个 cluster 索引（有放回）。
 * 同一序列的抽样权重必须同时作用于两 Variant；本模块据此保证两 Variant 共用权重。
 */
export function drawClusterResamples(
  clusterCount: number,
  seed: number,
  replicates: number,
): readonly number[][] {
  assertPositiveInteger(clusterCount, "clusterCount");
  assertPositiveInteger(replicates, "replicates");
  const random = mulberry32(seed);
  const draws: number[][] = [];
  for (let r = 0; r < replicates; r += 1) {
    const row: number[] = new Array<number>(clusterCount);
    for (let i = 0; i < clusterCount; i += 1) {
      row[i] = Math.floor(random() * clusterCount);
    }
    draws.push(row);
  }
  return draws;
}

export type ClusterResampleUnitV2 = "evaluation_team" | "source_cluster";

export interface ClusterAssignmentV2 {
  readonly caseId: string;
  readonly clusterId: string;
}

export interface ReplicateDetailV2 {
  readonly v0Rate: readonly number[];
  readonly v4Rate: readonly number[];
  readonly v4MinusV0: readonly number[];
}

export interface BootstrapClusterDifferenceInputV2 {
  readonly pairs: readonly PairedBinaryCaseV2[];
  readonly clusterAssignment: readonly ClusterAssignmentV2[];
  readonly unit: ClusterResampleUnitV2;
  readonly metricId: string;
  readonly successDefinition: string;
  readonly config: StatisticsConfigV2;
  readonly includeReplicateDetail?: boolean;
}

export type BootstrapStatusV2 = "single_cluster" | "few_clusters";

export interface BootstrapClusterDifferenceResultV2 {
  readonly metricId: string;
  readonly successDefinition: string;
  readonly unit: ClusterResampleUnitV2;
  readonly role: "primary" | "sensitivity";
  readonly seed: number;
  readonly bootstrapReplicates: number;
  readonly clusterCount: number;
  readonly pairedCaseCount: number;
  readonly pointEstimate: number;
  readonly differenceInterval: WilsonIntervalV2;
  readonly v0RateInterval: WilsonIntervalV2;
  readonly v4RateInterval: WilsonIntervalV2;
  readonly intervalMethod: typeof PERCENTILE_INTERVAL_METHOD_V2;
  readonly sharedResampleWeightsForBothVariants: true;
  readonly statuses: readonly BootstrapStatusV2[];
  readonly notes: readonly string[];
  readonly replicateDetail: ReplicateDetailV2 | null;
}

function percentile(sortedAscending: readonly number[], q: number): number {
  if (sortedAscending.length === 1) {
    return sortedAscending[0];
  }
  const position = (sortedAscending.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sortedAscending[lowerIndex];
  }
  return (
    sortedAscending[lowerIndex] +
    (sortedAscending[upperIndex] - sortedAscending[lowerIndex]) * (position - lowerIndex)
  );
}

function percentileInterval(values: readonly number[]): WilsonIntervalV2 {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    lower: percentile(sorted, 0.025),
    upper: percentile(sorted, 0.975),
  };
}

export function bootstrapClusterDifference(
  input: BootstrapClusterDifferenceInputV2,
): BootstrapClusterDifferenceResultV2 {
  validateStatisticsConfig(input.config);
  assertNonEmptyString(input.metricId, "metricId");
  assertNonEmptyString(input.successDefinition, "successDefinition");
  assertUniqueCaseIds(input.pairs.map((pair) => pair.caseId));
  if (input.pairs.length === 0) {
    throw new RangeError("bootstrap requires a non-empty paired case set");
  }
  assertUniqueCaseIds(input.clusterAssignment.map((assignment) => assignment.caseId));
  const pairCaseIds = new Set(input.pairs.map((pair) => pair.caseId));
  for (const assignment of input.clusterAssignment) {
    if (!pairCaseIds.has(assignment.caseId)) {
      throw new RangeError(
        `cluster assignment references caseId ${assignment.caseId} that is not in the paired set`,
      );
    }
  }
  const assignedCaseIds = new Set(input.clusterAssignment.map((assignment) => assignment.caseId));
  for (const pair of input.pairs) {
    if (!assignedCaseIds.has(pair.caseId)) {
      throw new RangeError(
        `paired case ${pair.caseId} has no cluster assignment; cluster resampling must not fall back to per-case draws`,
      );
    }
  }
  const clusterIds: string[] = [];
  const caseIndicesByCluster = new Map<string, number[]>();
  const caseIndexByCaseId = new Map(input.pairs.map((pair, index) => [pair.caseId, index]));
  for (const assignment of input.clusterAssignment) {
    let indices = caseIndicesByCluster.get(assignment.clusterId);
    if (indices === undefined) {
      indices = [];
      caseIndicesByCluster.set(assignment.clusterId, indices);
      clusterIds.push(assignment.clusterId);
    }
    indices.push(caseIndexByCaseId.get(assignment.caseId) as number);
  }
  const clusterCount = clusterIds.length;
  const v0Indicator = input.pairs.map((pair) => (pair.v0 ? 1 : 0));
  const v4Indicator = input.pairs.map((pair) => (pair.v4 ? 1 : 0));
  const draws = drawClusterResamples(
    clusterCount,
    input.config.seed,
    input.config.bootstrapReplicates,
  );
  const v0Rates: number[] = [];
  const v4Rates: number[] = [];
  const differences: number[] = [];
  for (const draw of draws) {
    let v0Sum = 0;
    let v4Sum = 0;
    let pooledCount = 0;
    for (const clusterIndex of draw) {
      for (const caseIndex of caseIndicesByCluster.get(clusterIds[clusterIndex]) as number[]) {
        v0Sum += v0Indicator[caseIndex];
        v4Sum += v4Indicator[caseIndex];
        pooledCount += 1;
      }
    }
    const v0Rate = v0Sum / pooledCount;
    const v4Rate = v4Sum / pooledCount;
    v0Rates.push(v0Rate);
    v4Rates.push(v4Rate);
    differences.push(v4Rate - v0Rate);
  }
  const totalCases = input.pairs.length;
  let v0Total = 0;
  let v4Total = 0;
  for (let i = 0; i < totalCases; i += 1) {
    v0Total += v0Indicator[i];
    v4Total += v4Indicator[i];
  }
  const pointEstimate = v4Total / totalCases - v0Total / totalCases;
  const statuses: BootstrapStatusV2[] = [];
  if (clusterCount < MIN_RELIABLE_CLUSTERS) {
    statuses.push("few_clusters");
  }
  if (clusterCount === 1) {
    statuses.push("single_cluster");
  }
  const notes: string[] = [];
  notes.push(
    input.unit === "evaluation_team"
      ? "主重采样单位为 evaluation team_id（指标规范 §15/§20），不按单条 Case 或重复运行重抽样。"
      : SOURCE_CLUSTER_SENSITIVITY_NOTE_V2,
  );
  notes.push(TEAM_INDEPENDENCE_CAVEAT_V2);
  if (statuses.includes("few_clusters")) {
    notes.push(
      `重采样 cluster 数 ${clusterCount} 低于模块警示阈值 ${MIN_RELIABLE_CLUSTERS}，区间宽度与覆盖不稳定，仅作描述。`,
    );
  }
  if (statuses.includes("single_cluster")) {
    notes.push("仅 1 个 cluster：重抽样无法产生变异性，区间退化为点估计，不能解释为精确区间。");
  }
  return {
    metricId: input.metricId,
    successDefinition: input.successDefinition,
    unit: input.unit,
    role: input.unit === "evaluation_team" ? "primary" : "sensitivity",
    seed: input.config.seed,
    bootstrapReplicates: input.config.bootstrapReplicates,
    clusterCount,
    pairedCaseCount: totalCases,
    pointEstimate,
    differenceInterval: percentileInterval(differences),
    v0RateInterval: percentileInterval(v0Rates),
    v4RateInterval: percentileInterval(v4Rates),
    intervalMethod: PERCENTILE_INTERVAL_METHOD_V2,
    sharedResampleWeightsForBothVariants: true,
    statuses,
    notes,
    replicateDetail: input.includeReplicateDetail
      ? { v0Rate: v0Rates, v4Rate: v4Rates, v4MinusV0: differences }
      : null,
  };
}

export interface TeamRatioInputV2 {
  readonly teamId: string;
  readonly numerator: number;
  readonly denominator: number;
}

export interface TeamMacroResultV2 {
  readonly value: number | null;
  readonly participatingTeamIds: readonly string[];
  readonly nonParticipatingTeamIds: readonly string[];
  readonly nonParticipationReason: "zero_denominator";
  readonly participatingTeamCount: number;
  readonly nonParticipatingTeamCount: number;
}

/**
 * Team Macro：只对分母非零的 Team 等权平均。零 CALL Team 的 ECR 分母为 0，
 * 不计入 Macro，也不得计为 0%；其 ID 在 nonParticipatingTeamIds 中返回。
 */
export function teamMacroAverageRatios(inputs: readonly TeamRatioInputV2[]): TeamMacroResultV2 {
  const seen = new Set<string>();
  const participatingTeamIds: string[] = [];
  const nonParticipatingTeamIds: string[] = [];
  let valueSum = 0;
  for (const team of inputs) {
    assertNonEmptyString(team.teamId, "teamId");
    if (seen.has(team.teamId)) {
      throw new RangeError(`duplicate teamId: ${team.teamId}`);
    }
    seen.add(team.teamId);
    assertNonNegativeInteger(team.numerator, `numerator of team ${team.teamId}`);
    assertNonNegativeInteger(team.denominator, `denominator of team ${team.teamId}`);
    if (team.numerator > team.denominator) {
      throw new RangeError(
        `team ${team.teamId}: numerator ${team.numerator} must not exceed denominator ${team.denominator}`,
      );
    }
    if (team.denominator === 0) {
      nonParticipatingTeamIds.push(team.teamId);
      continue;
    }
    participatingTeamIds.push(team.teamId);
    valueSum += team.numerator / team.denominator;
  }
  return {
    value: participatingTeamIds.length === 0 ? null : valueSum / participatingTeamIds.length,
    participatingTeamIds,
    nonParticipatingTeamIds,
    nonParticipationReason: "zero_denominator",
    participatingTeamCount: participatingTeamIds.length,
    nonParticipatingTeamCount: nonParticipatingTeamIds.length,
  };
}

export type MissingOutcomeBoundsStatusV2 =
  | "observed"
  | "no_missing_degenerate_to_point"
  | "all_unknown"
  | "not_applicable_zero_planned";

export interface MissingOutcomeBoundsV2 {
  readonly knownSuccessCount: number;
  readonly unknownCount: number;
  readonly plannedCount: number;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly kind: "conservative_missing_bounds";
  readonly isConfidenceInterval: false;
  readonly status: MissingOutcomeBoundsStatusV2;
  readonly note: string;
}

/** 已知事件 k、未知 u、计划 n 的保守区间 [k/n, (k+u)/n]；不是置信区间。 */
export function missingOutcomeBounds(
  knownSuccessCount: number,
  unknownCount: number,
  plannedCount: number,
): MissingOutcomeBoundsV2 {
  assertNonNegativeInteger(knownSuccessCount, "knownSuccessCount");
  assertNonNegativeInteger(unknownCount, "unknownCount");
  assertNonNegativeInteger(plannedCount, "plannedCount");
  if (knownSuccessCount + unknownCount > plannedCount) {
    throw new RangeError(
      `knownSuccessCount + unknownCount (${knownSuccessCount + unknownCount}) must not exceed plannedCount ${plannedCount}`,
    );
  }
  if (plannedCount === 0) {
    return {
      knownSuccessCount,
      unknownCount,
      plannedCount,
      lower: null,
      upper: null,
      kind: "conservative_missing_bounds",
      isConfidenceInterval: false,
      status: "not_applicable_zero_planned",
      note: MISSING_BOUNDS_NOTE_V2,
    };
  }
  const lower = knownSuccessCount / plannedCount;
  const upper = (knownSuccessCount + unknownCount) / plannedCount;
  const status: MissingOutcomeBoundsStatusV2 =
    unknownCount === 0
      ? "no_missing_degenerate_to_point"
      : knownSuccessCount === 0 && unknownCount === plannedCount
        ? "all_unknown"
        : "observed";
  return {
    knownSuccessCount,
    unknownCount,
    plannedCount,
    lower,
    upper,
    kind: "conservative_missing_bounds",
    isConfidenceInterval: false,
    status,
    note:
      unknownCount === 0
        ? `无缺失事件：区间退化为点值 ${String(lower)}。${MISSING_BOUNDS_NOTE_V2}`
        : MISSING_BOUNDS_NOTE_V2,
  };
}

export interface VariantUnknownOutcomeV2 {
  readonly caseId: string;
  /** 该 Variant 上此 Case 的二元结果；true 表示“成功”，null 表示基础设施未知。 */
  readonly success: boolean | null;
}

export interface PairedUnknownCaseV2 {
  readonly caseId: string;
  readonly v0: boolean | null;
  readonly v4: boolean | null;
}

export interface PairedUnknownIntersectionV2 {
  readonly pairs: readonly PairedUnknownCaseV2[];
  readonly v0OnlyCaseIds: readonly string[];
  readonly v4OnlyCaseIds: readonly string[];
}

/** 按同 Case 交集配对两 Variant 的可缺失二元结果；未知（null）保留进配对集。 */
export function intersectPairedUnknownCases(
  v0: readonly VariantUnknownOutcomeV2[],
  v4: readonly VariantUnknownOutcomeV2[],
): PairedUnknownIntersectionV2 {
  assertUniqueCaseIds(v0.map((outcome) => outcome.caseId));
  assertUniqueCaseIds(v4.map((outcome) => outcome.caseId));
  const v4ByCaseId = new Map(v4.map((outcome) => [outcome.caseId, outcome.success]));
  const pairs: PairedUnknownCaseV2[] = [];
  const v0OnlyCaseIds: string[] = [];
  const v4OnlyCaseIds: string[] = [];
  const v0Seen = new Set<string>();
  for (const outcome of v0) {
    v0Seen.add(outcome.caseId);
    const v4Success = v4ByCaseId.get(outcome.caseId);
    if (v4Success === undefined) {
      v0OnlyCaseIds.push(outcome.caseId);
    } else {
      pairs.push({ caseId: outcome.caseId, v0: outcome.success, v4: v4Success });
    }
  }
  for (const outcome of v4) {
    if (!v0Seen.has(outcome.caseId)) {
      v4OnlyCaseIds.push(outcome.caseId);
    }
  }
  return { pairs, v0OnlyCaseIds, v4OnlyCaseIds };
}

export type PairedMissingBoundsStatusV2 =
  | "no_missing_outcomes"
  | "has_unknown_outcomes"
  | "no_observed_pairs"
  | "not_applicable_no_planned_pairs";

export interface PairedMissingBoundsResultV2 {
  readonly plannedCaseCount: number;
  readonly observedIntersectionCaseCount: number;
  readonly unknownV0Count: number;
  readonly unknownV4Count: number;
  readonly oneSidedUnknownCount: number;
  readonly bothSidesUnknownCount: number;
  /** 只在双侧可观测的交集上计算，分母是交集数而非计划数。 */
  readonly pointEstimate: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly lowerAssignmentRule: string;
  readonly upperAssignmentRule: string;
  readonly kind: "conservative_missing_bounds";
  readonly isConfidenceInterval: false;
  readonly statuses: readonly PairedMissingBoundsStatusV2[];
  readonly notes: readonly string[];
}

const LOWER_ASSIGNMENT_RULE_V2 =
  "下界赋值：未知 V4 记 0（失败）、未知 V0 记 1（成功），已知值固定，逐 Case 求和后除以计划 n（V4-V0 方向）。";
const UPPER_ASSIGNMENT_RULE_V2 =
  "上界赋值：未知 V4 记 1（成功）、未知 V0 记 0（失败），已知值固定，逐 Case 求和后除以计划 n（V4-V0 方向）。";

export function pairedDifferenceMissingBounds(
  pairs: readonly PairedUnknownCaseV2[],
): PairedMissingBoundsResultV2 {
  assertUniqueCaseIds(pairs.map((pair) => pair.caseId));
  const plannedCaseCount = pairs.length;
  if (plannedCaseCount === 0) {
    return {
      plannedCaseCount: 0,
      observedIntersectionCaseCount: 0,
      unknownV0Count: 0,
      unknownV4Count: 0,
      oneSidedUnknownCount: 0,
      bothSidesUnknownCount: 0,
      pointEstimate: null,
      lower: null,
      upper: null,
      lowerAssignmentRule: LOWER_ASSIGNMENT_RULE_V2,
      upperAssignmentRule: UPPER_ASSIGNMENT_RULE_V2,
      kind: "conservative_missing_bounds",
      isConfidenceInterval: false,
      statuses: ["not_applicable_no_planned_pairs"],
      notes: [MISSING_BOUNDS_NOTE_V2],
    };
  }
  let lowerSum = 0;
  let upperSum = 0;
  let observedSum = 0;
  let observedCount = 0;
  let unknownV0Count = 0;
  let unknownV4Count = 0;
  let bothSidesUnknownCount = 0;
  let oneSidedUnknownCount = 0;
  for (const pair of pairs) {
    const v4LowerValue = pair.v4 === null ? 0 : pair.v4 ? 1 : 0;
    const v0LowerValue = pair.v0 === null ? 1 : pair.v0 ? 1 : 0;
    const v4UpperValue = pair.v4 === null ? 1 : pair.v4 ? 1 : 0;
    const v0UpperValue = pair.v0 === null ? 0 : pair.v0 ? 1 : 0;
    lowerSum += v4LowerValue - v0LowerValue;
    upperSum += v4UpperValue - v0UpperValue;
    if (pair.v0 === null) unknownV0Count += 1;
    if (pair.v4 === null) unknownV4Count += 1;
    if (pair.v0 === null && pair.v4 === null) {
      bothSidesUnknownCount += 1;
    } else if (pair.v0 === null || pair.v4 === null) {
      oneSidedUnknownCount += 1;
    } else {
      observedCount += 1;
      observedSum += (pair.v4 ? 1 : 0) - (pair.v0 ? 1 : 0);
    }
  }
  const hasUnknownOutcomes = unknownV0Count + unknownV4Count > 0;
  const statuses: PairedMissingBoundsStatusV2[] = [];
  if (hasUnknownOutcomes) {
    statuses.push("has_unknown_outcomes");
  } else {
    statuses.push("no_missing_outcomes");
  }
  if (observedCount === 0) {
    statuses.push("no_observed_pairs");
  }
  const notes: string[] = [MISSING_BOUNDS_NOTE_V2];
  if (!hasUnknownOutcomes) {
    notes.push("无缺失：上下界退化为计划集点值。");
  }
  if (observedCount === 0) {
    notes.push("无双侧可观测配对：交集点估计为 null。");
  }
  return {
    plannedCaseCount,
    observedIntersectionCaseCount: observedCount,
    unknownV0Count,
    unknownV4Count,
    oneSidedUnknownCount,
    bothSidesUnknownCount,
    pointEstimate: observedCount === 0 ? null : observedSum / observedCount,
    lower: lowerSum / plannedCaseCount,
    upper: upperSum / plannedCaseCount,
    lowerAssignmentRule: LOWER_ASSIGNMENT_RULE_V2,
    upperAssignmentRule: UPPER_ASSIGNMENT_RULE_V2,
    kind: "conservative_missing_bounds",
    isConfidenceInterval: false,
    statuses,
    notes,
  };
}
