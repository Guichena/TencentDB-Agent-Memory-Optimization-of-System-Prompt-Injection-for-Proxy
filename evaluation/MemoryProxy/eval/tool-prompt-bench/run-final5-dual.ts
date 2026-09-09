import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { readDualClientConfig, clientStagePaths, type DualClientConfig } from "./dual-client-plan.js";
import { sourceFingerprint, sourceContractProblems, managedEnvironment, managedProxyConfig } from "./managed-eval-config.js";
import { startManagedNode, requireFreePort, waitManagedHealth, installManagedShutdown } from "./managed-eval-process.js";
import { executionHash } from "./execution-checkpoint.js";
import { mergeStageReceipts, verifyStageReceipt } from "./merge-stage-receipts.js";
import type { Final5Client } from "./final5-task-input.js";
import { collectFinal5Evidence } from "./collect-final5-evidence.js";

const here = dirname(fileURLToPath(import.meta.url));
const proxyPackage = resolve(here, "../..");
const tsx = resolve(proxyPackage, "node_modules/tsx/dist/cli.mjs");
const clients: Final5Client[] = ["codex", "claude-code"];
const stages = ["server_team", "V4"] as const;
const quickRun = () => process.env.FINAL5_QUICK === "1";
const fingerprintSource = (source: string) => quickRun() ? undefined : sourceFingerprint(source);
type Stage = typeof stages[number];

