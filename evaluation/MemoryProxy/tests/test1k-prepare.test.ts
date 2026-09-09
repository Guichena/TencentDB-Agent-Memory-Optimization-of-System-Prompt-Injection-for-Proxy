import { readFileSync, rmSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { prepareTest1k, readTest1kConfig } from "../eval/tool-prompt-bench/test1k-entry.js";
import { loadFinal5Dataset } from "../eval/tool-prompt-bench/final5-formal-datasource.js";
import { loadSkillCatalogCoverage } from "../eval/tool-prompt-bench/final5-workspace-manifest.js";

it("prepares the complete final dataset with portable repository bindings and an isolated asset store", () => {
  const output = fileURLToPath(new URL("../../../runs/test1k-test-" + randomUUID(), import.meta.url));
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  try {
    const result = prepareTest1k(output, 18427);
    const rawConfig = read(result.config);
    expect(rawConfig.assetRunRoot).toBe(".");
    expect(rawConfig.plan).toBe("inputs/campaign.json");
    const config = readTest1kConfig(output);
    const plan = read(config.plan);
    const dataset = loadFinal5Dataset(config.teamsRoot);
    const rows = read(config.workspaceManifest);
    expect(result.cases).toBe(1140);
    expect(plan.slots).toHaveLength(2280);
    expect(plan.datasetDigest).toBe(dataset.sourceDigest);
    expect(loadSkillCatalogCoverage(config.skillCatalogBindings, plan.selectedCaseIds).valid).toBe(true);
    expect(rows).toHaveLength(1140);
    for (const record of dataset.records) {
      const row = rows.find((item: any) => item.caseId === record.case_id);
      expect(row.baseSha).toBe(record.case.base_sha);
      expect(row.repositoryPath).toBeUndefined();
      expect(row.repoUrl).toMatch(/^https:\/\//);
    }
    const bundle = read(join(output, "inputs/restore-bundle.json"));
    expect(bundle.identities).toHaveLength(39);
    expect(bundle.skills.length).toBeGreaterThan(0);
    expect(bundle.skills.flatMap((skill: any) => skill.resources).length).toBeGreaterThan(0);
    expect(bundle.cases).toBeUndefined();
    expect(config.assetRunRoot).toBe(output);
    expect(config.runtimeBindings).toBe(join(output, "runtime-bindings.json"));
    expect(config.coreUrl).toBe("http://127.0.0.1:18427");
    const relocated = mkdtempSync(join(tmpdir(), "test1k moved "));
    try {
      const movedOutput = join(relocated, "runs", "experiment");
      mkdirSync(movedOutput, { recursive: true });
      copyFileSync(result.config, join(movedOutput, "evaluation.json"));
      const moved = readTest1kConfig(movedOutput);
      expect(moved.assetRunRoot).toBe(movedOutput);
      expect(moved.plan).toBe(join(movedOutput, "inputs", "campaign.json"));
      expect(moved.baselineRoot).toBe(resolve(relocated, "implementations/baseline"));
      expect(moved.envFile).toBe(resolve(relocated, "evaluation/.env"));
    } finally { rmSync(relocated, { recursive: true, force: true }); }
    expect(() => prepareTest1k(output)).toThrow(/already exists/);
  } finally { rmSync(output, { recursive: true, force: true }); }
}, 30000);
