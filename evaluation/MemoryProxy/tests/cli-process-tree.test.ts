import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { executeCodexProcess } from '../eval/tool-prompt-bench/codex-runner.js';

it('preserves successful native CLI output',async()=>{
  const result=await executeCodexProcess({executable:process.execPath,args:['-e','process.stdout.write("native-ok")'],cwd:tmpdir(),environment:process.env,stdin:'',timeoutMs:10000});
  expect(result.stdout).toBe('native-ok');expect(result.exitCode).toBe(0);expect(result.timedOut).toBe(false);
});

it('terminates a plain CLI process at its timeout',async()=>{
  const result=await executeCodexProcess({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:tmpdir(),environment:process.env,stdin:'',timeoutMs:250});
  expect(result.timedOut).toBe(true);
},15000);

it.skipIf(process.platform !== 'linux')('kills a SIGTERM-ignoring grandchild and releases its port on CLI timeout', async () => {
  const dir=mkdtempSync(join(tmpdir(),'cli-tree-')), state=join(dir,'child.json');
  const childCode=`const net=require('net'),fs=require('fs');process.on('SIGTERM',()=>{});const s=net.createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(state)},JSON.stringify({pid:process.pid,port:s.address().port})));`;
  const parentCode=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const result=await Promise.race([
      executeCodexProcess({executable:process.execPath,args:['-e',parentCode],cwd:dir,environment:process.env,stdin:'',timeoutMs:1500}),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('CLI tree did not terminate')),12000);}),
    ]);
    expect(result.timedOut).toBe(true);
    const {port}=JSON.parse(readFileSync(state,'utf8'));
    const probe=createServer();
    await new Promise<void>((done,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(()=>done()));});
  } finally {
    clearTimeout(timer);
    // Only the PID produced by this test is eligible for cleanup.
    if(existsSync(state)){try{process.kill(JSON.parse(readFileSync(state,'utf8')).pid,'SIGKILL');}catch{}}
    rmSync(dir,{recursive:true,force:true});
  }
},20000);
