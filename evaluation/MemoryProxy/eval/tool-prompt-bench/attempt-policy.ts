import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
export const ATTEMPT_POLICY = 'active-timeout-480s-near180s-v1';
export function isMeaningfulActivity(row: any, client: 'codex'|'claude-code') {
  return client==='claude-code' ? row.type==='assistant' && Array.isArray(row.message?.content) && row.message.content.some((part:any)=>['text','thinking','tool_use'].includes(part.type))
    : /^item\.(started|updated|completed)$/.test(row.type??'') && ['agent_message','reasoning','command_execution','mcp_tool_call'].includes(row.item?.type);
}
export function createActivityTracker(client: 'codex'|'claude-code') {
  let pending='', meaningfulCount=0, lastMeaningfulAt:string|null=null;
  const inspect=(line:string)=>{try{if(isMeaningfulActivity(JSON.parse(line),client)){meaningfulCount++;lastMeaningfulAt=new Date().toISOString();}return true;}catch{return false;}};
  return { append(chunk:string){pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop()??'';for(const line of lines)inspect(line);if(pending&&inspect(pending))pending='';},
    finish(){return {meaningfulCount,lastMeaningfulAt,endedAt:new Date().toISOString()};} };
}
export function classifyAttempt(input: { status: string; durationMs?: number; startedAt?: string; trace?: any }, client: 'codex'|'claude-code', directory: string) {
  if (input.status === 'completed') return { category: 'completed', reason: 'normal-exit' };
  try {
    const capture = JSON.parse(readFileSync(join(directory,'capture-status.json'),'utf8'));
    const timedOut = capture.timedOut === true || input.trace?.timedOut === true || input.trace?.receipt?.lifecycle?.timedOut === true;
    const duration = input.durationMs ?? input.trace?.timings?.totalMs ?? 0;
    if (!timedOut || duration < 480000 || (capture.executionDurationMs!==undefined && capture.executionDurationMs<480000) || (capture.timeoutMs!==undefined && capture.timeoutMs!==480000)) return {category:'retry',reason:'not-full-budget-timeout'};
    const file=join(directory,client==='codex'?'codex-events.jsonl':'claude-code-events.jsonl');
    const rows=readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    const meaningful=(row:any)=>isMeaningfulActivity(row,client);
    const last=rows.at(-1);
    // Legacy logs have no per-event clock. Only accept their mtime when the LAST event
    // itself is meaningful; a later error/reconnect/heartbeat cannot keep a run alive.
    const journal=capture.activity;
    const end=journal?.endedAt?Date.parse(journal.endedAt):Date.parse(input.startedAt??'')+duration;
    const lastAt=journal?.lastMeaningfulAt?Date.parse(journal.lastMeaningfulAt):last?.timestamp ? Date.parse(last.timestamp) : statSync(file).mtimeMs;
    if(capture.status!=='captured' || !rows.some(meaningful) || (!journal && !meaningful(last)) || !Number.isFinite(end) || !Number.isFinite(lastAt) || end<lastAt || end-lastAt>180000)
      return {category:'retry',reason:'no-confirmed-model-activity-near-timeout'};
    return {category:'active-timeout',reason:'meaningful-activity-within-180s',lastMeaningfulAt:new Date(lastAt).toISOString(),endedAt:new Date(end).toISOString(),timingBasis:journal?'capture-activity-clock':last?.timestamp?'event-timestamp':'legacy-file-mtime'};
  } catch { return {category:'retry',reason:'missing-or-invalid-raw-capture'}; }
}
