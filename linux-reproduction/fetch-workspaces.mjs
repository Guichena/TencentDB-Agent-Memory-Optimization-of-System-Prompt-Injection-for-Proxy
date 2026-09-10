// Network fallback when the separately distributed workspace bundle is unavailable.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { repositoryInventory } from '../scripts/prepare-workspaces.mjs';
import { exportBundle } from '../scripts/workspace-bundle.mjs';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'..');
const name=process.argv[2];
if (!['first250','full1140'].includes(name) || process.argv.length > 3) throw Error('Usage: node linux-reproduction/fetch-workspaces.mjs first250|full1140');
const rows=JSON.parse(readFileSync(join(here,'datasets',name,'workspaces.json'),'utf8'));
const git=(args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:1800000,maxBuffer:64*1024*1024,env:{...process.env,GIT_LFS_SKIP_SMUDGE:'1',GIT_TERMINAL_PROMPT:'0'}}).trim();
for(const repo of repositoryInventory(rows)){
  const directory=join(root,'repositories',repo.repoId);
  if(!existsSync(directory)) {mkdirSync(dirname(directory),{recursive:true});console.log('Cloning',repo.repoId);git(['clone','--no-checkout','--filter=blob:none',repo.repoUrl,directory]);}
  if(resolve(git(['-C',directory,'rev-parse','--show-toplevel']))!==directory)throw Error('Unexpected Git root: '+directory);
  const origin=git(['-C',directory,'remote','get-url','origin']);
  if(origin.replace(/\.git$/,'').toLowerCase()!==repo.repoUrl.replace(/\.git$/,'').toLowerCase())throw Error('Origin mismatch: '+repo.repoId);
  for(const sha of repo.commits){try{git(['-C',directory,'cat-file','-e',sha+'^{commit}']);}catch{git(['-C',directory,'fetch','origin',sha]);git(['-C',directory,'cat-file','-e',sha+'^{commit}']);}}
  for(const row of rows.filter(x=>x.repoId===repo.repoId)) row.repositoryPath=directory;
}
exportBundle(rows,join(root,'workspaces'));
console.log('Workspaces exported. Existing valid archives reused; no model requests were made.');
