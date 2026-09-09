import { readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const repo=resolve(fileURLToPath(new URL('../',import.meta.url)));
const root=join(repo,'runs/final5-test1k-20260909-consolidated/V4/baseline-aligned-retry');
const summary=JSON.parse(await readFile(join(root,'summary.json'),'utf8'));
for(const client of ['codex','claude-code']){
  const dir=join(root,client),rows=(await readFile(join(dir,'aligned-cases.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const baseline=(await readFile(join(repo,'runs/final5-test1k-20260909-consolidated/baseline',client,'timeout-inclusive-cases.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.caseId).sort(),baseline.map(r=>r.caseId).sort());
  const plan=JSON.parse(await readFile(join(dir,'missing.plan.json'),'utf8'));
  for(const kind of ['unrun','attempted-without-valid-result']){
    const selected=rows.filter(r=>r.category==='missing'&&(kind==='unrun'?r.reason==='no-recorded-attempt':r.reason!=='no-recorded-attempt'));
    const ids=selected.map(r=>r.caseId),set=new Set(ids);
    const part={...plan,campaignId:plan.campaignId+'-'+kind,selectedCaseIds:ids,slots:plan.slots.filter(s=>set.has(s.caseId))};
    assert.equal(part.slots.length,ids.length);
    await writeFile(join(dir,kind+'.plan.json'),JSON.stringify(part,null,2)+'\n');
    await writeFile(join(dir,kind+'.case-ids.txt'),ids.join('\n')+(ids.length?'\n':''));
    summary.groups[client][kind]=ids.length;
  }
  const g=summary.groups[client];assert.equal(g.unrun+g['attempted-without-valid-result'],g.missing);
  const all=JSON.parse(await readFile(join(dir,'all.plan.json'),'utf8'));
  assert.equal(new Set(all.selectedCaseIds).size,g.retryTotal);
  assert(all.slots.every(s=>s.variant==='V4'));
  assert.deepEqual(all.selectedCaseIds.toSorted(),rows.filter(r=>r.category!=='keep').map(r=>r.caseId).sort());
}
await writeFile(join(root,'summary.json'),JSON.stringify(summary,null,2)+'\n');
let md='# 与 baseline 对齐的 V4 补跑与重跑\n\n'+summary.generatedAt+'\n\n| 终端 | baseline 范围 | V4 无运行记录 | 跑过但无有效结果 | 工具链失败/误调用 | 仅严格链不达标 | 保留 | 补跑/重跑合计 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n';
for(const [c,g] of Object.entries(summary.groups))md+=`| ${c} | ${g.baselineCases} | ${g.unrun} | ${g['attempted-without-valid-result']} | ${g['behavior-failure']} | ${g['strict-only']} | ${g.keep} | ${g.retryTotal} |\n`;
md+='\n以本轮含交互超时的 baseline case 为固定范围，同终端、同 case ID 对齐。V4 采用最早有效完成记录评分，不按最高分选择。\n\n每个终端目录提供以下互斥分组：\n\n- `unrun.plan.json`：没有 checkpoint 尝试记录，需要补跑。\n- `attempted-without-valid-result.plan.json`：已有尝试，但没有可评分结果，包括超时、错误或证据不完整。\n- `behavior-failure.plan.json`：正样本工具链失败，或负样本误调用。\n- `strict-only.plan.json`：完整链成功，但严格链不达标或存在过度调用。\n\n`all.plan.json` 是上述四组去重并集；`missing.plan.json` 是前两组并集。每份计划都有对应 `.case-ids.txt`。`aligned-cases.jsonl` 列出全部对齐 case，`retry-cases.jsonl` 包含待运行 case 的 baseline 对照、V4 评分、失败原因和历史尝试路径。\n\n这里只生成清单，尚未执行。无运行记录不排除正在启动但尚未落盘的任务；执行前应刷新并检查活跃任务，避免重复运行。按失败挑选的重跑结果另行保存，不覆盖本轮原始对比。\n';
await writeFile(join(root,'README.zh-CN.md'),md);
console.log(JSON.stringify(summary.groups,null,2));
