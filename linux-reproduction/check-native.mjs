import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const core=join(root,'implementations/final/MemoryCore');
const requireCore=createRequire(join(core,'package.json'));
const vec=requireCore('sqlite-vec');
const db=new DatabaseSync(':memory:',{allowExtension:true});
try {vec.load(db);console.log(JSON.stringify({native:'sqlite-vec',version:db.prepare('select vec_version() as version').get().version,loaded:true}));} finally {db.close();}
for(const packageName of ['@tencentdb-agent-memory/memory-sdk-ts-v2','@tencentdb-agent-memory/tcvdb-text']) {
  const pkg=JSON.parse(readFileSync(join(core,'node_modules',packageName,'package.json'),'utf8'));
  console.log(JSON.stringify({dependency:packageName,version:pkg.version,source:'frozen registry dependency'}));
}
for(const packageDir of ['evaluation/MemoryProxy','implementations/baseline/MemoryProxy','implementations/final/MemoryProxy']) {
  const requireProxy=createRequire(join(root,packageDir,'package.json'));
  const pty=requireProxy('node-pty');
  await new Promise((done,reject)=>{
    let output='';
    const child=pty.spawn(process.execPath,['-e','process.stdout.write("pty-native-ok")'],{name:'xterm',cols:80,rows:24,cwd:root,env:process.env});
    const timeout=setTimeout(()=>{child.kill();reject(Error('node-pty smoke timed out: '+packageDir));},10000);
    child.onData(chunk=>{output+=chunk;});
    child.onExit(({exitCode})=>{clearTimeout(timeout);if(exitCode!==0||!output.includes('pty-native-ok'))reject(Error('node-pty smoke failed: '+packageDir));else done();});
  });
  console.log(JSON.stringify({native:'node-pty',packageDir,loaded:true}));
}
