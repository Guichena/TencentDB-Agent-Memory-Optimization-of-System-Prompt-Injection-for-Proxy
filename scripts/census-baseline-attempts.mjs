import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('runs/final5-test1k-20260909-consolidated/baseline');
const jobs=[];
for(const root of fs.readdirSync('runs').filter(x=>x.startsWith('final5-test1k-'))) for(const client of ['codex','claude-code']) {
  const dir=path.resolve('runs',root,'execution',client,'server_team','execution.json.checkpoint');
  if(fs.existsSync(dir)) for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.json')&&x!=='config.json')) jobs.push({root,client,file:path.join(dir,name)});
}
let cursor=0,done=0;const rows=[];
await Promise.all(Array.from({length:16},async()=>{while(cursor<jobs.length){const job=jobs[cursor++];const cp=JSON.parse(await fs.promises.readFile(job.file,'utf8'));for(const a of cp.attempts??[]) {
  const lifecycle=a.trace?.receipt?.lifecycle??a.trace?.lifecycle;
  rows.push({...job,caseId:cp.key.caseId,repeat:cp.key.repeat,status:a.status,startedAt:a.startedAt,durationMs:a.durationMs,error:a.error,directory:a.evidenceDirectory??a.trace?.evidenceDirectory??a.trace?.outputDir,timeoutMs:a.trace?.timeoutMs,lifecycle,timeout:a.trace?.timedOut===true||lifecycle?.timedOut===true});
}if(++done%100===0)console.log(done,jobs.length);}}));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'attempt-census.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify({count:rows.length,timeouts:rows.filter(x=>x.timeout).length,samples:rows.filter(x=>x.timeout).slice(0,5)},null,2));
