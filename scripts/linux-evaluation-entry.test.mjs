import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const bash=process.env.BASH_EXE??(process.platform==='win32'?join(process.env.ProgramFiles??'C:/Program Files','Git/bin/bash.exe'):'bash');
test('Linux guide commands parse and both documented environments keep their run identity',()=>{
 const guide=readFileSync(join(root,'linux-reproduction/linux复现评测流程.md'),'utf8');
 const blocks=[...guide.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map(match=>match[1]);
 assert.ok(blocks.length>0);
 for(const block of blocks){const result=spawnSync(bash,['-n'],{input:block,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 const selections=blocks.filter(block=>block.startsWith('export DATASET='));
 assert.equal(selections.length,2);
 for(const client of ['codex','claude-code'])for(const [i,block] of selections.entries()){
  const result=spawnSync(bash,['-c',`export CLIENT=${client}\n${block}\nprintf '%s\\n' "$DATASET" "$EVAL_SCRIPT" "$RUN"`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/),i===0?['first250','linux-reproduction/evaluate-250.sh',`linux-250-${client}-01`]:['full1140','linux-reproduction/evaluate-full.sh',`linux-full-${client}-01`]);
 }
 assert.match(guide,/bsdtar -xf "\$WORKSPACE_ZIP" -C \./);
 assert.match(guide,/test -f workspaces\/bundle\.json/);
 assert.match(guide,/results\.ts score 只读取指定 quick 目录/);
 assert.match(guide,/## 新开终端或 SSH 重连/);
});
for(const [script,dataset] of [['evaluate-250.sh','first250'],['evaluate-full.sh','full1140']]){
 test(`${script} pins its dataset and preserves arguments`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'linux entry '));
  try{
   copyFileSync(join(root,'linux-reproduction',script),join(dir,script));
   writeFileSync(join(dir,'run.sh'),'#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
   const result=spawnSync(bash,[join(dir,script),'run','--client','codex','--concurrency','3','--bundle','/tmp/source with spaces'],{encoding:'utf8',cwd:tmpdir()});
   assert.equal(result.status,0,result.stderr);
   assert.deepEqual(result.stdout.trim().split(/\r?\n/),['run','--dataset',dataset,'--client','codex','--concurrency','3','--bundle','/tmp/source with spaces']);
   for(const mode of ['prepare','initialize','check','retry']){
    const res=spawnSync(bash,[join(dir,script),mode,'--client','claude-code'],{encoding:'utf8'});
    assert.equal(res.status,0,res.stderr);assert.ok(res.stdout.startsWith(`${mode}\n--dataset\n${dataset}\n`));
   }
   assert.equal(spawnSync(bash,[join(dir,script),'run','--dataset','other'],{encoding:'utf8'}).status,2);
   const help=spawnSync(bash,[join(dir,script),'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/Usage:/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
}