export async function runClientStages(client: Final5Client, execute: (client: Final5Client, variant: Stage) => Promise<void>, baselineOnly = false, v4Only = false) {
  const selectedStages = v4Only ? stages.slice(1) : baselineOnly ? stages.slice(0, 1) : stages;
  for (const variant of selectedStages) await execute(client, variant);
}
export async function runIndependentClients(run: (client: Final5Client) => Promise<void>) {
  const results = await Promise.allSettled(clients.map(run));
  const errors = results.flatMap((result, i) => result.status === "rejected" ? [clients[i] + ": " + String(result.reason)] : []);
  if (errors.length) throw new Error(errors.join("\n"));
}
function checkSourceContracts(config: DualClientConfig) {
  for (const source of [config.baselineRoot, config.v4Root]) {
    const missing = sourceContractProblems(source);
    if (missing.length) throw new Error("Proxy source is not evaluation-ready: " + source + "; missing " + missing.join(", "));
  }
}
function experimentDescriptor(config: DualClientConfig) {
  return { config, baseline: sourceFingerprint(config.baselineRoot), v4: sourceFingerprint(config.v4Root),
    captureAndScoring: ["../../contracts/runtime-tool-contracts.ts", "final5-skill-pool.ts", "final5-http-capture.ts", "final5-evidence.ts", "final5-gold-compiler.ts", "final5-provider-usage.ts", "collect-final5-evidence.ts", "final5-metrics-report.ts", "measurement-v2/scorer.ts"].map(name => executionHash(readFileSync(join(here, name), "utf8"))),
    inputs: [config.plan, config.workspaceManifest, config.skillCatalogBindings, config.proxyConfig, config.envFile, ...(config.runtimeBindings ? [config.runtimeBindings] : [])].map((file) => executionHash(readFileSync(file).toString("base64"))) };
}
async function runLane(config: DualClientConfig, client: Final5Client, mode: "check" | "execute", resume: boolean, baselineOnly: boolean, v4Only: boolean) {
  const item = config.clients[client];
  const env = managedEnvironment(config, client);
  const base = yaml.load(readFileSync(config.proxyConfig, "utf8"));
  if (config.coreUrl) {
    const runtime = base as any;
    runtime.coreSkill = { ...runtime.coreSkill, endpoint: config.coreUrl, serviceId: "default", timeoutMs: 30000 };
    runtime.tdai = { ...runtime.tdai, endpoint: config.coreUrl, serviceId: "default" };
    runtime.skill = { ...runtime.skill, endpoint: config.coreUrl, serviceId: "default", timeoutMs: 30000 };
    const coreGatewayToken = process.env.TDAI_CORE_GATEWAY_API_KEY ?? "sdk-e2e-token";
    runtime.auth = { ...runtime.auth, url: config.coreUrl, timeoutMs: 30000, gatewayApiKey: coreGatewayToken };
    runtime.coreSkill = { ...runtime.coreSkill, endpoint: config.coreUrl, serviceId: "default", serviceToken: coreGatewayToken, timeoutMs: 30000 };
    runtime.skill = { ...runtime.skill, endpoint: config.coreUrl, serviceId: "default", serviceToken: coreGatewayToken, timeoutMs: 30000 };
    runtime.knowledge = { ...runtime.knowledge, endpoint: config.coreUrl, serviceId: "default", serviceToken: coreGatewayToken, timeoutMs: 30000 };
  }
  const url = "http://127.0.0.1:" + item.port;
  const expectedSources = mode === "execute" ? JSON.parse(readFileSync(join(config.outputRoot, "experiment.json"), "utf8")).sourceFingerprints : { baseline: fingerprintSource(config.baselineRoot), v4: fingerprintSource(config.v4Root) };
  await runClientStages(client, async (_, variant) => {
    const paths = clientStagePaths(config, client, variant);
    if (existsSync(join(paths.root, "invalid.json"))) throw new Error("Stage was invalidated by source drift; use a new output root");
    if (mode === "execute" && existsSync(paths.receipt)) {
      if (!resume) throw new Error("Receipt exists; use --resume: " + paths.receipt);
      const receipt = JSON.parse(readFileSync(paths.receipt, "utf8"));
      verifyStageReceipt(receipt, variant);
      if (receipt.executionContext?.comparison.client !== client || receipt.executionContext?.comparison.model !== item.model || receipt.executionContext?.stage.variant !== variant) throw new Error("Completed receipt does not match lane");
      console.log(JSON.stringify({ client, variant, action: "reuse-completed", failed: receipt.failed }));
      return;
    }
    const source = variant === "V4" ? config.v4Root : config.baselineRoot;
    const fingerprint = fingerprintSource(source);
    if (fingerprint !== expectedSources[variant === "V4" ? "v4" : "baseline"]) throw new Error("Source changed after experiment was frozen");
    await requireFreePort(item.port);
    const logs = join(paths.root, "proxy-" + mode + "-" + randomUUID());
    mkdirSync(logs, { recursive: true });
    const effective = join(logs, "config.yaml");
    writeFileSync(effective, yaml.dump(managedProxyConfig(base, item.port, variant, env.FINAL5_UPSTREAM_URL!)), { flag: "wx" });
    const proxy = startManagedNode({ cwd: join(source, "MemoryProxy"), args: ["--import", "tsx/esm", "--import", new URL("./final5-http-capture.ts", import.meta.url).href, "src/index.ts", "--config", effective, "--experiment-read-only"],
      env: { ...env, FINAL5_CAPTURE_DIRECTORY: logs, TDAI_EVAL_TRACE_DIR: logs, TDAI_EVAL_CAMPAIGN_ID: client + "-" + variant + "-" + randomUUID(), TDAI_EVAL_TRACE_MODE: "1" },
      stdout: join(logs, "proxy.stdout.log"), stderr: join(logs, "proxy.stderr.log") });
    let runner: ReturnType<typeof startManagedNode> | undefined;
    try {
      const health = await waitManagedHealth(proxy, url, variant === "V4" ? "v4-compact" : "legacy");
      if (health.experimentReadOnly?.ready !== true || !health.serverInstanceId || !health.experimentConfigFingerprint) throw new Error("Proxy is not read-only or lacks fingerprints");
      const caps = health.evaluationCapabilities;
      if (client === "codex" ? !caps?.codexHistory || !caps?.codexFrozenSkills : !caps?.claudeFrozenSkills) throw new Error("Proxy lacks " + client + " input support");
      writeFileSync(join(logs, "startup.json"), JSON.stringify({ client, variant, model: item.model, pid: proxy.pid, sourceFingerprint: fingerprint, health }), { flag: "wx" });
      const stdout = join(logs, "runner.stdout.log"), stderr = join(logs, "runner.stderr.log");
      const childEnv = { ...env, FINAL5_CLIENT: client, FINAL5_MODEL: item.model, FINAL5_VARIANT: variant, FINAL5_PROXY: url,
        FINAL5_PLAN: config.plan, FINAL5_WORKSPACE_MANIFEST: config.workspaceManifest, FINAL5_TEAMS_ROOT: config.teamsRoot,
        FINAL5_SKILL_CATALOG_BINDINGS: config.skillCatalogBindings, FINAL5_RECEIPT: paths.receipt,
        ...(config.runtimeBindings ? { FINAL5_RUNTIME_BINDINGS: config.runtimeBindings } : {}),
        FINAL5_HTTP_EVENTS_DIR: logs,
        FINAL5_EXECUTION_WORKSPACE_ROOT: paths.workspaceRoot, FINAL5_CONCURRENCY: String(item.concurrency), FINAL5_SLOT_TIMEOUT_MS: String(config.timeoutMs),
        FINAL5_MAX_RETRIES: String(config.maxRetries), FINAL5_RESUME: resume ? "1" : "0", FINAL5_PREVIEW: mode === "check" ? "1" : "0",
        FINAL5_PROXY_SOURCE_SHA256: fingerprint, FINAL5_QUICK: quickRun() ? "1" : "0" };
      console.log(JSON.stringify({ client, variant, model: item.model, port: item.port, action: mode }));
      runner = startManagedNode({ cwd: proxyPackage, args: [tsx, join(here, "run-final5-native-campaign.ts")], env: childEnv, stdout, stderr });
      const exitCode = await runner.done;
      if (exitCode !== 0) throw new Error("Runner failed; see " + stderr);
      if (mode === "execute") {
        const failed = JSON.parse(readFileSync(paths.receipt, "utf8")).failed;
        if (failed > 0) console.log(JSON.stringify({ client, variant, action: "continue-after-infrastructure-failures", failed }));
      }
      if (!quickRun() && sourceFingerprint(source) !== fingerprint) {
        writeFileSync(join(paths.root, "invalid.json"), JSON.stringify({ reason: "source-changed-during-stage" }), { flag: "wx" });
        throw new Error("Proxy source changed during the stage; results require review");
      }
      console.log(JSON.stringify({ client, variant, action: "finished", receipt: mode === "execute" ? paths.receipt : null }));
    } finally {
      await runner?.stop();
      await proxy.stop();
    }
  }, baselineOnly, v4Only);
  if (mode === "execute" && !baselineOnly && !v4Only) {
    const baseline = JSON.parse(readFileSync(clientStagePaths(config, client, "server_team").receipt, "utf8"));
    const v4 = JSON.parse(readFileSync(clientStagePaths(config, client, "V4").receipt, "utf8"));
    const report = mergeStageReceipts(baseline, v4);
    const output = join(config.outputRoot, client, "paired.json");
    if (!existsSync(output)) writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    collectFinal5Evidence(config.teamsRoot, join(config.outputRoot, client), client, join(config.outputRoot, client, "report"));
  }
}

