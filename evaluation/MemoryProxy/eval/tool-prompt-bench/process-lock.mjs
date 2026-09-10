import { readFileSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

function bootId() { try { return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(); } catch { return null; } }
function processGroup() {
  try { const stat=readFileSync('/proc/self/stat','utf8'); return Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[2]); } catch { return null; }
}
function alive(pid) {
  try { process.kill(pid,0); return true; } catch(error) { return error.code === 'ESRCH' ? false : null; }
}
export function lockState(record, probe={ host:hostname(), boot:bootId(), alive }) {
  if (!Number.isSafeInteger(record.pid)||record.pid<=0) return 'unknown';
  if (record.host && record.host!==probe.host) return 'unknown';
  if (record.host===probe.host && record.boot && probe.boot && record.boot!==probe.boot) return 'stale';
  const owner=probe.alive(record.pid);
  if(owner===true) return 'active';
  if(owner!==false || !Number.isSafeInteger(record.pgid)||record.pgid<=1 || record.host!==probe.host || !record.boot || record.boot!==probe.boot) return 'unknown';
  const group=probe.alive(-record.pgid);
  return group===false ? 'stale' : group===true ? 'children-active' : 'unknown';
}
export function inspectLock(file) {
  try { const raw=readFileSync(file,'utf8'); const record=JSON.parse(raw); return {state:lockState(record),record}; }
  catch(error) { if(error.code==='ENOENT')return {state:'missing'}; return {state:'unknown'}; }
}
function guarded(file, fn) {
  const guard=file+'.guard';
  try { mkdirSync(guard); } catch { throw Error('Lock maintenance in progress or stale guard; inspect '+guard); }
  try { return fn(); } finally { rmdirSync(guard); }
}
export function acquireProcessLock(file, metadata={}) {
  return guarded(file,()=>{
    const state=inspectLock(file).state;
    if(state!=='missing') throw Error(`Lock ${state}: ${file}. Use doctor; do not delete a live lock.`);
    const record={...metadata,pid:process.pid,host:hostname(),boot:bootId(),pgid:processGroup(),token:randomUUID()};
    writeFileSync(file,JSON.stringify(record),{flag:'wx'});
    return ()=>guarded(file,()=>{if(inspectLock(file).record?.token===record.token)unlinkSync(file);});
  });
}
export function recoverProcessLock(file) {
  return guarded(file,()=>{
    const state=inspectLock(file).state;
    if(state==='missing')return false;
    if(state!=='stale')throw Error(`Refusing recovery of ${state} lock: ${file}`);
    unlinkSync(file); return true;
  });
}
