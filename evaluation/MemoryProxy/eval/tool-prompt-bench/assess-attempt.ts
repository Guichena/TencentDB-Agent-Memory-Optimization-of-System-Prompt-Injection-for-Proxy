import { classifyAttempt, ATTEMPT_POLICY } from './attempt-policy.js';
import { readAttemptCapture, projectFinal5Evidence } from './final5-evidence.js';
import type { Final5Record } from './final5-formal-datasource.js';
export function assessAttempt(attempt:any, client:'codex'|'claude-code', variant:'server_team'|'V4', row:Final5Record, digest:string, directory:string) {
  const classification=classifyAttempt(attempt,client,directory);
  const base={policy:ATTEMPT_POLICY,...classification};
  if(classification.category==='retry')return {...base,retryRequired:true,scorable:false};
  try {
    const {manifest,events,intentEvidence}=readAttemptCapture(directory);
    if(manifest.client!==client||manifest.variant!==variant||manifest.caseId!==row.case_id)throw Error('capture-identity-mismatch');
    const evidence=projectFinal5Evidence(row,digest,classification.category==='active-timeout'?{...manifest,lifecycleComplete:true}:manifest,events,intentEvidence);
    const scorable=evidence.inputComplete&&evidence.scoring.observation.rawTraceStatus==='complete';
    if(scorable)return {...base,category:classification.category==='active-timeout'?'scorable_timeout':'completed',scorable:true,retryRequired:false,evidence};
    // An in-flight request at the budget boundary is not proof of a capture failure.
    // Keep it unknown for review instead of silently rerunning a potentially difficult case.
    return {...base,category:classification.category==='active-timeout'?'unscorable_timeout':'retry',reason:'incomplete-observation-window',scorable:false,retryRequired:classification.category!=='active-timeout',reviewRequired:classification.category==='active-timeout'};
  }catch(error){return {...base,category:classification.category==='active-timeout'?'unscorable_timeout':'retry',reason:error instanceof Error?error.message:'missing-or-invalid-evidence',scorable:false,retryRequired:true};}
}
