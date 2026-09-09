import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateFrozenSkillCatalog } from "../../../../implementations/final/MemoryProxy/src/common/frozen-skill-catalog.js";
import { createWorkspaceGitProbe, type GitValidationCache } from "./workspace-git-validation.js";

export const WORKSPACE_MANIFEST_SCHEMA = "task1.final5-workspace-manifest.v2" as const;
export const WORKSPACE_QA_SCHEMA = "task1.final5-workspace-qa.v2" as const;
export const WORKSPACE_RECEIPT_SCHEMA = "task1.final5-workspace-receipt.v2" as const;
export const EXPECTED_SHARD_NAMES = [
  "workspace-resolution-shard-a.jsonl",
  "workspace-resolution-shard-b.jsonl",
  "workspace-resolution-shard-c.jsonl",
  "workspace-resolution-shard-d.jsonl",
] as const;

export type WorkspaceSourceKind =
  | "existing-git-repository"
  | "existing-checked-source"
  | "plain-source-snapshot";
export type WorkspaceResolutionStatus = "resolved" | "blocked";

export interface VersionEvidence {
  kind: string;
  path: string;
  sha256: string;
  sourceRevision: string;
}

export interface Final5WorkspaceBinding {
  caseId: string;
  teamId: string;
  repoId: string;
  repoUrl: string;
  baseSha: string;
  clusterId: string;
  repositoryPath: string | null;
  sourceKind: WorkspaceSourceKind;
  isGitRepository: boolean;
  baseShaVerified: boolean;
  resolutionStatus: WorkspaceResolutionStatus;
  resolutionReason: string;
  workspaceReady: boolean;
  versionEvidence?: VersionEvidence;
}

export interface Final5ExpectedCase {
  caseId: string;
  teamId: string;
  repoId: string;
  repoUrl: string;
  baseSha: string;
}

export interface WorkspaceValidationIssue {
  code: string;
  message: string;
  caseId?: string;
  source?: string;
  line?: number;
}

export interface WorkspaceQaReport {
  schemaVersion: typeof WORKSPACE_QA_SCHEMA;
  valid: boolean;
  workspaceReady: boolean;
  status: "ready" | "blocked" | "invalid";
  expectedCaseCount: number;
  manifestCaseCount: number;
  resolvedCaseCount: number;
  blockedCaseCount: number;
  gitWorkspaceCount: number;
  plainSnapshotCount: number;
  expectedTeamCount: number;
  manifestTeamCount: number;
  shardTeamCount: number;
  missingCaseIds: string[];
  unknownCaseIds: string[];
  duplicateCaseIds: string[];
  blockedCases: Array<{ caseId: string; teamId: string; reason: string }>;
  errors: WorkspaceValidationIssue[];
  skillCatalog?: SkillCatalogCoverage;
}

export interface SkillCatalogCoverage {
  path: string;
  expectedCaseCount: number;
  bindingCount: number;
  missingCaseIds: string[];
  unknownCaseIds: string[];
  duplicateCaseIds: string[];
  valid: boolean;
}

export interface WorkspaceMergeOptions {
  teamsRoot: string;
  shardsRoot: string;
  outputPath: string;
  skillCatalogPath?: string;
  expectedCaseCount?: number;
  expectedTeamCount?: number;
}

export interface WorkspaceMergeResult {
  manifest: Final5WorkspaceBinding[];
  qa: WorkspaceQaReport;
  receipt: Record<string, unknown>;
  outputPath: string;
  qaPath: string;
  receiptPath: string;
}

interface ParsedShardRow {
  source: string;
  line: number;
  raw: Record<string, unknown>;
}

interface PreparedIndex {
  cases: Final5ExpectedCase[];
  byId: Map<string, Final5ExpectedCase>;
  teamIds: Set<string>;
}

