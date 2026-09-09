import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repositoryInventory } from './prepare-workspaces.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = resolve(root, 'evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/manifests/workspace-resolution-final5-manifest-v2.json');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = path => {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { closeSync(fd); }
};
const git = (directory, args, timeout = 120000) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const key = row => `${row.repoId}@${row.baseSha}`;

export function portableRows(rows) {
  repositoryInventory(rows);
  return rows.map(({ caseId, teamId, repoId, repoUrl, baseSha, clusterId }) => ({ caseId, teamId, repoId, repoUrl, baseSha, clusterId }));
}

export function bundlePath(rootPath, value) {
  const path = resolve(rootPath, value);
  const rel = relative(resolve(rootPath), path);
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) throw new Error('Invalid bundle path');
  return path;
}

export function exportBundle(rows, bundleRoot) {
  const portable = portableRows(rows);
  mkdirSync(bundleRoot, { recursive: true });
  const indexPath = resolve(bundleRoot, 'bundle.json');
  const index = existsSync(indexPath) ? readJson(indexPath) : { schemaVersion: 'task1.workspace-bundle.v1', versions: [] };
  const versions = new Map(index.versions.map(item => [key(item), item]));
  const unique = new Map(rows.map(row => [key(row), row]));
  let number = 0;
  for (const [id, row] of unique) {
    number++;
    const old = versions.get(id);
    if (old && existsSync(bundlePath(bundleRoot, old.archive)) && digest(bundlePath(bundleRoot, old.archive)) === old.sha256) continue;
    const tree = git(row.repositoryPath, ['ls-tree', '-rz', row.baseSha]).split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t');
      const [mode, type, object] = entry.slice(0, tab).split(' ');
      return { mode, type, object, path: entry.slice(tab + 1) };
    });
    const archive = `archives/${row.repoId}/${row.baseSha}.zip`;
    const target = bundlePath(bundleRoot, archive);
    mkdirSync(dirname(target), { recursive: true });
    console.log(JSON.stringify({ exporting: number, total: unique.size, repoId: row.repoId, commit: row.baseSha }));
    git(row.repositoryPath, ['-c', 'core.protectNTFS=false', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
      'archive', '--format=zip', '-1', `--output=${target}.partial`, row.baseSha], 1800000);
    renameSync(`${target}.partial`, target);
    const item = { repoId: row.repoId, repoUrl: row.repoUrl, baseSha: row.baseSha, archive,
      sha256: digest(target), bytes: statSync(target).size, lfsPolicy: 'committed-pointers-no-download',
      submodules: tree.filter(entry => entry.mode === '160000').map(({ path, object }) => ({ path, commit: object })),
      windowsPathMappings: tree.filter(entry => entry.path.includes(':')).map(({ path }) => ({ original: path, extracted: path.replaceAll(':', '_') })),
      licenses: tree.map(entry => entry.path).filter(path => /(^|\/)(licen[cs]e|copying|notice)(\.|$)/i.test(path)) };
    versions.set(id, item);
    index.versions = [...versions.values()];
    writeFileSync(`${indexPath}.partial`, JSON.stringify(index, null, 2) + '\n');
    renameSync(`${indexPath}.partial`, indexPath);
    console.log(JSON.stringify({ exported: number, total: unique.size, repoId: row.repoId, commit: row.baseSha, bytes: item.bytes }));
  }
  writeFileSync(resolve(bundleRoot, 'workspace-manifest.portable.json'), JSON.stringify(portable, null, 2) + '\n');
  return index;
}

