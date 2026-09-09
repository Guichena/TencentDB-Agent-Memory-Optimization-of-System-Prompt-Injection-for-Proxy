import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('runs/final5-test1k-20260909-consolidated');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const readRows = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const ratio = (rows, field) => {
  const numerator = rows.filter(row => row.score[field] === true).length;
  return { numerator, denominator: rows.length, value: rows.length ? numerator / rows.length : null };
};
const distribution = values => {
  const sorted = values.toSorted((a,b) => a-b);
  const quantile = p => {
    if (!sorted.length) return null;
    const index = (sorted.length-1)*p, lower = Math.floor(index);
    return sorted[lower] + (sorted[Math.ceil(index)]-sorted[lower])*(index-lower);
  };
  return { coveredCases: values.length, mean: values.length ? values.reduce((a,b)=>a+b,0)/values.length : null, median: quantile(.5), p90: quantile(.9) };
};
const groups = {};
for (const client of ['codex','claude-code']) for (const variant of ['baseline','V4']) {
  const dir = path.join(root,variant,client);
  const rows = readRows(path.join(dir,'case-scores.jsonl')).filter(row=>row.behaviorEligible && row.score);
  const evidence = readRows(path.join(dir,'evidence.jsonl'));
  assert.equal(rows.length, evidence.length);
  assert.equal(new Set(rows.map(row=>row.caseId)).size, rows.length);
  fs.writeFileSync(path.join(dir,'case-scores.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':''));
  const positive = rows.filter(row=>row.shouldCall), negative = rows.filter(row=>!row.shouldCall);
  const metrics = {
    cases: rows.length, positive:positive.length, negative:negative.length,
    trigger:ratio(positive,'triggeredAttempt'), firstAction:ratio(positive,'firstActionSelectionCorrect'),
    terminal:ratio(positive,'terminalSelectionCorrect'), complete:ratio(positive,'completeChainSuccess'), strict:ratio(positive,'strictChainExact'),
    falseCall:ratio(negative,'falseCallAttempt'), overcall:ratio(positive,'positiveOvercall'),
    failures:Object.fromEntries([...new Set(rows.map(row=>row.score.failureLayer ?? 'none'))].sort().map(key=>[key,rows.filter(row=>(row.score.failureLayer ?? 'none')===key).length])),
    inputTokens:Object.fromEntries(['providerTotalInputTokens','ordinaryInputTokens','cacheReadInputTokens','cacheWriteInputTokens'].map(field=>[field,distribution(evidence.flatMap(row=>typeof row.providerUsage?.fields?.[field]?.value === 'number' ? [row.providerUsage.fields[field].value] : []))])),
  };
  const observable = manifest.summary[client].allObservable[variant==='baseline'?'baseline':'final'];
  assert.equal(metrics.cases,observable.eligibleCaseCount);
  assert.deepEqual(metrics.trigger,observable.ECR);
  assert.deepEqual(metrics.firstAction,observable.TSR_all);
  assert.deepEqual(metrics.falseCall,observable.allNoCall.falseCallRate);
  assert.deepEqual(metrics.complete,observable.chainDetails.completeChainSuccessRate);
  assert.deepEqual(metrics.strict,observable.chainDetails.strictChainExactRate);
  assert.deepEqual(metrics.overcall,observable.chainDetails.positiveOvercallRate);
  groups[`${client}/${variant}`] = metrics;
  fs.writeFileSync(path.join(dir,'completed-case-summary.json'),JSON.stringify(metrics,null,2)+'\n');
}
assert.equal(Object.values(groups).reduce((sum,g)=>sum+g.cases,0),manifest.selectedCaseEvidence);
const pct = r => r.value===null ? 'N/A' : `${r.numerator}/${r.denominator} (${(r.value*100).toFixed(2)}%)`;
let md = '# Completed Case Results\n\n';
md += `Generated: ${manifest.generatedAt}. Total: ${manifest.selectedCaseEvidence} distinct client/variant/case units.\n\n`;
md += 'Four groups only. Each denominator uses its own completed, behavior-eligible cases. Earliest eligible attempt per case wins, without selection by score. Unrun cases, incomplete captures and upstream failures are excluded. Source fingerprints remain provenance only.\n\n';
md += '| Group | Cases (+/-) | Trigger | First tool | Complete | Strict | False call | Overcall |\n|---|---:|---|---|---|---|---|---|\n';
for (const [key,g] of Object.entries(groups)) md += `| ${key} | ${g.cases} (${g.positive}/${g.negative}) | ${pct(g.trigger)} | ${pct(g.firstAction)} | ${pct(g.complete)} | ${pct(g.strict)} | ${pct(g.falseCall)} | ${pct(g.overcall)} |\n`;
md += '\nTrigger, tool selection, Complete, Strict and Overcall use positive cases; False call uses negative cases. Complete measures the required Gold tool chain, not completion of the entire coding task.\n\n## Failure Layers\n\n| Group | Layer | Cases |\n|---|---|---:|\n';
for(const [key,g] of Object.entries(groups)) for(const [layer,count] of Object.entries(g.failures)) md += `| ${key} | ${layer} | ${count} |\n`;
md += '\n## Input Tokens Per Case\n\nSuccessful task provider requests only; auxiliary CLI title requests excluded. All requests within a case must have a known field to include that case in its distribution. No cross-case token total is reported.\n\n| Group | Covered cases | Mean input | Median input | P90 input |\n|---|---:|---:|---:|---:|\n';
const num = n => n===null?'N/A':n.toFixed(1);
for(const [key,g] of Object.entries(groups)) { const t=g.inputTokens.providerTotalInputTokens; md += `| ${key} | ${t.coveredCases}/${g.cases} | ${num(t.mean)} | ${num(t.median)} | ${num(t.p90)} |\n`; }
md += '\nThese are descriptive results on currently available cases. The four groups have different case coverage. Per-case evidence, scores and source indexes are stored in the corresponding group folder.\n';
fs.writeFileSync(path.join(root,'RESULTS.md'),md);
const cn = `# 已完成 Case 的四组统计\n\n统计时间：${manifest.generatedAt}。共 ${manifest.selectedCaseEvidence} 个去重后的“终端 × 版本 × case”实验单元。\n\n每组使用自身已完成且证据有效的 case 作为分母。同一 case 取最早可评分记录，不按分数挑选重试。未运行、未完成和证据不完整的记录不作为行为失败；只保留四组，不按源码指纹拆组。\n\n`
  + '| 组别 | 有效 case | 正样本 | 负样本 | 触发率 | 首工具正确率 | 完整链成功率 | 严格链成功率 | 误调用率 | 过度调用率 |\n|---|---:|---:|---:|---|---|---|---|---|---|\n'
  + Object.entries(groups).map(([key,g])=>`| ${key} | ${g.cases} | ${g.positive} | ${g.negative} | ${pct(g.trigger)} | ${pct(g.firstAction)} | ${pct(g.complete)} | ${pct(g.strict)} | ${pct(g.falseCall)} | ${pct(g.overcall)} |`).join('\n')
  + '\n\n误调用率以负样本为分母，其余表中比率以正样本为分母。完整链成功率衡量 Gold 要求的工具调用链，不等同于整个编程任务的完成率。各组覆盖的 case 不完全相同，本表是当前已完成数据的描述统计。\n\n## 失败归因\n\n| 组别 | 评分器归因 | 数量 |\n|---|---|---:|\n'
  + Object.entries(groups).flatMap(([key,g])=>Object.entries(g.failures).map(([layer,count])=>`| ${key} | ${layer} | ${count} |`)).join('\n')
  + '\n\n`none` 表示未命中失败层；完整链和严格链仍分别以上表为准。\n\n## 单 Case 输入 Token\n\n只累计该 case 内成功的任务请求，排除 CLI 标题请求。每个 case 的所有纳入请求都具有该用量字段时，才进入相应分布；缺失值不补零。\n\n| 组别 | 输入用量覆盖 | 平均值 | 中位数 | P90 |\n|---|---:|---:|---:|---:|\n'
  + Object.entries(groups).map(([key,g])=>{const t=g.inputTokens.providerTotalInputTokens;return `| ${key} | ${t.coveredCases}/${g.cases} | ${num(t.mean)} | ${num(t.median)} | ${num(t.p90)} |`;}).join('\n')
  + '\n\n四个组目录中保存逐 case 证据、评分、来源索引和统计 JSON。普通输入、缓存读取与缓存写入的分布见 `completed-case-summary.json`；静态注入 token 和目标身份验证尚无完整测量数据。\n';
fs.writeFileSync(path.join(root,'RESULTS.zh-CN.md'),cn+'\n## 报告要求的效果指标缺口\n\n本表不是完整效果指标集。尚缺说明长度与压缩率、部分补充行为和分层效果、统计区间、耗时及用量构成展示。JSON 中现有绑定准确率 100%、前驱违规率 0%、步骤覆盖率及 Pair Exact 有字段或观测问题，不能直接作为有效结果引用。\n');
fs.writeFileSync(path.join(root,'completed-case-summary.json'),JSON.stringify({generatedAt:manifest.generatedAt,total:manifest.selectedCaseEvidence,groups},null,2)+'\n');
await import('./report-final5-effects.mjs');