export async function runFinal5Dual(configPath: string, mode: "preview" | "check" | "execute", resume = false, baselineOnly = false, v4Only = false, clientOnly?: Final5Client) {
  const config = readDualClientConfig(configPath);
  if (baselineOnly && v4Only) throw new Error("Select baseline or V4, not both exclusive flags");
  if (quickRun() && resume) throw new Error("Quick runs always start fresh; omit --resume");
  if (quickRun()) config.outputRoot = join(config.outputRoot, "quick-" + randomUUID());
  const selectedClients = clientOnly ? [clientOnly] : clients;
  const descriptor = quickRun() ? { config, baseline: undefined, v4: undefined } : experimentDescriptor(config);
  if (mode === "preview") {
    console.log(JSON.stringify({ mode, clients: clientOnly ? { [clientOnly]: config.clients[clientOnly] } : config.clients, phasesPerClient: v4Only ? stages.slice(1) : baselineOnly ? stages.slice(0, 1) : stages, outputRoot: config.outputRoot,
      quick: quickRun(), sourceChecks: quickRun() ? "skipped" : { baseline: sourceContractProblems(config.baselineRoot), v4: sourceContractProblems(config.v4Root) } }, null, 2));
    return;
  }
  if (!quickRun()) checkSourceContracts(config);
  for (const client of selectedClients) managedEnvironment(config, client);
  await Promise.all(selectedClients.map((client) => requireFreePort(config.clients[client].port)));
  mkdirSync(config.outputRoot, { recursive: true });
  console.log(JSON.stringify({ outputRoot: config.outputRoot, quick: quickRun() }));
  const workerConfigPath = quickRun() ? join(config.outputRoot, "launch-config.json") : resolve(configPath);
  if (quickRun()) writeFileSync(workerConfigPath, JSON.stringify(config, null, 2));
  const lock = join(config.outputRoot, "controller.lock");
  if (resume && existsSync(lock)) {
    const pid = JSON.parse(readFileSync(lock, "utf8")).pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid controller lock");
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock); else throw error; }
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  try {
    if (mode === "execute") {
      const manifest = join(config.outputRoot, "experiment.json");
      const fingerprint = executionHash(descriptor);
      if (existsSync(manifest)) {
        if (!resume || JSON.parse(readFileSync(manifest, "utf8")).fingerprint !== fingerprint) throw new Error("Experiment exists or inputs changed; use a new output root");
      } else writeFileSync(manifest, JSON.stringify({ fingerprint, quick: quickRun(), config, sourceFingerprints: { baseline: descriptor.baseline, v4: descriptor.v4 } }, null, 2), { flag: "wx" });
    }
    // Separate OS processes prevent synchronous worktree preparation or environment changes in one lane blocking the other.
    await Promise.all(selectedClients.map(async (client) => {
      const logs = join(config.outputRoot, "workers", client + "-" + randomUUID());
      mkdirSync(logs, { recursive: true });
      const worker = startManagedNode({ cwd: proxyPackage, args: [tsx, fileURLToPath(import.meta.url), "--config", workerConfigPath, "--worker", client, "--" + mode, ...(resume ? ["--resume"] : []), ...(baselineOnly ? ["--baseline-only"] : []), ...(v4Only ? ["--v4-only"] : [])],
        env: { ...process.env }, stdout: join(logs, "stdout.log"), stderr: join(logs, "stderr.log") });
      try { if (await worker.done !== 0) throw new Error("Worker failed; see " + join(logs, "stderr.log")); }
      finally { await worker.stop(); }
    }));
  } finally { unlinkSync(lock); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installManagedShutdown();
  const value = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const config = value("--config");
  const worker = value("--worker");
  const mode = process.argv.includes("--execute") ? "execute" : process.argv.includes("--check") ? "check" : "preview";
  try {
    if (process.argv.includes("--quick")) process.env.FINAL5_QUICK = "1";
    if (!config) throw new Error("Usage: run-final5-dual.ts --config experiment.json [--check|--execute] [--resume]");
    const v4Only = process.argv.includes("--v4-only");
    const clientOnlyValue = value("--client");
    const clientOnly = clientOnlyValue === undefined ? undefined : clientOnlyValue as Final5Client;
    if (clientOnly !== undefined && !clients.includes(clientOnly)) throw new Error("Invalid --client; use codex or claude-code");
    if (worker) {
      if (!clients.includes(worker as Final5Client) || mode === "preview") throw new Error("Invalid internal worker invocation");
      await runLane(readDualClientConfig(config), worker as Final5Client, mode, process.argv.includes("--resume"), process.argv.includes("--baseline-only"), v4Only);
    } else await runFinal5Dual(config, mode, process.argv.includes("--resume"), process.argv.includes("--baseline-only"), v4Only, clientOnly);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
