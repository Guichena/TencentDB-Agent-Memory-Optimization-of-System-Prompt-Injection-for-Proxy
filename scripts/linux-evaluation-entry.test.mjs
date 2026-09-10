import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const bash=process.env.BASH_EXE??(process.platform==='win32'?join(process.env.ProgramFiles??'C:/Program Files','Git/bin/bash.exe'):'bash');
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
