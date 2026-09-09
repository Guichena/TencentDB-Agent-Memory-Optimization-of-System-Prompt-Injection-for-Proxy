import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = resolve(root, 'evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/manifests/workspace-resolution-final5-manifest-v2.json');

export function repositoryInventory(rows) {
  if (!Array.isArray(rows)) throw new Error('Workspace manifest must be an array');
  const groups = new Map();
  for (const row of rows) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(row.repoId) || row.repoId.split('/').some(part => part === '.' || part === '..') || !/^[0-9a-f]{40}$/i.test(row.baseSha)) throw new Error('Invalid repository ID or commit');
    const url = new URL(row.repoUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Expected a public HTTPS repository URL');
    const item = groups.get(row.repoId) ?? { repoId: row.repoId, repoUrl: row.repoUrl, directory: row.repoId, commits: new Set(), caseIds: new Set() };
    if (item.repoUrl.toLowerCase().replace(/\.git$/, '') !== row.repoUrl.toLowerCase().replace(/\.git$/, '')) throw new Error('Conflicting URL for ' + row.repoId);
    item.commits.add(row.baseSha); item.caseIds.add(row.caseId); groups.set(row.repoId, item);
  }
  return [...groups.values()].sort((a, b) => a.repoId.localeCompare(b.repoId)).map(item => ({ ...item, commits: [...item.commits].sort(), caseIds: [...item.caseIds].sort() }));
}

export function bindWorkspaces(rows, repositoriesRoot, git = (directory, args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()) {
  const inventory = repositoryInventory(rows);
  const paths = new Map();
  for (const item of inventory) {
    const directory = resolve(repositoriesRoot, item.directory);
    try {
      if (git(directory, ['rev-parse', '--is-inside-work-tree']) !== 'true') throw new Error('Not a Git checkout');
      if (resolve(git(directory, ['rev-parse', '--show-toplevel'])) !== directory) throw new Error('Expected repository root');
      for (const sha of item.commits) git(directory, ['cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      throw new Error(`Workspace not ready: ${item.repoId}. Place its Git checkout (including .git and required commits) at ${directory}`);
    }
    paths.set(item.repoId, directory);
  }
  return rows.map(row => ({ ...row, repositoryPath: paths.get(row.repoId), sourceKind: 'existing-git-repository',
    isGitRepository: true, baseShaVerified: true, workspaceReady: true, resolutionStatus: 'resolved',
    resolutionReason: 'Verified local Git root and required commit with git cat-file; generated on the reproduction machine.' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--manifest', '--repositories', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid option');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!['inventory', 'bind'].includes(mode) || !options.output || (mode === 'bind' && !options.repositories)) {
    throw new Error('Usage: prepare-workspaces.mjs inventory|bind --output <new.json> [--manifest <json>] [--repositories <repository bundle directory>]');
  }
  const rows = JSON.parse(readFileSync(options.manifest ?? defaultManifest, 'utf8'));
  const output = mode === 'inventory' ? repositoryInventory(rows) : bindWorkspaces(rows, resolve(options.repositories));
  mkdirSync(dirname(resolve(options.output)), { recursive: true });
  writeFileSync(options.output, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode, entries: output.length, output: resolve(options.output) }));
}
