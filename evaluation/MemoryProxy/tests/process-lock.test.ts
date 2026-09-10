import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockState, acquireProcessLock, inspectLock, recoverProcessLock } from '../eval/tool-prompt-bench/process-lock.mjs';
const record={pid:123,pgid:123,host:'machine',boot:'boot'};
describe('safe process locks',()=>{
  it('keeps orphaned children protected',()=>expect(lockState(record,{host:'machine',boot:'boot',alive:(id:number)=>id<0})).toBe('children-active'));
  it('identifies a dead process group',()=>expect(lockState(record,{host:'machine',boot:'boot',alive:()=>false})).toBe('stale'));
  it('rejects legacy locks with only a dead parent PID',()=>expect(lockState({pid:123},{host:'machine',boot:'boot',alive:()=>false})).toBe('unknown'));
  it('permits same-host reboot recovery',()=>expect(lockState(record,{host:'machine',boot:'new-boot',alive:()=>true})).toBe('stale'));
  it('does not touch locks from another host',()=>expect(lockState(record,{host:'other',boot:'new',alive:()=>false})).toBe('unknown'));
  it('treats permission uncertainty conservatively',()=>expect(lockState(record,{host:'machine',boot:'boot',alive:()=>null})).toBe('unknown'));
  it('serializes acquisition and refuses recovery of a live lock',()=>{
    const dir=mkdtempSync(join(tmpdir(),'eval-lock-')), file=join(dir,'operation.lock');
    try {const release=acquireProcessLock(file);expect(inspectLock(file).state).toBe('active');expect(()=>acquireProcessLock(file)).toThrow();expect(()=>recoverProcessLock(file)).toThrow();release();expect(existsSync(file)).toBe(false);}finally{rmSync(dir,{recursive:true,force:true});}
  });
});
