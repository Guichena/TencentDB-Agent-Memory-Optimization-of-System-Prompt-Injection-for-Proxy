# final5 数据集改造计划（对照实验）

日期：2026-09-08。语义规则以本文为准。  
**1k 筛选、批次、洞队、与 test100 的关系：以 `TEST1K-PLAN.md` 为准。**  
test100 已冻结：`TEST100-PLAN.md`。不改 `implementations/`，不改旧 `snapshots/final5`，不改 `final5/teams/` 原 1560。

---

## 1. 实验设置（改造必须服从）

对照仓库：`D:\projects\TencentDB-Agent-Memory-submission`

| 项 | 取值 |
|---|---|
| Baseline | `implementations/baseline/`，variant `server_team`，注入 `legacy` |
| Final | `implementations/final/`，variant `V4`，注入 `v4-compact` |
| 数据 / 清单 / catalog / 评分 | 共用 `evaluation/MemoryProxy/` |
| 作者数据 | `evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/teams/<Team>/data/` |
| Skill catalog | 同级 `skill-catalog/`（8 可见 + own+next2 全池） |
| 现状 | 39 Team，1560 Case，**尚未冻结** |

两边跑同一批 Case、同一 catalog、同一评分。改造目标是让 Gold 测的是 **TDAI 该不该调、调哪条**，而不是扫仓库写代码。

基线注入口径：Memory = 身份/偏好/历史结论/项目约定；Skill = 可复用工作流；「改代码 / 写脚本 / 当前轮已够」不必查 Memory。V4 另强调本地源码管当前代码。假 CALL（仓库已有答案）会惩罚 V4。

---

## 2. 窗口怎么进模型（写 Gold 的依据）

读 `skill-catalog/manifest.json` 与 `case-skill-catalog.jsonl`。

| 层 | 是什么 | 是否每 Case 一样 |
|---|---|---|
| 候选池 | 本队 + 后两队全部 Memory/Skill | 对同一 evaluation Team 固定 |
| Skill 第一层 | **8 条**：own 3 + next1 3 + next2 2 | **多数队不固定**。`sha256(seed:case_id) mod 份数` 抽 catalog。仅 T04 三队全队同一份 |
| Skill 可搜 | 导入的全部 Skill | 对 Team 固定 |
| Memory 第一层 | L3 全文 + L2 path/summary | session/身份级，不是 8 选 |
| Memory 检索 | L0/L1 不预注入 | 后两队 L1 进 search |

Skill Gold 链：

```text
该 Case 的 visibleSkillNames 含目标 name  →  ["skill_view"]
不含                                      →  ["skill_search","skill_view_by_id"]
还要读仓库没有的 files[]                   →  再加 skill_files_read
```

以 catalog 的 `targetVisible` 为准，**不要用 `assets.visibility` 猜**。C032 作者写成 search，派生 Gold 已改成 `skill_view`。

Query 必须让 **这 8 条里其余 Skill + 后两队可搜 Skill** 都答不全。只按本队 Skill 正文出题不算完。

---

## 3. 语义硬规则

1. Memory CALL：缺口只在 Memory；仓库、L3、L2 summary、当前 Context 都没有。
2. Skill CALL：缺口只在 Skill 步骤；仓库、Query、Memory 都没有；外队干扰也不能当完整答案。
3. Memory ≠ Skill：事实 vs 步骤，不能互相当答案。
4. 评分不看本地 `rg`/改代码；但 Gold 必须按「本地够不够」来标。
5. Query/Context 禁止工具名、资产 ID、`tdai_`、`should_call`。

合法 `expected_sequence` 仅限契约字面量（`tdai_memory_search`、`skill_view`、`skill_search`+`skill_view_by_id` 等）。

---

## 4. 规模与筛选（先筛再改）

**已改口：见 `TEST1K-PLAN.md`。** 1560 → **全 Pair（跨 SHA）+ best-SHA distractor + 最多 4 条 natural ≈ 1133**，写入 `test1k/`。  
Pair 两端仍必须同一 `base_sha`。unpaired CALL 丢掉。不在原 `teams/` 删行。

Skill `name`、资产 ID、visibility 尽量不动。

---

## 5. Query / Context / Gold 怎么改

对 keep 集合，先改 `assets.json` 正文（去仓库回声、拆重合），再改 Case。

**Memory Pair**

- 正端 Query：问锁定命名/禁令/偏好，不要问「仓库结构是什么」。
- 负端：同一 Query；Context 只贴缺口那一句。
- Gold：`["tdai_memory_search"]` / 负端 `pair_context`。

**Skill Pair**

- 打开该 Case 的 8 个可见名 + 后两队可搜池。
- Query 加本仓库约束，使外队 Skill 答不全。
- 不要把步骤写进 Query。
- Gold 按第 2 节 `targetVisible`。
- 负端 Context 只贴本队目标步骤。

**distractor**：Query 已写清 API；列表里可有同主题干扰，但不必调。

**natural_coding**：单文件短改；少留。

假 CALL（仓库已能答）：整对改 `natural_coding` 或从 keep 删除，禁止留 `should_call=true`。

---

## 6. 执行顺序

按 `TEST1K-PLAN.md` §10。test100 样板已在 `test100/teams/DVG-THREAD-04-TEAM-01/`（C032=`skill_view`）。

---

## 7. 评测

Campaign variants：`server_team`、`V4`。同一 keep 清单、同一 catalog。  
数据改完后加公开墙钟或本地命令上限（不写进 Gold），避免 `natural-completion` 扫大仓库。

指标仍按 Task1：ECR / FCR / TSR / Pair Exact / T_static。主 Token 用注入块，不用全程 `input_tokens`。
