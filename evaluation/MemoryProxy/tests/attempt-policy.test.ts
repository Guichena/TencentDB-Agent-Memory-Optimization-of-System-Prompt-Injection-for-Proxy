import { expect,it,vi } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAttempt,createActivityTracker } from '../eval/tool-prompt-bench/attempt-policy.js';
it('timestamps real streamed activity, not the later capture finalization',()=>{
 vi.useFakeTimers();try{
  vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));const tracker=createActivityTracker('codex');
  tracker.append('{"type":"item.completed","item":');tracker.append('{"type":"agent_message","text":"hello"}}');
  vi.setSystemTime(new Date('2026-09-10T10:08:00Z'));const result=tracker.finish();
  expect(result.meaningfulCount).toBe(1);expect(result.lastMeaningfulAt).toBe('2026-09-10T10:00:00.000Z');
 }finally{vi.useRealTimers();}
});
it('retains budget exhaustion but not reconnects, HTTP 200 alone, short timeout or normal low score',()=>{
 const dir=mkdtempSync(join(tmpdir(),'policy-'));
 try{
  const attempt={status:'failed',startedAt:new Date(Date.now()-480100).toISOString(),durationMs:480100};
  writeFileSync(join(dir,'capture-status.json'),JSON.stringify({status:'captured',timedOut:true,activity:{endedAt:'2026-09-10T10:08:00Z',lastMeaningfulAt:'2026-09-10T10:07:30Z',meaningfulCount:1}}));
  const file=join(dir,'codex-events.jsonl');
  writeFileSync(file,JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'working'}}));
  expect(classifyAttempt(attempt,'codex',dir).category).toBe('active-timeout');
  expect(classifyAttempt({...attempt,durationMs:20000},'codex',dir).category).toBe('retry');
  writeFileSync(join(dir,'capture-status.json'),JSON.stringify({status:'captured',timedOut:true,activity:{endedAt:'2026-09-10T10:08:00Z',lastMeaningfulAt:'2026-09-10T10:04:59Z',meaningfulCount:1}}));
  expect(classifyAttempt(attempt,'codex',dir).category).toBe('retry');
  writeFileSync(file,JSON.stringify({type:'error',message:'HTTP 200 reconnecting'}));
  expect(classifyAttempt(attempt,'codex',dir).category).toBe('retry');
  expect(classifyAttempt({status:'completed'},'codex',dir).category).toBe('completed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
