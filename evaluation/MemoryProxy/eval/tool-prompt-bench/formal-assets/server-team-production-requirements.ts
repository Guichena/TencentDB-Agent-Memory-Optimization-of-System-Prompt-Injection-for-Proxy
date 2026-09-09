/** Deployment requirement resolvers for the local server_team Formal restore. */
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { canonicalSha256 } from "../formal-runtime/canonical.js";
import type {
  ProductionRestoreRequirementResolver,
} from "./production-restore-executor.js";
import type {
  RestorePlanRequirement,
} from "./restore-plan-contract.js";

export type ServerTeamRequirementErrorCode =
  | "MAPPING_NOT_FOUND"
  | "INVALID_REQUIREMENT"
  | "SKILL_PACKAGE_NOT_FOUND"
  | "SKILL_PACKAGE_INVALID"
  | "OBSOLETE_KNOWLEDGE_REQUIREMENT";

export class ServerTeamRequirementError extends Error {
  constructor(
    readonly code: ServerTeamRequirementErrorCode,
    readonly requirementId: string,
    message: string,
  ) {
    super(`server_team requirement [${code}] ${requirementId}: ${message}`);
    this.name = "ServerTeamRequirementError";
  }
}

export interface ServerTeamMemoryImportInput {
  readonly requirementId: string;
  readonly formalAssetId: string;
  readonly expectedAssetContentHash: string;
  readonly isolation: Readonly<{
    team_id: string;
    user_id: string;
    agent_id: string;
  }>;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ServerTeamMemoryImportHook = (
  input: ServerTeamMemoryImportInput,
) => Promise<unknown>;

export interface ServerTeamRequirementResolverConfig {
  readonly serviceIdsByDatasetSpaceId: Readonly<Record<string, string>>;
  readonly authUserIdsByDatasetUserId: Readonly<Record<string, string>>;
  /** Candidate directories whose root contains the manifest's SKILL.md. */
  readonly skillPackageRoots: readonly string[];
  /** Dataset-visible aliases already frozen in the restore plan, keyed by formal asset id. */
  readonly runtimeSkillNamesByFormalAssetId?: Readonly<Record<string, string>>;
  /** Concise dataset descriptions used only when verified upstream frontmatter exceeds API limits. */
  readonly runtimeSkillDescriptionsByFormalAssetId?: Readonly<Record<string, string>>;
  readonly importMemoryL1: ServerTeamMemoryImportHook;
  readonly importMemoryL2: ServerTeamMemoryImportHook;
}

/**
 * Locate package roots in a separate checkout of the frozen data tag.
 * Raw upstream copies are intentionally ignored. Some Team builders store the
 * reviewed package directly while others use an adapted/ child directory, so
 * final packages are identified by excluding raw/ rather than requiring one
 * specific authoring layout. Exact manifest verification remains authoritative.
 */
export async function discoverFrozenSkillPackageRoots(
  frozenDataCheckoutRoot: string,
): Promise<readonly string[]> {
  const sourceRoot = resolve(
    frozenDataCheckoutRoot,
    "MemoryProxy",
    "eval",
    "tool-prompt-bench",
    "formal-dataset",
    "source-material",
  );
  const roots: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      const segments = relative(sourceRoot, directory).split(sep);
      if (!segments.includes("raw")) roots.push(directory);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(directory, entry.name));
    }
  };

  try {
    await walk(sourceRoot);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        "Frozen data checkout does not contain formal-dataset/source-material; "
        + "create it from task1-data-formal-v2.1 before restore",
      );
    }
    throw cause;
  }
  return Object.freeze(roots.sort((left, right) => left.localeCompare(right)));
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function error(
  code: ServerTeamRequirementErrorCode,
  requirement: RestorePlanRequirement,
  message: string,
): never {
  throw new ServerTeamRequirementError(code, requirement.requirementId, message);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestMatchedBytes(
  checkoutBytes: Buffer,
  expectedSha256: string,
  allowSingleMixedNewline: boolean,
): Buffer | undefined {
  if (sha256(checkoutBytes) === expectedSha256) return checkoutBytes;
  if (!isUtf8(checkoutBytes)) return undefined;

  const normalized = checkoutBytes.toString("utf8").replace(/\r\n|\r/gu, "\n");
  const lf = Buffer.from(normalized, "utf8");
  if (sha256(lf) === expectedSha256) return lf;
  const crlf = Buffer.from(normalized.replace(/\n/gu, "\r\n"), "utf8");
  if (sha256(crlf) === expectedSha256) return crlf;
  if (!allowSingleMixedNewline || !normalized.includes("\n")) return undefined;

  const lines = normalized.split("\n");
  const newlineCount = lines.length - 1;
  for (let loneIndex = 0; loneIndex < newlineCount; loneIndex += 1) {
    let mostlyCrlf = "";
    let mostlyLf = "";
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]!;
      mostlyCrlf += line;
      mostlyLf += line;
      if (lineIndex < newlineCount) {
        mostlyCrlf += lineIndex === loneIndex ? "\n" : "\r\n";
        mostlyLf += lineIndex === loneIndex ? "\r\n" : "\n";
      }
    }
    const mostlyCrlfBytes = Buffer.from(mostlyCrlf, "utf8");
    if (sha256(mostlyCrlfBytes) === expectedSha256) return mostlyCrlfBytes;
    const mostlyLfBytes = Buffer.from(mostlyLf, "utf8");
    if (sha256(mostlyLfBytes) === expectedSha256) return mostlyLfBytes;
  }
  return undefined;
}

