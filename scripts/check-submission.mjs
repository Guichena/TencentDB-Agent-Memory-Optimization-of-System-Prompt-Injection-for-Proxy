import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Check the nearest existing ancestor too, so junctions cannot hide external inputs.
export function localPath(root, base, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('missing path');
  if (process.platform !== 'win32' && win32.isAbsolute(value)) throw new Error('foreign absolute path');
  const target = resolve(base, value);
  const inside = (parent, child) => {
    const rel = relative(parent, child);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(resolve(root), target)) throw new Error('outside repository');
  let ancestor = target;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  if (!inside(realpathSync(root), realpathSync(ancestor))) throw new Error('link points outside repository');
  return target;
}

export function checkSubmission(root = repositoryRoot, configFile, runtime = false) {
  const checks = [];
  const check = (label, base, value, directory = false, required = true, mustExist = true) => {
    try {
      const path = localPath(root, base, value);
      if (mustExist && !existsSync(path)) throw new Error('missing');
      if (existsSync(path) && statSync(path).isDirectory() !== directory) throw new Error('wrong file type');
      checks.push({ label, status: 'ok' });
      return path;
    } catch (error) {
      checks.push({ label, status: required ? 'error' : 'deferred', reason: error.message });
      return null;
    }
  };
  check('evaluation/package.json', root, 'evaluation/MemoryProxy/package.json');
  check('evaluation/contracts', root, 'evaluation/MemoryProxy/contracts/runtime-tool-contracts.ts');
  for (const variant of ['implementations/baseline', 'implementations/final']) {
    for (const file of ['package.json', 'src/server.ts']) check(`${variant}/${file}`, root, `${variant}/MemoryProxy/${file}`);
  }
  const parse = (label, path) => {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch { checks.push({ label, status: 'error', reason: 'invalid JSON' }); return null; }
  };
  const configPath = check('config', root, configFile ?? 'scripts/final5-evaluation.example.json');
  const config = configPath && parse('config', configPath);
  if (config) {
    const base = dirname(configPath);
    const fields = {
      baselineRoot: true, v4Root: true, proxyConfig: false, plan: false,
      workspaceManifest: false, teamsRoot: true, skillCatalogBindings: false,
      envFile: false, outputRoot: true,
      ...(config.runtimeBindings ? { runtimeBindings: false } : {}),
      ...(config.assetRunRoot ? { assetRunRoot: true } : {}),
    };
    for (const [field, directory] of Object.entries(fields)) {
      const deferred = ['envFile', 'runtimeBindings', 'assetRunRoot'].includes(field);
      const path = check(field, base, config[field], directory, runtime || !deferred, field !== 'outputRoot');
      if (path && field === 'workspaceManifest') {
        const rows = parse(field, path);
        if (!Array.isArray(rows)) {
          checks.push({ label: field, status: 'error', reason: 'expected array' });
          continue;
        }
        const paths = new Set(rows.map(row => row?.repositoryPath));
        let index = 0;
        for (const value of paths) check(`workspace[${index++}]`, dirname(path), value, true, runtime);
      }
    }
  }
  return { mode: runtime ? 'runtime-files' : 'submission',
    scope: 'File availability and repository boundaries only; no CLI, credentials, network, Git SHA or asset verification.',
    ok: checks.every(item => item.status !== 'error'), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/check-submission.mjs [--config <json>] [--runtime]\nDefault checks submitted files; --runtime also requires local runtime inputs and workspaces.');
  } else {
    const index = args.indexOf('--config');
    if (args.some((arg, i) => arg !== '--runtime' && arg !== '--config' && !(index >= 0 && i === index + 1)) ||
        (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--')))) throw new Error('Invalid arguments; use --help');
    const report = checkSubmission(repositoryRoot, index >= 0 ? args[index + 1] : undefined, args.includes('--runtime'));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
}
