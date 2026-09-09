import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePath, portableRows } from './workspace-bundle.mjs';

const bundle = resolve(process.argv[2] ?? 'workspaces');
const output = resolve(process.argv[3] ?? 'release/external-workspaces-ready.zip');
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
const sha256 = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const index = JSON.parse(readFileSync(resolve(bundle, 'bundle.json'), 'utf8'));
const versions = new Map(index.versions.map(row => [`${row.repoId}@${row.baseSha}`, row]));
const manifests = ['workspace-manifest.portable.json', 'workspace-manifest.test1k.portable.json'].filter(file => existsSync(resolve(bundle, file)));
if (!manifests.includes('workspace-manifest.portable.json')) throw new Error('Export must complete before packaging');
for (const file of manifests) {
  const rows = portableRows(JSON.parse(readFileSync(resolve(bundle, file), 'utf8')));
  for (const row of rows) if (!versions.has(`${row.repoId}@${row.baseSha}`)) throw new Error(`Missing revision for ${row.caseId}`);
}
let verified = 0;
for (const row of index.versions) {
  const file = bundlePath(bundle, row.archive);
  if (statSync(file).size !== row.bytes || await sha256(file) !== row.sha256) throw new Error(`Damaged archive: ${row.archive}`);
  verified++;
  if (verified % 25 === 0 || verified === index.versions.length) console.log(JSON.stringify({ stage: 'verify', verified, total: index.versions.length }));
}
mkdirSync(dirname(output), { recursive: true });
console.log(JSON.stringify({ stage: 'package', layout: 'expanded-sources-v1', output }));
execFileSync(process.env.PYTHON ?? 'python', [fileURLToPath(new URL('./package-workspace-sources.py', import.meta.url)), bundle, `${output}.partial`, ...manifests], {
  windowsHide: true, timeout: 1800000, stdio: 'inherit',
});
renameSync(`${output}.partial`, output);
const report = { output, versions: index.versions.length, repositories: new Set(index.versions.map(row => row.repoId)).size,
  bytes: statSync(output).size, sha256: await sha256(output), layout: 'expanded-sources-v1', manifests };
writeFileSync(`${output}.sha256`, `${report.sha256}  ${output.split(/[\\/]/).at(-1)}\n`);
writeFileSync(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