const FORBIDDEN_MANIFEST_KEYS = new Set([
  "gold",
  "expected_sequence",
  "expectedSequence",
  "target_asset_ids",
  "targetAssetIds",
  "query",
  "queries",
  "variant",
]);
const SOURCE_KINDS = new Set<WorkspaceSourceKind>([
  "existing-git-repository",
  "existing-checked-source",
  "plain-source-snapshot",
]);
const SHA1 = /^[0-9a-f]{40}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathWithin(candidate: string, root: string): boolean {
  const target = resolve(candidate);
  const base = resolve(root);
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function pathSegments(candidate: string): string[] {
  return resolve(candidate).split(/[\\/]+/u).filter(Boolean).map((part) => part.toLowerCase());
}

export function isForbiddenWorkspacePath(candidate: string, teamsRoot?: string, teamId?: string): boolean {
  const target = resolve(candidate);
  if (teamsRoot && teamId && pathWithin(target, join(resolve(teamsRoot), teamId, "data"))) return true;
  const segments = pathSegments(target);
  if (segments.includes("benchmark-runs")) return true;
  if (segments.includes("gold") || segments.includes("evidence") || segments.includes("answer") || segments.includes("answers") || segments.includes("private")) return true;
  return false;
}

function isForbiddenSnapshotCopyPath(candidate: string): boolean {
  const segments = pathSegments(candidate);
  return segments.includes(".git") || segments.includes("benchmark-runs")
    || segments.includes("gold") || segments.includes("evidence") || segments.includes("answer")
    || segments.includes("answers") || segments.includes("private")
    || segments.some((segment, index) => segment === "team" && segments[index + 1] === "data");
}

function gitText(repositoryPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

export function isGitRepository(repositoryPath: string): boolean {
  return gitText(repositoryPath, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

export function gitCommitExists(repositoryPath: string, baseSha: string): boolean {
  if (!SHA1.test(baseSha)) return false;
  return gitText(repositoryPath, ["cat-file", "-e", `${baseSha}^{commit}`]) !== null;
}

function readJsonl(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) throw new Error("row must be a JSON object");
        return parsed;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: invalid JSONL row: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

export function loadFinal5CaseIndex(teamsRoot: string): PreparedIndex {
  const root = resolve(teamsRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`teams root does not exist: ${root}`);
  const cases: Final5ExpectedCase[] = [];
  const byId = new Map<string, Final5ExpectedCase>();
  const teamIds = new Set<string>();
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const teamId = entry.name;
    const casesPath = join(root, teamId, "data", "cases.jsonl");
    if (!existsSync(casesPath)) continue;
    teamIds.add(teamId);
    for (const [index, row] of readJsonl(casesPath).entries()) {
      const caseId = requiredText(row.case_id, `${teamId}/cases.jsonl:${index + 1}.case_id`);
      const rowTeamId = requiredText(row.team_id, `${caseId}.team_id`);
      if (rowTeamId !== teamId) throw new Error(`${caseId}: team_id differs from Team directory: ${rowTeamId} vs ${teamId}`);
      const expected: Final5ExpectedCase = {
        caseId,
        teamId: rowTeamId,
        repoId: requiredText(row.repo_id, `${caseId}.repo_id`),
        repoUrl: requiredText(row.repo_url, `${caseId}.repo_url`),
        baseSha: requiredText(row.base_sha, `${caseId}.base_sha`),
      };
      if (!SHA1.test(expected.baseSha)) throw new Error(`${caseId}: base_sha must be a 40-character hexadecimal commit`);
      if (byId.has(caseId)) throw new Error(`duplicate Case in cases.jsonl: ${caseId}`);
      byId.set(caseId, expected);
      cases.push(expected);
    }
  }
  return { cases, byId, teamIds };
}

function parseVersionEvidence(row: Record<string, unknown>, caseId: string, teamsRoot: string, teamId: string): VersionEvidence | undefined {
  const nested = isRecord(row.versionEvidence) ? row.versionEvidence : undefined;
  const path = optionalText(nested?.path)
    ?? optionalText(nested?.evidencePath)
    ?? optionalText(row.evidencePath)
    ?? optionalText(row.snapshotManifestPath)
    ?? optionalText(row.sourceManifestPath);
  const sha256 = optionalText(nested?.sha256)
    ?? optionalText(nested?.evidenceSha256)
    ?? optionalText(row.evidenceSha256)
    ?? optionalText(row.snapshotSha256)
    ?? optionalText(row.sourceManifestSha256);
  const sourceRevision = optionalText(nested?.sourceRevision)
    ?? optionalText(row.sourceRevision)
    ?? optionalText(row.checkedOutRevision)
    ?? optionalText(row.versionRevision)
    ?? (SHA1.test(String(row.baseSha ?? "")) ? String(row.baseSha) : undefined);
  const kind = optionalText(nested?.kind) ?? optionalText(row.evidenceKind) ?? "source-manifest";
  if (!path && !sha256 && !sourceRevision && !nested) return undefined;
  if (!path || !sha256 || !sourceRevision) {
    throw new Error(`${caseId}: non-Git workspace requires version evidence path, sha256, and sourceRevision`);
  }
  if (!isAbsolute(path)) throw new Error(`${caseId}: version evidence path must be absolute`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${caseId}: version evidence path does not exist: ${path}`);
  if (!SHA256.test(sha256)) throw new Error(`${caseId}: version evidence sha256 must be a 64-character hexadecimal digest`);
  if (isForbiddenWorkspacePath(path, teamsRoot, teamId)) throw new Error(`${caseId}: version evidence points at a forbidden private path`);
  return { kind, path: resolve(path), sha256: sha256.toLowerCase(), sourceRevision };
}

function assertNoForbiddenKeys(row: Record<string, unknown>, caseId: string): void {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_MANIFEST_KEYS.has(key)) throw new Error(`${caseId}: manifest binding cannot contain ${key}`);
  }
}

export function normalizeWorkspaceBinding(
  value: unknown,
  expected: Final5ExpectedCase | undefined,
  context: { source: string; line?: number; teamsRoot: string; gitProbe?: ReturnType<typeof createWorkspaceGitProbe> },
): Final5WorkspaceBinding {
  if (!isRecord(value)) throw new Error(`${context.source}${context.line ? `:${context.line}` : ""}: binding must be a JSON object`);
  const caseId = requiredText(value.caseId, "caseId");
  assertNoForbiddenKeys(value, caseId);
  if (expected && caseId !== expected.caseId) throw new Error(`${caseId}: unexpected Case context`);
  const teamId = requiredText(value.teamId, `${caseId}.teamId`);
  const repoId = requiredText(value.repoId, `${caseId}.repoId`);
  const repoUrl = requiredText(value.repoUrl, `${caseId}.repoUrl`);
  const baseSha = requiredText(value.baseSha, `${caseId}.baseSha`);
  const clusterId = requiredText(value.clusterId ?? value.cluster_id, `${caseId}.clusterId`);
  const sourceKind = requiredText(value.sourceKind, `${caseId}.sourceKind`) as WorkspaceSourceKind;
  if (!SOURCE_KINDS.has(sourceKind)) throw new Error(`${caseId}: unknown sourceKind ${sourceKind}`);
  const resolutionStatus = requiredText(value.resolutionStatus, `${caseId}.resolutionStatus`) as WorkspaceResolutionStatus;
  if (resolutionStatus !== "resolved" && resolutionStatus !== "blocked") throw new Error(`${caseId}: resolutionStatus must be resolved or blocked`);
  if (!SHA1.test(baseSha)) throw new Error(`${caseId}: baseSha must be a 40-character hexadecimal commit`);
  if (expected) {
    if (teamId !== expected.teamId) throw new Error(`${caseId}: teamId does not match cases.jsonl`);
    if (repoId !== expected.repoId) throw new Error(`${caseId}: repoId does not match cases.jsonl`);
    if (repoUrl !== expected.repoUrl) throw new Error(`${caseId}: repoUrl does not match cases.jsonl`);
    if (baseSha !== expected.baseSha) throw new Error(`${caseId}: baseSha does not match cases.jsonl`);
  }
  const resolutionReason = requiredText(value.resolutionReason, `${caseId}.resolutionReason`);
  const repositoryValue = value.repositoryPath;
  const repositoryPath = repositoryValue === null || repositoryValue === undefined || repositoryValue === ""
    ? null
    : requiredText(repositoryValue, `${caseId}.repositoryPath`);
  const isGit = value.isGitRepository;
  if (typeof isGit !== "boolean") throw new Error(`${caseId}.isGitRepository must be boolean`);
  const baseShaVerified = value.baseShaVerified;
  if (typeof baseShaVerified !== "boolean") throw new Error(`${caseId}.baseShaVerified must be boolean`);
  const workspaceReadyValue = value.workspaceReady;
  if (workspaceReadyValue !== undefined && typeof workspaceReadyValue !== "boolean") throw new Error(`${caseId}.workspaceReady must be boolean`);

  if (resolutionStatus === "blocked") {
    if (repositoryPath !== null) throw new Error(`${caseId}: blocked binding cannot provide repositoryPath`);
    if (isGit) throw new Error(`${caseId}: blocked binding cannot claim isGitRepository=true`);
    if (workspaceReadyValue === true) throw new Error(`${caseId}: blocked binding cannot be workspaceReady`);
    if (baseShaVerified) throw new Error(`${caseId}: blocked binding cannot claim baseShaVerified`);
    return {
      caseId, teamId, repoId, repoUrl, baseSha, clusterId, repositoryPath: null, sourceKind,
      isGitRepository: false, baseShaVerified: false, resolutionStatus, resolutionReason, workspaceReady: false,
    };
  }

  if (!repositoryPath || !isAbsolute(repositoryPath)) throw new Error(`${caseId}: resolved repositoryPath must be an absolute path`);
  if (!existsSync(repositoryPath) || !statSync(repositoryPath).isDirectory()) throw new Error(`${caseId}: resolved repositoryPath does not exist: ${repositoryPath}`);
  if (isForbiddenWorkspacePath(repositoryPath, context.teamsRoot, teamId)) throw new Error(`${caseId}: repositoryPath points at Team/data, Gold, Evidence, or benchmark private data`);
  if (!baseShaVerified) throw new Error(`${caseId}: resolved binding must set baseShaVerified=true`);
  if (sourceKind === "existing-git-repository" && !isGit) throw new Error(`${caseId}: existing-git-repository must set isGitRepository=true`);
  if (sourceKind === "plain-source-snapshot" && isGit) throw new Error(`${caseId}: plain-source-snapshot must set isGitRepository=false`);
  if (workspaceReadyValue === false) throw new Error(`${caseId}: resolved binding cannot set workspaceReady=false`);
  const probe = isGit ? context.gitProbe?.(repositoryPath) : undefined;
  if (isGit && !(probe ? probe.isGit : isGitRepository(repositoryPath))) throw new Error(`${caseId}: repositoryPath is not a Git repository`);
  if (isGit && !(probe ? probe.commits.includes(baseSha.toLowerCase()) : gitCommitExists(repositoryPath, baseSha))) throw new Error(`${caseId}: baseSha commit does not exist in repositoryPath`);
  const versionEvidence = isGit ? undefined : parseVersionEvidence(value, caseId, context.teamsRoot, teamId);
  if (!isGit && !versionEvidence) throw new Error(`${caseId}: non-Git workspace requires version evidence`);
  return {
    caseId, teamId, repoId, repoUrl, baseSha, clusterId, repositoryPath, sourceKind,
    isGitRepository: isGit, baseShaVerified: true, resolutionStatus, resolutionReason,
    workspaceReady: workspaceReadyValue ?? true, ...(versionEvidence ? { versionEvidence } : {}),
  };
}

function issue(error: unknown, context: { source?: string; line?: number; caseId?: string }): WorkspaceValidationIssue {
  return {
    code: "invalid-binding",
    message: error instanceof Error ? error.message : String(error),
    ...context,
  };
}

function emptyQa(expectedCaseCount: number, expectedTeamCount: number): WorkspaceQaReport {
  return {
    schemaVersion: WORKSPACE_QA_SCHEMA,
    valid: false,
    workspaceReady: false,
    status: "invalid",
    expectedCaseCount,
    manifestCaseCount: 0,
    resolvedCaseCount: 0,
    blockedCaseCount: 0,
    gitWorkspaceCount: 0,
    plainSnapshotCount: 0,
    expectedTeamCount,
    manifestTeamCount: 0,
    shardTeamCount: 0,
    missingCaseIds: [],
    unknownCaseIds: [],
    duplicateCaseIds: [],
    blockedCases: [],
    errors: [],
  };
}

export function validateWorkspaceManifest(
  manifest: unknown,
  expectedCases: readonly Final5ExpectedCase[],
  options: { teamsRoot: string; expectedTeamCount?: number; skillCatalog?: SkillCatalogCoverage; gitCache?: GitValidationCache } ,
): { bindings: Final5WorkspaceBinding[]; qa: WorkspaceQaReport; errorsByCase: Map<string, WorkspaceValidationIssue[]> } {
  const expectedById = new Map(expectedCases.map((item) => [item.caseId, item]));
  const qa = emptyQa(expectedCases.length, options.expectedTeamCount ?? new Set(expectedCases.map((item) => item.teamId)).size);
  const bindings: Final5WorkspaceBinding[] = [];
  const errorsByCase = new Map<string, WorkspaceValidationIssue[]>();
  if (!Array.isArray(manifest)) {
    qa.errors.push({ code: "manifest-not-array", message: "workspace manifest must be a JSON array" });
    return { bindings, qa, errorsByCase };
  }
  const seen = new Map<string, number>();
  const gitProbe = createWorkspaceGitProbe(manifest, options.gitCache);
  const teamIds = new Set<string>();
  for (const [index, row] of manifest.entries()) {
    let caseId: string | undefined;
    try { caseId = isRecord(row) ? optionalText(row.caseId) : undefined; } catch { /* handled by normalize */ }
    if (caseId && seen.has(caseId)) {
      qa.duplicateCaseIds.push(caseId);
      const duplicateIssue = { code: "duplicate-case", message: `${caseId}: Case appears more than once`, caseId, line: index + 1 };
      qa.errors.push(duplicateIssue);
      errorsByCase.set(caseId, [...(errorsByCase.get(caseId) ?? []), duplicateIssue]);
      continue;
    }
    if (caseId) seen.set(caseId, index + 1);
    const expected = caseId ? expectedById.get(caseId) : undefined;
    if (caseId && !expected) {
      qa.unknownCaseIds.push(caseId);
      const unknownIssue = { code: "unknown-case", message: `${caseId}: Case is not present in cases.jsonl`, caseId, line: index + 1 };
      qa.errors.push(unknownIssue);
      errorsByCase.set(caseId, [...(errorsByCase.get(caseId) ?? []), unknownIssue]);
      continue;
    }
    try {
      const binding = normalizeWorkspaceBinding(row, expected, { source: "workspace-manifest", line: index + 1, teamsRoot: options.teamsRoot, gitProbe });
      bindings.push(binding);
      teamIds.add(binding.teamId);
      if (binding.resolutionStatus === "blocked") qa.blockedCases.push({ caseId: binding.caseId, teamId: binding.teamId, reason: binding.resolutionReason });
    } catch (error) {
      const invalid = issue(error, { caseId, line: index + 1 });
      qa.errors.push(invalid);
      if (caseId) errorsByCase.set(caseId, [...(errorsByCase.get(caseId) ?? []), invalid]);
    }
  }
  const expectedIds = new Set(expectedCases.map((item) => item.caseId));
  qa.missingCaseIds = expectedCases.map((item) => item.caseId).filter((caseId) => !seen.has(caseId));
  qa.unknownCaseIds = [...new Set(qa.unknownCaseIds)];
  qa.duplicateCaseIds = [...new Set(qa.duplicateCaseIds)];
  for (const caseId of qa.missingCaseIds) qa.errors.push({ code: "missing-case", message: `${caseId}: Case is missing from workspace manifest`, caseId });
  for (const caseId of qa.missingCaseIds) errorsByCase.set(caseId, [{ code: "missing-case", message: `${caseId}: Case is missing from workspace manifest`, caseId }]);
  if (bindings.length !== expectedCases.length) {
    qa.errors.push({ code: "case-count", message: `workspace manifest contains ${bindings.length} valid bindings for ${expectedCases.length} expected Cases` });
  }
  qa.manifestCaseCount = manifest.length;
  qa.resolvedCaseCount = bindings.filter((binding) => binding.resolutionStatus === "resolved" && binding.workspaceReady).length;
  qa.blockedCaseCount = bindings.filter((binding) => binding.resolutionStatus === "blocked").length;
  qa.gitWorkspaceCount = bindings.filter((binding) => binding.resolutionStatus === "resolved" && binding.isGitRepository).length;
  qa.plainSnapshotCount = bindings.filter((binding) => binding.resolutionStatus === "resolved" && !binding.isGitRepository).length;
  qa.manifestTeamCount = teamIds.size;
  qa.shardTeamCount = teamIds.size;
  qa.skillCatalog = options.skillCatalog;
  qa.valid = qa.errors.length === 0 && seen.size === expectedIds.size;
  qa.workspaceReady = qa.valid && qa.blockedCaseCount === 0 && qa.resolvedCaseCount === expectedCases.length;
  qa.status = !qa.valid ? "invalid" : qa.workspaceReady ? "ready" : "blocked";
  return { bindings, qa, errorsByCase };
}

export function loadSkillCatalogCoverage(path: string, expectedCaseIds: readonly string[]): SkillCatalogCoverage {
  const rows = readJsonl(resolve(path));
  const expected = new Set(expectedCaseIds);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const [index, row] of rows.entries()) {
    const caseId = requiredText(row.caseId, `skill catalog line ${index + 1}.caseId`);
    if (seen.has(caseId)) duplicates.push(caseId);
    seen.add(caseId);
    if (!expected.has(caseId)) unknown.push(caseId);
    const visibleSkills = Array.isArray(row.visibleSkills) ? row.visibleSkills : [];
    validateFrozenSkillCatalog({
      caseId: row.caseId,
      catalogId: row.catalogId,
      catalogSha256: row.catalogSha256,
      skills: visibleSkills.map((skill) => {
        const item = skill as Record<string, unknown>;
        return { order: item.order, runtimeSkillId: item.runtimeSkillId, runtimeName: item.runtimeName, description: item.description };
      }),
    });
  }
  const missing = expectedCaseIds.filter((caseId) => !seen.has(caseId));
  return {
    path: resolve(path),
    expectedCaseCount: expectedCaseIds.length,
    bindingCount: rows.length,
    missingCaseIds: missing,
    unknownCaseIds: [...new Set(unknown)],
    duplicateCaseIds: [...new Set(duplicates)],
    valid: rows.length === expectedCaseIds.length && missing.length === 0 && unknown.length === 0 && duplicates.length === 0,
  };
}

export function loadSkillCatalogBindings(path: string): Map<string, ReturnType<typeof validateFrozenSkillCatalog>> {
  const rows = readJsonl(resolve(path));
  const bindings = new Map<string, ReturnType<typeof validateFrozenSkillCatalog>>();
  for (const [index, row] of rows.entries()) {
    const visibleSkills = Array.isArray(row.visibleSkills) ? row.visibleSkills : [];
    const binding = validateFrozenSkillCatalog({
      caseId: row.caseId,
      catalogId: row.catalogId,
      catalogSha256: row.catalogSha256,
      skills: visibleSkills.map((skill) => {
        const item = skill as Record<string, unknown>;
        return { order: item.order, runtimeSkillId: item.runtimeSkillId, runtimeName: item.runtimeName, description: item.description };
      }),
    });
    if (bindings.has(binding.caseId)) throw new Error(`duplicate frozen Skill catalog caseId at line ${index + 1}: ${binding.caseId}`);
    const visibleSkillIds = row.visibleSkillIds;
    if (Array.isArray(visibleSkillIds) && JSON.stringify(visibleSkillIds) !== JSON.stringify(binding.skills.map((skill) => skill.runtimeSkillId))) {
      throw new Error(`visibleSkillIds mismatch for ${binding.caseId}`);
    }
    bindings.set(binding.caseId, binding);
  }
  return bindings;
}

function shardRows(shardsRoot: string): { rows: ParsedShardRow[]; files: Array<{ path: string; sha256: string; caseCount: number; teamIds: string[] }> } {
  const root = resolve(shardsRoot);
  const rows: ParsedShardRow[] = [];
  const files: Array<{ path: string; sha256: string; caseCount: number; teamIds: string[] }> = [];
  for (const name of EXPECTED_SHARD_NAMES) {
    const filePath = join(root, name);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`missing expected shard: ${filePath}`);
    const text = readFileSync(filePath, "utf8");
    const fileRows: ParsedShardRow[] = [];
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch (error) { throw new Error(`${filePath}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
      if (!isRecord(parsed)) throw new Error(`${filePath}:${index + 1}: shard row must be a JSON object`);
      fileRows.push({ source: filePath, line: index + 1, raw: parsed });
    }
    const teamIds = [...new Set(fileRows.map((row) => optionalText(row.raw.teamId) ?? "" ).filter(Boolean))].sort();
    files.push({ path: filePath, sha256: createHash("sha256").update(text).digest("hex"), caseCount: fileRows.length, teamIds });
    rows.push(...fileRows);
  }
  return { rows, files };
}

function outputPaths(outputPath: string): { outputPath: string; qaPath: string; receiptPath: string } {
  const output = resolve(outputPath);
  if (!output.toLowerCase().endsWith(".json")) throw new Error(`workspace manifest output must be a .json file: ${output}`);
  return {
    outputPath: output,
    qaPath: output.replace(/\.json$/iu, "-qa.json"),
    receiptPath: output.replace(/\.json$/iu, "-receipt.json"),
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "w" });
}

export function mergeFinal5WorkspaceShards(options: WorkspaceMergeOptions): WorkspaceMergeResult {
  const paths = outputPaths(options.outputPath);
  const index = loadFinal5CaseIndex(options.teamsRoot);
  const expectedCaseCount = options.expectedCaseCount ?? 1560;
  const expectedTeamCount = options.expectedTeamCount ?? 39;
  if (index.cases.length !== expectedCaseCount) throw new Error(`formal dataset Case count is ${index.cases.length}; expected ${expectedCaseCount}`);
  if (index.teamIds.size !== expectedTeamCount) throw new Error(`formal dataset Team count is ${index.teamIds.size}; expected ${expectedTeamCount}`);
  const parsed = shardRows(options.shardsRoot);
  const shardTeamSets = parsed.files.map((file) => new Set(file.teamIds));
  for (let left = 0; left < shardTeamSets.length; left += 1) {
    for (let right = left + 1; right < shardTeamSets.length; right += 1) {
      for (const teamId of shardTeamSets[left]!) if (shardTeamSets[right]!.has(teamId)) throw new Error(`Team appears in multiple shards: ${teamId}`);
    }
  }
  const rawBindings: unknown[] = [];
  const gitProbe = createWorkspaceGitProbe(parsed.rows.map((row) => row.raw));
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const caseId = optionalText(row.raw.caseId);
    if (caseId && seen.has(caseId)) throw new Error(`${caseId}: Case appears more than once across shards`);
    if (caseId) seen.add(caseId);
    const expected = caseId ? index.byId.get(caseId) : undefined;
    if (caseId && !expected) throw new Error(`${caseId}: unknown Case in ${row.source}:${row.line}`);
    try {
      rawBindings.push(normalizeWorkspaceBinding(row.raw, expected, { source: row.source, line: row.line, teamsRoot: resolve(options.teamsRoot), gitProbe }));
    } catch (error) {
      throw new Error(`${row.source}:${row.line}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const manifest = index.cases.map((expected) => {
    const binding = rawBindings.find((row) => (row as Final5WorkspaceBinding).caseId === expected.caseId) as Final5WorkspaceBinding | undefined;
    if (!binding) throw new Error(`${expected.caseId}: missing Case from shards`);
    return binding;
  });
  const skillCatalogPath = resolve(options.skillCatalogPath ?? join(dirname(paths.outputPath), "skill-catalog-final5-v2", "case-skill-catalog.jsonl"));
  const skillCatalog = loadSkillCatalogCoverage(skillCatalogPath, index.cases.map((item) => item.caseId));
  if (!skillCatalog.valid) throw new Error(`Skill catalog binding coverage failed: missing=${skillCatalog.missingCaseIds.length}, unknown=${skillCatalog.unknownCaseIds.length}, duplicate=${skillCatalog.duplicateCaseIds.length}`);
  const validation = validateWorkspaceManifest(manifest, index.cases, { teamsRoot: resolve(options.teamsRoot), expectedTeamCount, skillCatalog });
  if (!validation.qa.valid) throw new Error(`workspace manifest QA failed: ${validation.qa.errors.map((item) => item.message).slice(0, 5).join("; ")}`);
  writeJson(paths.outputPath, manifest);
  writeJson(paths.qaPath, validation.qa);
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest, null, 2) + "\n").digest("hex");
  const qaSha256 = createHash("sha256").update(JSON.stringify(validation.qa, null, 2) + "\n").digest("hex");
  const receipt = {
    schemaVersion: WORKSPACE_RECEIPT_SCHEMA,
    manifestSchemaVersion: WORKSPACE_MANIFEST_SCHEMA,
    outputPath: paths.outputPath,
    qaPath: paths.qaPath,
    manifestSha256,
    qaSha256,
    expectedCaseCount,
    expectedTeamCount,
    caseCount: manifest.length,
    teamCount: new Set(manifest.map((binding) => binding.teamId)).size,
    shardFiles: parsed.files,
    skillCatalog,
  };
  writeJson(paths.receiptPath, receipt);
  return { manifest, qa: validation.qa, receipt, ...paths };
}

export function readWorkspaceManifestFile(path: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`workspace manifest must be a JSON array: ${resolve(path)}`);
  return parsed;
}

export function expectedCasesFromRecords(records: readonly { case_id: string; team_id: string; case: Record<string, unknown> }[]): Final5ExpectedCase[] {
  return records.map((record) => ({
    caseId: record.case_id,
    teamId: record.team_id,
    repoId: requiredText(record.case.repo_id, `${record.case_id}.repo_id`),
    repoUrl: requiredText(record.case.repo_url, `${record.case_id}.repo_url`),
    baseSha: requiredText(record.case.base_sha, `${record.case_id}.base_sha`),
  }));
}

export function findWorkspaceBinding(bindings: readonly Final5WorkspaceBinding[], caseId: string): Final5WorkspaceBinding | undefined {
  return bindings.find((binding) => binding.caseId === caseId);
}

export function isForbiddenSnapshotPath(candidate: string): boolean {
  return isForbiddenSnapshotCopyPath(candidate);
}
