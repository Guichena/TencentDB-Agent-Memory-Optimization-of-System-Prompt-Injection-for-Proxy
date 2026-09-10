import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFinal5Dataset } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-formal-datasource.js';
import { buildFinal5CampaignPlan } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/final5-campaign-builder.js';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'..');
const read=(p:string)=>JSON.parse(readFileSync(join(here,p),'utf8'));
const dataset=loadFinal5Dataset(join(root,'evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/teams'));
assert.equal(dataset.records.length,1140); assert.equal(dataset.teams.length,39);
const first=read('datasets/first250/selection.json'), full=read('datasets/full1140/selection.json');
assert.deepEqual(full.caseIds.slice(0,250),first.caseIds);
const official=JSON.parse(readFileSync(join(root,'evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/manifests/workspace-resolution-final5-manifest-v2.json'),'utf8'));
const byId=new Map(official.map((r:any)=>[r.caseId,r]));
for(const [name,count,projects,revisions] of [['first250',250,10,63],['full1140',1140,39,201]] as const){
  const selection=read(`datasets/${name}/selection.json`), rows=read(`datasets/${name}/workspaces.json`);
  assert.equal(selection.parentDatasetDigest,dataset.sourceDigest,'Parent dataset changed');
  assert.equal(selection.caseIds.length,count); assert.equal(new Set(selection.caseIds).size,count);
  assert.equal(rows.length,count); assert.equal(new Set(rows.map((r:any)=>r.repoId)).size,projects);
  assert.equal(new Set(rows.map((r:any)=>r.repoId+'@'+r.baseSha)).size,revisions);
  assert.deepEqual(new Set(rows.map((r:any)=>r.caseId)),new Set(selection.caseIds));
  for(const row of rows){const reference:any=byId.get(row.caseId);assert.ok(reference);assert.equal(row.repoId,reference.repoId);assert.equal(row.repoUrl,reference.repoUrl);assert.equal(row.baseSha,dataset.records.find(r=>r.case_id===row.caseId)?.case.base_sha);}
  const plan=buildFinal5CampaignPlan(dataset,'offline-'+name,selection.caseIds);
  assert.equal(plan.slots.length,count*2);assert.deepEqual(plan.selectedCaseIds,selection.caseIds);
  console.log(JSON.stringify({verified:name,cases:count,projects,revisions,slotsPerClient:plan.slots.length,datasetDigest:dataset.sourceDigest}));
}
assert.equal(first.caseIds[0],'DVG-T04-T01-C001');assert.equal(first.caseIds.at(-1),'c_3a3e34703e1a9d42');
for(const file of ['setup.sh','run.sh','evaluate-250.sh','evaluate-full.sh'])assert.ok(!readFileSync(join(here,file),'utf8').includes('\r'),'Shell script must use LF');
