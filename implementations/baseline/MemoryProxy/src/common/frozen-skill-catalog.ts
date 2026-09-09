export const FROZEN_SKILL_CATALOG_HEADER = "x-tdai-skill-catalog" as const;

export interface FrozenSkillCatalogEntry {
  order: number;
  runtimeSkillId: string;
  runtimeName: string;
  description: string;
}

export interface FrozenSkillCatalogPayload {
  caseId: string;
  catalogId: string;
  catalogSha256: string;
  skills: FrozenSkillCatalogEntry[];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be non-empty`);
  return value.trim();
}

export function validateFrozenSkillCatalog(value: unknown): FrozenSkillCatalogPayload {
  if (!value || typeof value !== "object") throw new Error("frozen Skill catalog must be an object");
  const row = value as Record<string, unknown>;
  const caseId = requiredText(row.caseId, "caseId");
  const catalogId = requiredText(row.catalogId, "catalogId");
  const catalogSha256 = requiredText(row.catalogSha256, "catalogSha256");
  if (!/^[0-9a-f]{64}$/iu.test(catalogSha256)) throw new Error("catalogSha256 must be a SHA-256 hex digest");
  if (!Array.isArray(row.skills) || row.skills.length === 0 || row.skills.length > 8) {
    throw new Error("frozen Skill catalog must contain 1..8 skills");
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const skills = row.skills.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`skills[${index}] must be an object`);
    const skill = item as Record<string, unknown>;
    if (skill.order !== index) throw new Error(`skills[${index}].order must equal ${index}`);
    const runtimeSkillId = requiredText(skill.runtimeSkillId, `skills[${index}].runtimeSkillId`);
    const runtimeName = requiredText(skill.runtimeName, `skills[${index}].runtimeName`);
    const description = requiredText(skill.description, `skills[${index}].description`);
    if (seenIds.has(runtimeSkillId)) throw new Error(`duplicate runtimeSkillId: ${runtimeSkillId}`);
    if (seenNames.has(runtimeName)) throw new Error(`duplicate runtimeName: ${runtimeName}`);
    seenIds.add(runtimeSkillId);
    seenNames.add(runtimeName);
    return { order: index, runtimeSkillId, runtimeName, description };
  });
  return { caseId, catalogId, catalogSha256: catalogSha256.toLowerCase(), skills };
}

export function encodeFrozenSkillCatalog(value: FrozenSkillCatalogPayload): string {
  return Buffer.from(JSON.stringify(validateFrozenSkillCatalog(value)), "utf8").toString("base64url");
}

export function decodeFrozenSkillCatalog(value: string | undefined): FrozenSkillCatalogPayload | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`invalid frozen Skill catalog header: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateFrozenSkillCatalog(parsed);
}
