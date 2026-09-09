# 线程 B 开工提示词（原样整段交给子 agent）

你负责 **test1k 线程 B**。4 并发、5 波、波间串行。一队必须「资产 + 该队全部 keep Case」同一原子任务写完。B 全是 **整队重写**（无 test100 overlay、无洞预留）。

根目录：`D:\projects\TencentDB-Agent-Memory-submission\evaluation\MemoryProxy\eval\tool-prompt-bench\formal-dataset\final5\`

必读：`TEST1K-PLAN.md`、`DATASET-REWORK-DESIGN.md`。样板只读：`test100/teams/DVG-THREAD-04-TEAM-01/`。

## 波次（每波最多 4 队并行，写完再开下一波）

```text
B1  DVG-THREAD-04-TEAM-03, T04, T01, T02
B2  T06, T07, T08, T09
B3  T10, T12, T13, dvg01-junior
B4  dvg03_cpp100days, dvg03_cse491, dvg03_cryptoproc, dvg05_goeko_github_io
B5  dvg06_mindfulai, dvg06_mspr, t02r17-ipv4
```

B5 只有 3 队。不要做 A 的队（cookies、colorpalette、test100 十队、T04-T02、pygpt、T15/T14/T03/T11、两个 freight）。不要重跑 `test1k/build_scaffold.py`。

## 禁止

- 改 `final5/teams/`、`test100/`。
- 改 `keep-case-ids.jsonl`、`case-windows.jsonl`、`test1k/skill-catalog/`。
- 新开 `case_id`；改资产 `id`、Skill `name`、`visibility`、`base_sha`。
- Query/Context 出现工具名、资产 id、`tdai_`、`should_call`。
- 把仓库/README 已有 API 标成 CALL。
- 下载公开 Skill 当附件。
- 给瘦队灌新 Pair（`T04` keep=14、`mspr` keep=26 已有两层，只改现有 keep 行，不新开 id）。

只写：`test1k/teams/<TEAM>/data/{assets.json,cases.jsonl,gold.jsonl,evidence.jsonl}`  
另写：`test1k/teams/<TEAM>/_rewrite_receipt.json`。

## 每队流程

1. 读该队 `assets.json`、`cases.jsonl`、`gold.jsonl`、`evidence.jsonl`；从 `test1k/keep-case-ids.jsonl` / `case-windows.jsonl` 筛该 `team_id`。
2. **先改资产，再改 Case。** 没有定稿资产不准写 CALL。
3. 全部 L1 `content`：改成仓库 + L3 + README **都没有** 的锁定名/禁令/偏好。token 本队独有（带队名碎片）。不要复述源码。
4. 全部 Skill：改 `description`（一行，进 listing）+ `content`（仓库没有的步骤门）。description **不要**写附件 token。Skill CALL 的 Query 必须能对上 **新 description** 的任务用语。
5. **恰好 1 个已有 Skill** 加：
   ```json
   "files": [
     {"path": "references/<short>.md", "content": "# ...\n<不可猜 token>\n"},
     {"path": "LICENSE", "content": "Invented lock for this evaluation scene. MIT-0.\n"}
   ]
   ```
   正文只写「见该 path」。每 Case 只考一个 path。邻队不要复用同一 token。
6. 按 keep **每一行**写 Query/Gold/evidence（不增删行、不改 `case_id`/`base_sha`）。
7. 从已有 Skill Pair 里 **升级一对** 为 files 链（不要新开 id）。其余 Skill Pair 保持正文-only。
8. 每队结束后至少：1 Memory 对、1 正文 Skill 对、1 files 对（`mspr`/`T04` 现网两层都有，改写即可）。

## Case 写法

- Pair 两端最后一条 user Query **字节相同**，只改 Context。
- 正端 Context：缺口不在这轮聊天，不贴答案。
- 负端 Context：整句 L1 / Skill 正文 / 附件那一行。`no_call_basis=pair_context`。
- 可改成两段 user；丢掉无用 assistant 轮。
- distractor：Query 已写死本地 API；8 条可有同主题但不必调。
- natural：当前 sha 单文件短改。
- 假 CALL：整对改 natural，禁止留 `should_call=true`。

Gold CALL：`should_call=true` `tool_family=memory|skill` `target_asset_ids=[一个]` `pair_id` `expected_sequence` `gold_reason`（缺口在哪、仓库/L3为何不够、另一家族为何不够、8条其余+next2为何不够、为何这步链）。files 加 `target_resource_paths`。

Gold NO_CALL：`should_call=false` `tool_family=none` `expected_sequence=[]` `no_call_basis`。

Skill 链 **只看该 Case `targetVisible`**，不用 `visibility`，不用批 0 `derivedSequence`：

```text
Memory                         → ["tdai_memory_search"]
name ∈ 8                       → ["skill_view"]
name ∉ 8                       → ["skill_search","skill_view_by_id"]
答案在 files[]                 → 再加 skill_files_read
```

`evidence.original_prompt` = Query。`source_locator=case:<case_id>`。

## 单队出门检查

- Pair Query 字节相同。
- CALL 指回已改 content 或 files path。
- files path 在该 Skill `files[]` 里。
- Query 无 `tdai_` / `should_call`。
- keep 行数不变。
- 不跑全量 `validate_test1k.py`。
- `_rewrite_receipt.json`：`team`、`files_skill`、`files_path`、`n_cases`、`mem_pairs`、`skill_pairs`、`files_pairs`。

## 样板

`test100/teams/DVG-THREAD-04-TEAM-01/`：C001 Memory，C032 `skill_view`，C010 view+files（KindleWisp 只在附件），C003 distractor，C006 natural。
