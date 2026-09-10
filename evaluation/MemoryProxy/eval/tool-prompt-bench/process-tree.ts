import { execFile, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const owned=new Set<()=>Promise<void>>();
let installed=false;
let shuttingDown=false;
export const processTreeSpawnOptions=()=>({detached:process.platform!=='win32'});
export const processTreeIsStopping=()=>shuttingDown;

function unixGroups(pid:number): Set<number> {
  const groups=new Set([pid]);
  if(process.platform!=='linux')return groups;
  // Snapshot descendants before signalling the parent, including tools which made
  // their own process group. Never select by executable name or kill all node jobs.
  const rows:{pid:number;ppid:number;pgid:number}[]=[];
  for(const name of readdirSync('/proc')){
    if(!/^\d+$/.test(name))continue;
    try{const raw=readFileSync(`/proc/${name}/stat`,'utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');rows.push({pid:Number(name),ppid:Number(fields[1]),pgid:Number(fields[2])});}catch{}
  }
  const descendants=new Set([pid]);
  let changed=true;
  while(changed){changed=false;for(const row of rows)if(descendants.has(row.ppid)&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true;}}
  const ownGroup=rows.find(row=>row.pid===process.pid)?.pgid;
  for(const row of rows)if(descendants.has(row.pid)&&row.pgid>1&&row.pgid!==ownGroup)groups.add(row.pgid);
  return groups;
}
function signalGroup(pgid:number,signal:NodeJS.Signals|0):boolean {
  try{process.kill(-pgid,signal);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
}
export function installProcessTreeShutdown() {
  if(installed||process.platform==='win32')return;
  installed=true;
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{
    shuttingDown=true;
    void Promise.allSettled([...owned].map(stop=>stop())).finally(()=>process.exit(signal==='SIGINT'?130:143));
  });
}
export function ownProcessTree(child:ChildProcess) {
  installProcessTreeShutdown();
  let stopping:Promise<void>|undefined;
  const stop=()=>stopping??=(async()=>{
    const pid=child.pid;if(!pid||pid<=1)return;
    if(process.platform==='win32'){
      if(child.exitCode!==null||child.signalCode!==null)return;
      await new Promise<void>(done=>execFile('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true},()=>done()));return;
    }
    const groups=unixGroups(pid);
    for(const group of groups)signalGroup(group,'SIGTERM');
    const deadline=Date.now()+5000;
    while([...groups].some(group=>signalGroup(group,0))&&Date.now()<deadline)await new Promise(done=>setTimeout(done,40));
    for(const group of groups)signalGroup(group,'SIGKILL');
  })().finally(()=>owned.delete(stop));
  owned.add(stop);
  child.once('close',()=>owned.delete(stop));
  if(shuttingDown)void stop();
  return stop;
}
