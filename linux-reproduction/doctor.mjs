import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { inspectLock, recoverProcessLock } from '../evaluation/MemoryProxy/eval/tool-prompt-bench/process-lock.mjs';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'..');
const args=process.argv.slice(2), clear=args.includes('--clear-stale'), rest=args.filter(x=>x!=='--clear-stale');
if(rest.length>1 || rest.some(x=>x.startsWith('--')))throw Error('Usage: run.sh doctor [runs/.../quick-UUID] [--clear-stale]');
const locks=[join(here,'.operation.lock')];
if(rest.length){const dir=resolve(root,rest[0]),rel=relative(join(root,'runs'),dir);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Expected run under runs/');locks.push(join(dir,'controller.lock'));}
let portsFree=true;
for(const port of [18427,8096,8097])await new Promise(done=>{const server=createServer();server.once('error',()=>{portsFree=false;console.log(JSON.stringify({port,free:false}));done();});server.listen(port,'127.0.0.1',()=>server.close(()=>{console.log(JSON.stringify({port,free:true}));done();}));});
for(const file of locks){const inspection=inspectLock(file);console.log(JSON.stringify({lock:relative(root,file),...inspection,guardPresent:existsSync(file+'.guard')}));if(clear&&inspection.state!=='missing'){if(!portsFree)throw Error('Refusing recovery while evaluation ports are occupied');recoverProcessLock(file);console.log('Recovered: '+relative(root,file));}}
for(const [command,argv] of [['node',['--version']],['git',['--version']],['curl',['--version']],['go',['version']],['bsdtar',['--version']]]){const result=spawnSync(command,argv,{encoding:'utf8',timeout:10000,shell:false});console.log(JSON.stringify({tool:command,available:result.status===0,version:result.stdout?.split(/\r?\n/)[0]}));}
console.log(JSON.stringify({workspaceIndex:existsSync(join(root,'workspaces/bundle.json')),note:'check/run validates source files. Unknown/legacy locks and stale guard directories require manual inspection.'}));
