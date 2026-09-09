import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { buildFinal5CampaignPlan } from "./final5-campaign-builder.js";
import { loadFinal5Dataset } from "./final5-formal-datasource.js";
import { buildFinal5RestoreBundle } from "./formal-assets/final5-restore-bundle.js";
import { restoreFinal5Memories } from "./formal-assets/restore-final5-memories.js";
import { restoreFinal5Skills } from "./formal-assets/restore-final5-skills.js";
import { installFinal5SkillPool } from "./final5-skill-pool.js";
import { installManagedShutdown, requireFreePort, startManagedNode } from "./managed-eval-process.js";
import { readDualClientConfig, resolveConfigPath } from "./dual-client-plan.js";
import { managedEnvironment } from "./managed-eval-config.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const tsx = resolve(here, "../../node_modules/tsx/dist/cli.mjs");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const write = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

const configPathFields = ["baselineRoot", "v4Root", "proxyConfig", "envFile", "plan", "workspaceManifest", "teamsRoot", "skillCatalogBindings", "runtimeBindings", "assetRunRoot", "outputRoot"] as const;

export function readTest1kConfig(output: string) {
  const config = read(join(output, "evaluation.json"));
  for (const field of configPathFields) {
    if (typeof config[field] === "string") config[field] = resolveConfigPath(output, config[field]);
  }
  return config;
}

export function prepareTest1k(output: string, corePort = 8427) {
  output = resolve(output);
  const within = relative(join(root, "runs"), output);
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("Use a new directory under runs/");
  if (existsSync(output)) throw new Error("Run directory already exists; use initialize/execute or choose a new directory");
  if (!Number.isSafeInteger(corePort) || corePort < 1024 || corePort > 65535 || [8096, 8097].includes(corePort)) throw new Error("Invalid or conflicting Core port");
  const source = join(here, "formal-dataset/final5/test1k");
  const dataset = loadFinal5Dataset(join(source, "teams"));
  const ids = readFileSync(join(source, "keep-case-ids.jsonl"), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line).case_id);
  if (dataset.teams.length !== 39 || dataset.records.length !== 1140 || ids.length !== 1140 || new Set(ids).size !== 1140) throw new Error("Expected final test1k: 39 teams and 1140 cases");
  const plan = buildFinal5CampaignPlan(dataset, "test1k-" + randomUUID(), ids);
  const original = new Map(read(join(here, "formal-dataset/final5/manifests/workspace-resolution-final5-manifest-v2.json")).map((row: any) => [row.caseId, row]));
  const manifest = dataset.records.map(record => {
    const row = original.get(record.case_id) as any;
    if (!row || row.teamId !== record.team_id) throw new Error("Missing repository mapping: " + record.case_id);
    return { caseId: record.case_id, teamId: record.team_id, repoId: row.repoId, repoUrl: row.repoUrl,
      baseSha: record.case.base_sha, clusterId: row.clusterId };
  });
  const bundle = buildFinal5RestoreBundle(join(source, "teams"), join(source, "skill-catalog"), join(source, "teams"));
  mkdirSync(join(output, "inputs"), { recursive: true });
  cpSync(join(source, "teams"), join(output, "inputs/test1k/teams"), { recursive: true });
  cpSync(join(source, "skill-catalog"), join(output, "inputs/test1k/skill-catalog"), { recursive: true });
  if (loadFinal5Dataset(join(output, "inputs/test1k/teams")).sourceDigest !== dataset.sourceDigest) throw new Error("Dataset changed during preparation");
  write(join(output, "inputs/campaign.json"), plan);
  write(join(output, "inputs/workspaces.json"), manifest);
  write(join(output, "inputs/restore-bundle.json"), bundle);
  const config = {
    baselineRoot: join(root, "implementations/baseline"), v4Root: join(root, "implementations/final"),
    proxyConfig: join(root, "evaluation/MemoryProxy/config.example.yaml"), envFile: join(root, "evaluation/.env"),
    plan: join(output, "inputs/campaign.json"), workspaceManifest: join(output, "inputs/workspaces.json"),
    teamsRoot: join(output, "inputs/test1k/teams"), skillCatalogBindings: join(output, "inputs/test1k/skill-catalog/case-skill-catalog.jsonl"),
    runtimeBindings: join(output, "runtime-bindings.json"), assetRunRoot: output, coreUrl: `http://127.0.0.1:${corePort}`,
    outputRoot: join(output, "execution"), timeoutMs: 480000, maxRetries: 0,
    clients: { codex: { concurrency: 5, providerKeyEnv: "TDAI_CODEX_PROVIDER_API_KEY" }, "claude-code": { concurrency: 5, providerKeyEnv: "TDAI_CLAUDE_PROVIDER_API_KEY" } },
  };
  const portableConfig = { ...config };
  for (const field of configPathFields) portableConfig[field] = relative(output, config[field]).replace(/\\/g, "/") || ".";
  write(join(output, "evaluation.json"), portableConfig);
  if (!existsSync(config.envFile)) cpSync(join(root, "evaluation/.env.example"), config.envFile, { errorOnExist: true, force: false });
  return { config: join(output, "evaluation.json"), cases: ids.length, slotsPerClient: plan.slots.length, envFile: config.envFile };
}