function requirementActionId(prefix: string, logicalId: string): string {
  return `${prefix}-${canonicalSha256({ prefix, logicalId }).slice(0, 20)}`;
}

function mappingDatasetId(
  requirement: RestorePlanRequirement,
  prefix: string,
  mappings: Readonly<Record<string, string>>,
): string {
  const matches = Object.keys(mappings).filter((logicalId) =>
    requirementActionId(prefix, logicalId) === requirement.requirementId
  );
  if (matches.length !== 1) {
    return error("MAPPING_NOT_FOUND", requirement, `expected exactly one ${prefix} mapping`);
  }
  const datasetId = matches[0]!;
  if (mappings[datasetId]!.trim().length === 0) {
    return error("MAPPING_NOT_FOUND", requirement, `${datasetId} maps to an empty runtime id`);
  }
  return datasetId;
}

function safeManifestPath(
  requirement: RestorePlanRequirement,
  root: string,
  manifestPath: string,
): string {
  if (!manifestPath || isAbsolute(manifestPath) || manifestPath.includes("\\")
    || manifestPath.split("/").some((part) => part === ".." || part === "")) {
    return error("SKILL_PACKAGE_INVALID", requirement, `unsafe manifest path ${manifestPath}`);
  }
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, ...manifestPath.split("/"));
  const rel = relative(rootPath, filePath);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    return error("SKILL_PACKAGE_INVALID", requirement, `manifest path escapes package root`);
  }
  return filePath;
}

