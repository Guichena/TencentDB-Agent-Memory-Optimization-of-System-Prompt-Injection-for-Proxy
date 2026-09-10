import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareTest1k } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/test1k-entry.js';
import { buildFinal5CampaignPlan } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-campaign-builder.js';
import { loadFinal5Dataset } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-formal-datasource.js';
import { sourceFingerprint as fingerprintSource } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/managed-eval-config.js';
import { acquireProcessLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
import { createHash } from 'node:crypto';
import { ATTEMPT_POLICY } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/attempt-policy.js';

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const [mode, ...args] = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--dataset', '--client', '--concurrency', '--variant', '--run', '--case', '--core-port', '--bundle','--retry-plan'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Unknown or missing option: ' + args[i]);
  if (options[args[i]]) throw Error('Duplicate option: ' + args[i]);
  options[args[i]] = args[i + 1];
}
if (!['prepare', 'initialize', 'check', 'run','retry'].includes(mode)) throw Error('Use prepare|initialize|check|run|retry; retry additionally requires --retry-plan <audit retry.json>');
const client = options['--client'];
if (!['codex', 'claude-code'].includes(client)) throw Error('Choose exactly one client: codex or claude-code');
const requestedConcurrency = options['--concurrency'] === undefined ? undefined : Number(options['--concurrency']);
if (requestedConcurrency !== undefined && (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 10)) throw Error('Concurrency must be 1..10');
const datasetName = options['--dataset'];
if (!['first250', 'full1140'].includes(datasetName)) throw Error('Choose --dataset first250|full1140');
const name = options['--run'] ?? datasetName + '-' + client;
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Run name must contain only letters, digits, underscore or hyphen');
let variant = options['--variant'] ?? 'both';
if (!['both', 'baseline', 'V4'].includes(variant)) throw Error('Invalid variant');
const selected = read(join(root, 'datasets', datasetName, 'selection.json'));
let caseId = options['--case'];
if (caseId && !selected.caseIds.includes(caseId)) throw Error('Case is outside the frozen selection');
const output = join(source, 'runs', name);
const configFile = join(output, 'evaluation.json');
const bundle = resolve(source, options['--bundle'] ?? 'workspaces');
const lock = join(root, '.operation.lock');
const tsx = join(source, 'evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs');
if(mode==='retry'){
  if(!options['--retry-plan']||caseId)throw Error('retry requires --retry-plan and forbids --case');
  const manifest=read(resolve(source,options['--retry-plan']));const {sha256,...body}=manifest;
  if(createHash('sha256').update(JSON.stringify(body)).digest('hex')!==sha256)throw Error('Retry plan was modified');
  if(manifest.policy!==ATTEMPT_POLICY||manifest.runName!==name||manifest.client!==client||manifest.datasetDigest!==selected.parentDatasetDigest)throw Error('Retry plan identity/policy mismatch');
  if(!['server_team','V4'].includes(manifest.variant))throw Error('Invalid retry variant');
  variant=manifest.variant==='server_team'?'baseline':'V4';
  if(options['--variant']&&options['--variant']!==variant)throw Error('Retry variant differs from audit');
  if(!Array.isArray(manifest.retryCaseIds)||new Set(manifest.retryCaseIds).size!==manifest.retryCaseIds.length||manifest.retryCaseIds.some((id:string)=>!selected.caseIds.includes(id)))throw Error('Invalid retry case selection');
  if(!manifest.retryCaseIds.length){console.log('No cases need rerunning.');process.exit(0);}
  const execution=join(output,'execution');
  const currentRuns=readdirSync(execution).filter(dir=>dir.startsWith('quick-')&&existsSync(join(execution,dir,client,manifest.variant))).map(dir=>join(execution,dir)).sort();
  if(JSON.stringify(currentRuns)!==JSON.stringify([...manifest.sourceRuns].sort()))throw Error('New runs exist since this audit. Run audit again before retrying; completed cases must not be rerun.');
  caseId=manifest.retryCaseIds.join(',');
}else if(options['--retry-plan'])throw Error('--retry-plan requires retry mode');
function runNode(argv: string[]) {
  const result = spawnSync(process.execPath, argv, { cwd: source, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Command failed: ' + (result.signal ?? result.status));
}
// All clients and run directories share the same ports; prevent simultaneous invocations.
const releaseLock=acquireProcessLock(lock,{client,mode,name});
try {
  runNode([tsx, join(root, 'verify.ts')]);
  if (mode === 'prepare') {
    if (!existsSync(join(source, 'evaluation/.env'))) throw Error('Run setup and fill evaluation/.env first');
    prepareTest1k(output, Number(options['--core-port'] ?? 18427));
    const dataset = loadFinal5Dataset(join(output, 'inputs/test1k/teams'));
    if (dataset.sourceDigest !== selected.parentDatasetDigest) throw Error('Parent dataset digest changed');
    const plan = buildFinal5CampaignPlan(dataset, 'linux-' + datasetName + '-' + client, selected.caseIds);
    writeFileSync(join(output, 'inputs/campaign.json'), JSON.stringify(plan, null, 2) + '\n');
    const rows = read(join(output, 'inputs/workspaces.json')).filter((row: any) => selected.caseIds.includes(row.caseId));
    if (rows.length !== selected.caseIds.length) throw Error('Workspace selection mismatch');
    writeFileSync(join(output, 'inputs/workspaces.json'), JSON.stringify(rows, null, 2) + '\n');
    writeFileSync(join(output, 'client.json'), JSON.stringify({ client, dataset: datasetName }));
    console.log(JSON.stringify({ prepared: output, cases: selected.caseIds.length, client, dataset: datasetName }));
  } else if (read(join(output, 'client.json')).client !== client || read(join(output, 'client.json')).dataset !== datasetName) throw Error('Run belongs to a different client/dataset');
  const config = read(configFile);
  const concurrency = requestedConcurrency ?? config.clients[client].concurrency;
  config.clients[client].concurrency = concurrency;
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  if (mode !== 'prepare') {
    const provenance = { recordedAt: new Date().toISOString(), dataset: datasetName, client, concurrency, variant, caseId: caseId ?? null, baseline: fingerprintSource(join(source, 'implementations/baseline')), v4: fingerprintSource(join(source, 'implementations/final')), platform: process.platform, node: process.version };
    mkdirSync(join(output, 'linux-provenance'), { recursive: true });
    writeFileSync(join(output, 'linux-provenance', Date.now() + '.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
    // The fixed plan contains only the chosen dataset. Smoke uses a temporary child plan.
    runNode([tsx, join(source, 'evaluation/MemoryProxy/eval/tool-prompt-bench/test1k-entry.ts'),
      mode === 'run' || mode === 'retry' ? 'execute' : mode, output, '18427', client, variant, bundle, ...(caseId ? [caseId] : [])]);
  }
} finally { releaseLock(); }