async function runNode(args: string[], output: string, label: string, env: NodeJS.ProcessEnv) {
  const logs = join(output, "setup-logs");
  mkdirSync(logs, { recursive: true });
  const prefix = join(logs, label + "-" + randomUUID());
  const child = startManagedNode({ args, cwd: root, env, stdout: prefix + ".stdout.log", stderr: prefix + ".stderr.log" });
  try {
    const code = await child.done;
    for (const line of readFileSync(prefix + ".stdout.log", "utf8").split(/\r?\n/)) {
      if (line.startsWith('{"action":"execution-summary"')) console.log(line);
    }
    if (code !== 0) throw new Error(`${label} failed; see ${prefix}.stderr.log`);
  }
  finally { await child.stop(); }
}

async function withCore(output: string, initialize: boolean, action: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const config = readTest1kConfig(output);
  if (resolve(config.assetRunRoot) !== output) throw new Error("Asset directory does not match this run");
  const url = new URL(config.coreUrl);
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Expected local Core URL");
  await requireFreePort(Number(url.port));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(TDAI_|FINAL5_|DS_)/i.test(name)));
  const env = { ...inherited, E2E_API_KEY: "sdk-e2e-token", FINAL5_RESTORE_AUTH_TOKEN: "sdk-e2e-token", TDAI_CORE_GATEWAY_API_KEY: "sdk-e2e-token", TDAI_SKILL_ENABLED: "true", FINAL5_ASSET_IMPORT: initialize ? "1" : "0" };
  const logs = join(output, "setup-logs");
  mkdirSync(logs, { recursive: true });
  const prefix = join(logs, "core-" + randomUUID());
  const core = startManagedNode({ args: [tsx, join(root, "scripts/start-final5-core.mjs"), output, url.port], cwd: root, env, stdout: prefix + ".stdout.log", stderr: prefix + ".stderr.log" });
  try {
    const deadline = Date.now() + 300000;
    console.log(JSON.stringify({ phase: "core-starting", log: prefix + ".stdout.log" }));
    while (true) {
      if (core.exited) throw new Error(`Core exited; see ${prefix}.stderr.log`);
      if (existsSync(prefix + ".stdout.log") && readFileSync(prefix + ".stdout.log", "utf8").split(/\r?\n/).some(line => { try { return JSON.parse(line).ready === true; } catch { return false; } })) break;
      if (Date.now() > deadline) throw new Error(`Core readiness timed out; see ${prefix}.stderr.log`);
      await new Promise(done => setTimeout(done, 200));
    }
    await action(env);
  } finally { await core.stop(); }
}

