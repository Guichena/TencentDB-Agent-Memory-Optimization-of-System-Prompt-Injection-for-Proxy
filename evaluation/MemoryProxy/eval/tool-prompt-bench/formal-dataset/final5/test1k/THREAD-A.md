# 线程 A 开工提示词（原样整段交给子 agent）

你负责 **test1k 线程 A**。4 并发、5 波、波间串行。一队必须「资产 + 该队全部应改 Case」同一原子任务写完。

根目录：`D:\projects\TencentDB-Agent-Memory-submission\evaluation\MemoryProxy\eval\tool-prompt-bench\formal-dataset\final5\`

必读：`TEST1K-PLAN.md`、`DATASET-REWORK-DESIGN.md`。样板只读：`test100/teams/DVG-THREAD-04-TEAM-01/`。

## 波次（每波最多 4 队并行，写完再开下一波）

```text
A1  dvg06_cookies, dvg06_colorpalette, DVG-THREAD-04-TEAM-01, T05
A2  DVG-THREAD-04-TEAM-02, dvg06_banzukesurfing, dvg09_judgegpt, dvg03_gmdh
A3  dvg05_pbrudny_jobsforit, dvg03_planpal, dvg10_ultimate_utils, dvg09_playbilling
A4  dvg08_temporalio_temporal, dvg02-pygpt, T15, T14
A5  T03, T11, DVG07_T01_frieghtkb, DVG07_T02_frieghtkb_fork
```

不要做 B 的队。不要重跑 `test1k/build_scaffold.py`。

## 禁止

- 改 `final5/teams/`、`test100/`。
- 改 `keep-case-ids.jsonl`、`case-windows.jsonl`、`test1k/skill-catalog/`。
- 改 notes 以 `test100-overlay` 开头的 Case（cases/gold/evidence 整行都不动）。
- 改 overlay 已锁定的 Memory content、Skill content/description、`files[]`。
- 新开 `case_id`；改资产 `id`、Skill `name`、`visibility`、`base_sha`。
- Query/Context 出现工具名、资产 id、`tdai_`、`should_call`。
- 把仓库/README 已有 API 标成 CALL。
- 下载公开 Skill 当附件。

只写：`test1k/teams/<TEAM>/data/{assets.json,cases.jsonl,gold.jsonl,evidence.jsonl}`  
另写：`test1k/teams/<TEAM>/_rewrite_receipt.json`（该队收工证明）。

## 三类队怎么干

### 1) 洞：`dvg06_cookies`

现网 L1/Skill 是仓库回声，40 条曾全是 NO_CALL。keep 17 条。

1. 先改 `assets.json`：所有 L1 改成仓库没有的锁定名/禁令（本队独有 token，带 `Ck`/`cookies` 前缀风格）。选 **一个已有 Skill** 加 `files[]`：`references/<short>.md` + `LICENSE`（MIT-0）。SKILL.md 正文只指路，答案只在附件。description 一行，不要把附件 token 写进 description。
2. 改写 Case（复用 id，不新建）：
   - `c001`/`c002` → Memory Pair。`pair_id=dvg06_cookies__pair_hole_mem`。Gold 正 `tdai_memory_search`，负 `pair_context`。
   - `c003`/`c004` → Skill/files Pair。`pair_id=dvg06_cookies__pair_hole_skill`。打开该正端在 `case-windows.jsonl` 的 `visibleSkillNames`：在 8 条 → `["skill_view","skill_files_read"]`，否则 `["skill_search","skill_view_by_id","skill_files_read"]`。`target_resource_paths` 命中附件 path。
3. 其余 keep 行按新资产重写 Query/Gold（distractor/natural 对照新 8 条）。

### 2) 洞：`dvg06_colorpalette`

已有 6 对 Skill，0 条 Memory CALL。keep 19 条。

1. 改资产：至少 1 条 L1 改成不可猜锁定（不要用仓库里的 `#53b5b0` 等）。其余 L1 去教科书回声。选 1 个 **未当 files 也行** 的已有 Skill 加 `files[]`（本队还没有 files Pair）。不要动 6 对 Skill 的 name。
2. 从 keep 里两条 `role=natural`（优先最短 Query）改成 Memory Pair：`pair_id=dvg06_colorpalette__pair_hole_mem`。
3. 已有 Skill Pair：按新正文/窗口重写 Query/Gold；序列以 **该 Case windows.targetVisible** 为准（作者旧 search 但目标在 8 条 → `skill_view`）。把其中 **一对** 升级为 files 链（答案只在附件）。
4. 其余 distractor/natural 重写。