async function loadMatchingSkillPackage(
  requirement: RestorePlanRequirement,
  roots: readonly string[],
  runtimeSkillNamesByFormalAssetId: Readonly<Record<string, string>>,
  runtimeSkillDescriptionsByFormalAssetId: Readonly<Record<string, string>>,
): Promise<Readonly<{
  values: Readonly<Record<string, unknown>>;
  evidence: unknown;
}>> {
  const manifest = requirement.manifest;
  if (!requirement.formalAssetId || !manifest?.length) {
    return error("SKILL_PACKAGE_INVALID", requirement, "formalAssetId and manifest are required");
  }
  const entry = manifest.find((item) => item.path === "SKILL.md");
  if (!entry) return error("SKILL_PACKAGE_INVALID", requirement, "manifest must contain SKILL.md");

  const findPackage = async (allowSingleMixedNewline: boolean): Promise<Readonly<{
    rootIndex: number;
    files: readonly Readonly<{ path: string; bytes: Buffer }>[];
  }> | undefined> => {
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
      const root = roots[rootIndex]!;
      const files: Array<{ path: string; bytes: Buffer }> = [];
      let matched = true;
      for (const item of manifest) {
        try {
          const checkoutBytes = await readFile(safeManifestPath(requirement, root, item.path));
          const bytes = manifestMatchedBytes(
            checkoutBytes,
            item.sha256,
            allowSingleMixedNewline,
          );
          if (!bytes) {
            matched = false;
            break;
          }
          files.push({ path: item.path, bytes });
        } catch (cause) {
          if (cause instanceof ServerTeamRequirementError) throw cause;
          matched = false;
          break;
        }
      }
      if (matched) return { rootIndex, files };
    }
    return undefined;
  };

  // Uniform LF/CRLF covers normal Git checkout conversion. The second pass is
  // only for an authoring worktree that froze one opposite newline in a file.
  const matchedPackage = await findPackage(false) ?? await findPackage(true);
  if (matchedPackage) {
    const { rootIndex, files } = matchedPackage;

    const entryFile = files.find((file) => file.path === "SKILL.md")!;
    if (!isUtf8(entryFile.bytes)) {
      return error("SKILL_PACKAGE_INVALID", requirement, "SKILL.md must be UTF-8");
    }
    const sourceEntry = entryFile.bytes.toString("utf8");
    const frontmatter = /^---(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)---(?:\r\n|\n|\r|$)/u.exec(sourceEntry);
    if (!frontmatter) {
      return error("SKILL_PACKAGE_INVALID", requirement, "SKILL.md must start with YAML frontmatter");
    }
    const namePattern = /^(name:[ \t]*)([^\r\n]*)(\r\n|\n|\r|$)/gmu;
    const nameMatches = [...frontmatter[1]!.matchAll(namePattern)];
    if (nameMatches.length !== 1) {
      return error("SKILL_PACKAGE_INVALID", requirement, "SKILL.md frontmatter must contain exactly one name");
    }
    const sourceNameValue = nameMatches[0]![2]!.trim();
    const sourceFrontmatterName = (
      (sourceNameValue.startsWith('"') && sourceNameValue.endsWith('"'))
      || (sourceNameValue.startsWith("'") && sourceNameValue.endsWith("'"))
    ) ? sourceNameValue.slice(1, -1) : sourceNameValue;
    const runtimeFrontmatterName = runtimeSkillNamesByFormalAssetId[requirement.formalAssetId]
      ?? sourceFrontmatterName;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(runtimeFrontmatterName)) {
      return error(
        "SKILL_PACKAGE_INVALID",
        requirement,
        `runtime Skill name is not a lowercase hyphenated identifier`,
      );
    }
    const parsedFrontmatter = parseYaml(frontmatter[1]!) as Record<string, unknown> | null;
    const sourceDescription = typeof parsedFrontmatter?.description === "string"
      ? parsedFrontmatter.description
      : "";
    if (!sourceDescription) {
      return error("SKILL_PACKAGE_INVALID", requirement, "SKILL.md frontmatter has no description");
    }
    const descriptionNeedsNormalization = sourceDescription.length > 1024;
    const runtimeDescription = descriptionNeedsNormalization
      ? runtimeSkillDescriptionsByFormalAssetId[requirement.formalAssetId]
      : sourceDescription;
    if (!runtimeDescription || runtimeDescription.length > 1024) {
      return error(
        "SKILL_PACKAGE_INVALID",
        requirement,
        "runtime Skill description must contain 1..1024 characters",
      );
    }
    const nameNormalizedEntry = runtimeFrontmatterName === sourceFrontmatterName
      ? sourceEntry
      : `${frontmatter[0].replace(
          namePattern,
          (_line, prefix: string, _value: string, ending: string) =>
            `${prefix}${runtimeFrontmatterName}${ending}`,
        )}${sourceEntry.slice(frontmatter[0].length)}`;
    let runtimeEntry = nameNormalizedEntry;
    if (descriptionNeedsNormalization) {
      const runtimeFrontmatter = {
        ...(parsedFrontmatter ?? {}),
        name: runtimeFrontmatterName,
        description: runtimeDescription,
      };
      const runtimeYaml = stringifyYaml(runtimeFrontmatter).replace(/\n+$/u, "");
      runtimeEntry = `---\n${runtimeYaml}\n---\n${sourceEntry.slice(frontmatter[0].length)}`;
    }
    const resources = files
      .filter((file) => file.path !== "SKILL.md")
      .map((file) => isUtf8(file.bytes)
        ? {
          path: file.path,
          content: file.bytes.toString("utf8"),
          encoding: "utf-8" as const,
        }
        : {
          path: file.path,
          content: file.bytes.toString("base64"),
          encoding: "base64" as const,
        });
    return {
      values: {
        verified_skill_entry_content: runtimeEntry,
        verified_skill_resources: resources,
      },
      evidence: {
        formalAssetId: requirement.formalAssetId,
        manifestEntries: manifest.length,
        matchedRootIndex: rootIndex,
        manifestSha256: canonicalSha256(manifest),
        sourceEntrySha256: sha256(entryFile.bytes),
        runtimeEntrySha256: sha256(Buffer.from(runtimeEntry, "utf8")),
        sourceFrontmatterName,
        runtimeFrontmatterName,
        frontmatterNameNormalized: sourceFrontmatterName !== runtimeFrontmatterName,
        sourceDescriptionLength: sourceDescription.length,
        runtimeDescriptionLength: runtimeDescription.length,
        sourceDescriptionSha256: sha256(Buffer.from(sourceDescription, "utf8")),
        runtimeDescriptionSha256: sha256(Buffer.from(runtimeDescription, "utf8")),
        frontmatterDescriptionNormalized: descriptionNeedsNormalization,
      },
    };
  }

  return error("SKILL_PACKAGE_NOT_FOUND", requirement, "no candidate root matches the frozen manifest");
}