export async function initializeTest1k(output: string) {
  const config = readTest1kConfig(output);
  await withCore(output, true, async env => {
    // Import routines share the explicit local gateway token with the owned Core.
    const previous = process.env.FINAL5_RESTORE_AUTH_TOKEN;
    process.env.FINAL5_RESTORE_AUTH_TOKEN = env.FINAL5_RESTORE_AUTH_TOKEN;
    try {
      console.log(JSON.stringify(await restoreFinal5Memories(output, config.coreUrl)));
      console.log(JSON.stringify(await restoreFinal5Skills(output, config.coreUrl)));
    } finally { if (previous === undefined) delete process.env.FINAL5_RESTORE_AUTH_TOKEN; else process.env.FINAL5_RESTORE_AUTH_TOKEN = previous; }
    const digest = read(config.plan).datasetDigest;
    await runNode([join(root, "scripts/build-final5-runtime-bindings.mjs"), output, digest], output, "bindings", env);
    await runNode([join(root, "scripts/create-final5-runtime-tasks.mjs"), output, config.coreUrl], output, "tasks", env);
    installFinal5SkillPool(output, config.coreUrl);
    writeFileSync(join(output, "initialized.json"), JSON.stringify({ datasetDigest: digest, bundleSha256: read(join(output, "inputs/restore-bundle.json")).bundleSha256, ready: true }, null, 2));
  });
  console.log(JSON.stringify({ initialized: true, output }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installManagedShutdown();
  const [mode, directory, port = "8427", client = "both", variant = "both", bundleDirectory = join(root, "workspaces"), caseId] = process.argv.slice(2);
  if (!directory || !["prepare", "initialize", "check", "execute"].includes(mode)) throw new Error("Use prepare|initialize|check|execute <run-directory> [core-port] [client] [variant] [bundle-directory]");
  const output = resolve(directory);
  if (mode === "prepare") console.log(JSON.stringify(prepareTest1k(output, Number(port)), null, 2));
  else if (mode === "initialize") await initializeTest1k(output);
  else {
    if (!["both", "codex", "claude-code"].includes(client) || !["both", "baseline", "V4"].includes(variant)) throw new Error("Invalid client or variant");
    const config = readTest1kConfig(output);
    const validated = readDualClientConfig(join(output, "evaluation.json"));
    for (const selected of client === "both" ? ["codex", "claude-code"] as const : [client] as ("codex" | "claude-code")[]) {
      const environment = managedEnvironment(validated, selected);
      if (environment.FINAL5_PROVIDER_API_KEY === "replace-me") throw new Error("Fill the provider settings in " + validated.envFile + " for " + selected);
    }
    const receipt = read(join(output, "initialized.json"));
    if (!receipt.ready || receipt.datasetDigest !== loadFinal5Dataset(config.teamsRoot).sourceDigest || receipt.bundleSha256 !== read(join(output, "inputs/restore-bundle.json")).bundleSha256) throw new Error("Inputs changed; prepare a new run");
    const local = join(output, "bound-" + randomUUID());
    let inputConfig = join(output, "evaluation.json");
    if (caseId) {
      const caseIds = caseId.split(",").map((id) => id.trim()).filter(Boolean);
      if (!caseIds.length) throw new Error("CaseId must contain at least one Case ID");
      const plan = buildFinal5CampaignPlan(loadFinal5Dataset(config.teamsRoot), "selected-cases-" + randomUUID(), caseIds);
      mkdirSync(local, { recursive: true });
      const planPath = join(local, "selected-plan.json");
      write(planPath, plan);
      inputConfig = join(local, "selected-config.json");
      write(inputConfig, { ...config, plan: planPath });
    }
    await runNode([join(root, "scripts/workspace-bundle.mjs"), "auto", "--config", inputConfig, "--bundle", resolve(bundleDirectory), "--output", local], output, "workspaces", process.env);
    await withCore(output, false, async env => {
      const args = ["--use-env-proxy", tsx, join(here, "run-final5-dual.ts"), "--config", join(local, "evaluation.local.json"), "--" + mode, "--quick"];
      if (caseId) args.push("--fail-on-case-failure");
      if (client !== "both") args.push("--client", client);
      if (variant !== "both") args.push(variant === "V4" ? "--v4-only" : "--baseline-only");
      console.log(JSON.stringify({ mode, outputRoot: config.outputRoot, logs: join(output, "setup-logs") }));
      await runNode(args, output, mode, env);
    });
  }
}