export function bindBundle(rows, bundleRoot, selectedIds) {
  repositoryInventory(rows);
  const index = readJson(resolve(bundleRoot, 'bundle.json'));
  const versions = new Map(index.versions.map(item => [key(item), item]));
  const selected = selectedIds ? new Set(selectedIds) : undefined;
  const wanted = rows.filter(row => !selected || selected.has(row.caseId));
  if (selected && wanted.length !== selected.size) throw new Error('Plan contains cases absent from workspace manifest');
  const prepared = new Map();
  for (const row of wanted) {
    const id = key(row);
    if (prepared.has(id)) continue;
    const item = versions.get(id);
    if (!item) throw new Error(`Missing bundled revision: ${id}`);
    const archive = bundlePath(bundleRoot, item.archive);
    const expanded = index.layout === 'expanded-sources-v1';
    if (!expanded && digest(archive) !== item.sha256) throw new Error(`Damaged workspace archive: ${id}`);
    const directory = bundlePath(bundleRoot, `sources/${row.repoId}/${row.baseSha}`);
    const evidence = bundlePath(bundleRoot, `receipts/${row.repoId}/${row.baseSha}.json`);
    if (expanded) {
      if (!existsSync(evidence) || JSON.stringify(readJson(evidence)) !== JSON.stringify(item)) throw new Error(`Missing or mismatched source receipt: ${id}`);
    }
    if (!existsSync(evidence)) {
      mkdirSync(directory, { recursive: true });
      execFileSync('tar', ['-xf', archive, '-C', directory], { windowsHide: true, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
      mkdirSync(dirname(evidence), { recursive: true });
      writeFileSync(evidence, JSON.stringify(item, null, 2) + '\n');
    }
    if (!existsSync(directory)) throw new Error(`Missing extracted source: ${directory}`);
    prepared.set(id, { directory, evidence });
  }
  return wanted.map(row => {
    const { directory, evidence } = prepared.get(key(row));
    return { ...portableRows([row])[0], repositoryPath: directory, sourceKind: 'plain-source-snapshot',
      isGitRepository: false, baseShaVerified: true, workspaceReady: true, resolutionStatus: 'resolved',
      resolutionReason: index.layout === 'expanded-sources-v1'
        ? 'Source directory from the recorded Git revision; bundled source receipt matched the version index.'
        : 'Exported from the recorded Git revision; source ZIP verified and extracted on this machine.',
      versionEvidence: { kind: 'git-archive', path: evidence, sha256: digest(evidence), sourceRevision: row.baseSha } };
  });
}

export function prepareBundleConfig(configPath, bundleRoot, outputDirectory, preserveOutputRoot = false) {
  const base = dirname(resolve(configPath));
  const config = readJson(configPath);
  for (const field of ['baselineRoot', 'v4Root', 'proxyConfig', 'envFile', 'plan', 'workspaceManifest', 'teamsRoot', 'skillCatalogBindings', 'runtimeBindings', 'assetRunRoot']) {
    if (config[field]) config[field] = resolve(base, config[field].replace(/\\/g, '/'));
  }
  const rows = readJson(config.workspaceManifest);
  const plan = readJson(config.plan);
  if (!Array.isArray(plan.selectedCaseIds) || !plan.selectedCaseIds.length) throw new Error('Plan must select at least one case');
  const bindings = bindBundle(rows, bundleRoot, plan.selectedCaseIds);
  const byId = new Map(bindings.map(row => [row.caseId, row]));
  const manifest = portableRows(rows).map(row => byId.get(row.caseId) ?? {
    ...row, repositoryPath: null, sourceKind: 'plain-source-snapshot', isGitRepository: false,
    baseShaVerified: false, workspaceReady: false, resolutionStatus: 'blocked',
    resolutionReason: 'Not selected by this plan; no local binding prepared.',
  });
  mkdirSync(outputDirectory, { recursive: true });
  config.workspaceManifest = resolve(outputDirectory, 'workspace-manifest.local.json');
  config.outputRoot = preserveOutputRoot && config.outputRoot ? resolve(base, config.outputRoot.replace(/\\/g, '/')) : resolve(outputDirectory, 'execution');
  writeFileSync(config.workspaceManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const output = resolve(outputDirectory, 'evaluation.local.json');
  writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  return { config: output, cases: manifest.length, preparedCases: bindings.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--manifest', '--bundle', '--output', '--config', '--plan'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid option');
    options[args[i].slice(2)] = args[i + 1];
  }
  const bundle = resolve(options.bundle ?? resolve(root, 'workspaces'));
  if (mode === 'export') {
    const index = exportBundle(readJson(options.manifest ?? defaultManifest), bundle);
    console.log(JSON.stringify({ versions: index.versions.length, bytes: index.versions.reduce((n, row) => n + row.bytes, 0), bundle }));
  } else if (mode === 'portable' && options.manifest && options.output) {
    const rows = portableRows(readJson(options.manifest));
    mkdirSync(dirname(resolve(options.output)), { recursive: true });
    writeFileSync(options.output, JSON.stringify(rows, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ cases: rows.length, output: resolve(options.output) }));
  } else if (['prepare', 'auto'].includes(mode) && options.config && options.output) {
    console.log(JSON.stringify(prepareBundleConfig(options.config, bundle, resolve(options.output), mode === 'auto')));
  } else if (mode === 'bind' && options.output) {
    const manifest = bindBundle(readJson(options.manifest ?? resolve(bundle, 'workspace-manifest.portable.json')), bundle,
      options.plan ? readJson(options.plan).selectedCaseIds : undefined);
    mkdirSync(dirname(resolve(options.output)), { recursive: true });
    writeFileSync(options.output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ cases: manifest.length, output: resolve(options.output) }));
  } else throw new Error('Usage: workspace-bundle.mjs export [--manifest path] | portable --manifest path --output new.json | prepare --config path --output new-directory | bind --output new.json [--manifest path] [--plan path]; optional --bundle directory');
}