function resolvedMemoryImport(
  requirement: RestorePlanRequirement,
  resolveValue: <T>(value: T) => T,
): ServerTeamMemoryImportInput {
  if (!requirement.formalAssetId || !requirement.expectedAssetContentHash
    || !requirement.runtimeIsolation || !requirement.importPayload) {
    return error(
      "INVALID_REQUIREMENT",
      requirement,
      "memory import requires asset id, expected hash, isolation, and payload",
    );
  }
  const isolation = resolveValue(requirement.runtimeIsolation) as unknown;
  const payload = resolveValue(requirement.importPayload) as unknown;
  if (!isRecord(isolation) || typeof isolation.team_id !== "string"
    || typeof isolation.user_id !== "string" || typeof isolation.agent_id !== "string"
    || !isRecord(payload)) {
    return error("INVALID_REQUIREMENT", requirement, "resolved memory import shape is invalid");
  }
  return {
    requirementId: requirement.requirementId,
    formalAssetId: requirement.formalAssetId,
    expectedAssetContentHash: requirement.expectedAssetContentHash,
    isolation: {
      team_id: isolation.team_id,
      user_id: isolation.user_id,
      agent_id: isolation.agent_id,
    },
    payload,
  };
}

/** Build the six-kind plan resolver; Knowledge snapshots are intentionally absent in R05 plans. */
export function createServerTeamRequirementResolver(
  config: ServerTeamRequirementResolverConfig,
): ProductionRestoreRequirementResolver {
  return async (requirement, context) => {
    if (requirement.kind === "space_service_mapping") {
      const datasetId = mappingDatasetId(
        requirement,
        "require-space-service",
        config.serviceIdsByDatasetSpaceId,
      );
      return {
        values: {},
        evidence: { mapping: "space_service", datasetId, verified: true },
      };
    }
    if (requirement.kind === "auth_user_mapping") {
      const datasetId = mappingDatasetId(
        requirement,
        "require-auth-user",
        config.authUserIdsByDatasetUserId,
      );
      return {
        values: {},
        evidence: { mapping: "auth_user", datasetId, verified: true },
      };
    }
    if (requirement.kind === "skill_package_bytes") {
      return loadMatchingSkillPackage(
        requirement,
        config.skillPackageRoots,
        config.runtimeSkillNamesByFormalAssetId ?? {},
        config.runtimeSkillDescriptionsByFormalAssetId ?? {},
      );
    }
    if (requirement.kind === "memory_l1_import") {
      return {
        values: {},
        evidence: await config.importMemoryL1(resolvedMemoryImport(requirement, context.resolve)),
      };
    }
    if (requirement.kind === "memory_l2_import") {
      return {
        values: {},
        evidence: await config.importMemoryL2(resolvedMemoryImport(requirement, context.resolve)),
      };
    }
    return error(
      "OBSOLETE_KNOWLEDGE_REQUIREMENT",
      requirement,
      "R05 restores a real Knowledge shell because frozen snapshot bytes do not exist",
    );
  };
}
