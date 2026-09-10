// Maintainer utility: freeze the established campaign, not model outcomes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const campaignPath = path.resolve(root, process.argv[2] ?? 'runs/test1k/inputs/campaign.json');
const campaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
const workspace = JSON.parse(fs.readFileSync(path.join(path.dirname(campaignPath), 'workspaces.json'), 'utf8'));
if (campaign.selectedCaseIds.length !== 1140 || new Set(campaign.selectedCaseIds).size !== 1140) throw Error('Expected full test1k campaign');
for (const [name, count] of [['first250',250],['full1140',1140]]) {
  const caseIds = campaign.selectedCaseIds.slice(0,count);
  const rows=workspace.filter(x=>caseIds.includes(x.caseId)).map(({caseId,teamId,repoId,repoUrl,baseSha,clusterId})=>({caseId,teamId,repoId,repoUrl,baseSha,clusterId}));
  const dir=path.join(here,'datasets',name); fs.mkdirSync(dir,{recursive:true});
  for(const [file,value] of [['selection.json',{schemaVersion:'linux-selection.v1',parentDatasetDigest:campaign.datasetDigest,caseIds,selectionRule:`First ${count} IDs of the established campaign; no outcome-based filtering`,repositoryVersions:new Set(rows.map(x=>x.repoId+'@'+x.baseSha)).size}],['workspaces.json',rows]]) {
    fs.writeFileSync(path.join(dir,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  }
  console.log(name,count,rows.length);
}