### 3) test100 十队（A 里除 cookies/colorpalette/T04-T02/pygpt/T15/T14/T03/T11/freight 外的那些）

`DVG-THREAD-04-TEAM-01` `T05` `dvg06_banzukesurfing` `dvg09_judgegpt` `dvg03_gmdh` `dvg05_pbrudny_jobsforit` `dvg03_planpal` `dvg10_ultimate_utils` `dvg09_playbilling` `dvg08_temporalio_temporal`

1. 列出该队 keep 中 `test100-overlay` 的 `target_asset_id` / `planned_file_path` → **禁止改这些资产字段**。
2. **不要再加第二个 `files[]`。**
3. overlay 行：跳过。
4. 其余 keep：只给 **未出题** 的 L1/Skill 补锁定，再写这些新 Case。禁止第二对 Memory 再考 overlay 已考 token（如 Forest Spirit、coverage-gap:、banzukePicks、BZLS#）。
5. 原 Gold 序列与 `targetVisible` 冲突时以窗口为准。不必再造 files 对。

### 4) 全量队（A 挪来的 8 队）

`DVG-THREAD-04-TEAM-02` `dvg02-pygpt` `T15` `T14` `T03` `T11` `DVG07_T01_frieghtkb` `DVG07_T02_frieghtkb_fork`

与线程 B 相同：改全部 L1 + 全部 Skill description/content；恰好 1 个 Skill 加 files；每个 keep CALL 目标都有不可猜缺口；每队至少 1 Memory 对、1 正文 Skill 对、1 files 对（从已有 Skill Pair 升级一对即可）。

## 每队写法（资产 → Case）

1. 读 `test1k/teams/<TEAM>/data/{assets,cases,gold,evidence}.json(l)`、`keep-case-ids.jsonl` 该队行、`case-windows.jsonl` 该队行。
2. 先定稿 `assets.json`。token 必须本队独有（建议含队名碎片）。files token 像 `KindleWisp`，仓库搜不到。
3. Skill `description` 一行，将来进 listing。Skill CALL 的 Query **必须能对上这句 description 的任务用语**，但不要把答案 token 写进 description。
4. Pair：两端最后一条 user Query **字节相同**；只改前面的 Context。正端 Context 不贴答案。负端 Context = 整句 L1 / Skill 正文 / 附件那一行。
5. 可改成两段 user（context + query），丢掉无用 assistant 轮。
6. Gold CALL：`should_call=true` `tool_family=memory|skill` `target_asset_ids=[一个id]` `pair_id` `expected_sequence` `gold_reason`（五件事：缺口在哪段资产、仓库/L3为何不够、另一家族为何不够、8条其余+next2为何不够、为何这步链）。files 正端加 `target_resource_paths`。
7. Gold NO_CALL：`should_call=false` `tool_family=none` `expected_sequence=[]` `no_call_basis=pair_context|distractor|natural_coding`。
8. Skill 链 **只看该 Case `case-windows.jsonl.targetVisible`**，不要用 `assets.visibility`，不要用批 0 的 `derivedSequence`（还没有 files）。
   - Memory：`["tdai_memory_search"]`
   - 在 8 条：`["skill_view"]`；+files 再加 `skill_files_read`
   - 不在 8 条：`["skill_search","skill_view_by_id"]`；+files 再加 `skill_files_read`
9. `evidence.original_prompt` = 最后一条 user Query。`source_locator=case:<case_id>`。
10. 假 CALL：整对改 natural 或保持 NO_CALL，禁止 `should_call=true`。

## 单队出门检查

- overlay 行若存在：与开工前字节一致。
- 非 overlay Pair Query 字节相同。
- CALL 能指回一段已改 content 或一个 files path。
- files path 存在于该 Skill `files[]`。
- Query 无 `tdai_` / `should_call`。
- 不跑全量 `validate_test1k.py`（keep 计划序列还没 files，会误报）。
- 写 `_rewrite_receipt.json`：`team`、`overlay_skipped`、`files_skill`、`files_path`、`hole_ids`、`cases_rewritten`、`notes`。

## 样板字段

正端 Memory Query 风格见 `test100/teams/DVG-THREAD-04-TEAM-01` 的 C001：先说锁定不在这轮聊天，再问内部名/禁令。负端 Context 贴整句 L1。
