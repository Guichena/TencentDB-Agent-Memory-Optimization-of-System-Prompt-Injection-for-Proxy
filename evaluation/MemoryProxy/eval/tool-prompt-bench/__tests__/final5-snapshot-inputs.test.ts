import { describe, expect, it, vi } from "vitest";
import { SkillInjector as BaselineSkillInjector } from "../../../../../implementations/baseline/MemoryProxy/src/injection/injectors/skill-injector.js";
import { SkillInjector as FinalSkillInjector } from "../../../../../implementations/final/MemoryProxy/src/injection/injectors/skill-injector.js";

describe.each([
  ["baseline", BaselineSkillInjector],
  ["V4", FinalSkillInjector],
] as const)("%s frozen inputs", (_variant, Injector) => {
  it("preserves all eight frozen entries in prewarm and cache-miss execution", async () => {
    const catalog = {
      caseId: "case-1", catalogId: "catalog-1", catalogSha256: "a".repeat(64),
      skills: Array.from({ length: 8 }, (_, order) => ({
        order, runtimeSkillId: `id-${order}`, runtimeName: `skill-${order}`,
        description: `Frozen description ${order}`,
      })),
    };
    const client = { listListing: vi.fn(() => { throw new Error("Unexpected live listing"); }) };
    const injector = new Injector({ coreSkill: {} } as never, client as never);
    const prewarm = await injector.prewarm({
      frozenSkillCatalog: catalog, assetCapabilities: { skill: true },
    } as never);
    const fallback = await injector.execute({ metadata: { custom: {
      frozenSkillCatalog: catalog, assetCapabilities: { skill: true },
    } } } as never);
    expect(fallback).toEqual(prewarm);
    expect(prewarm).toHaveLength(1);
    for (const skill of catalog.skills) {
      expect(prewarm[0].content).toContain(`- ${skill.runtimeName}: ${skill.description}`);
    }
    expect(prewarm[0].metadata?.catalogSha256).toBe(catalog.catalogSha256);
    expect(client.listListing).not.toHaveBeenCalled();
  });
});
