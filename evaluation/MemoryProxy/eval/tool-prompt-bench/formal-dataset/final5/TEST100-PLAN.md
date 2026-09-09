# test100 执行计划

对照仓：`D:\projects\TencentDB-Agent-Memory-submission`  
设计总则：同目录 `DATASET-REWORK-DESIGN.md`。  
本文件只规定 **第一批 100 条怎么落地**。

## 0. 写哪里

```text
evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test100/
  README.md
  keep-case-ids.jsonl
  case-windows.jsonl
  teams/<Team>/data/
    team.json
    assets.json      # 该队全量资产（改正文 + 给 1 个 Skill 加 files[]）
    cases.jsonl      # 仅 10 条
    gold.jsonl
    evidence.jsonl
```

**不改** `final5/teams/` 现有 39×1560。提示词和 runner 指到 `test100/`。  
批次 0 已落地：`test100/keep-case-ids.jsonl`、`test100/case-windows.jsonl`、每队 10 行。冻死 id 见 §6。

原则：先定资产（Memory content、Skill 正文、`files[]`），再按资产造 Query/Context/Gold。复用 **旧 case_id**，catalog 抽签不变。

---

## 1. 流水线

```text
1. 复制 10 队五文件 → test100/teams/
2. 每队 assets.json：改 Memory/Skill 正文；给 1 个已有 name 加 files[]
3. 从 skill-catalog/case-skill-catalog.jsonl 抽这 100 个 id 的 8 条列表 → case-windows.jsonl
4. 每个目标资产写一对 Case（正藏缺口、负贴缺口）
5. Gold 链只看该 Case 的 visibleSkillNames，不看 visibility
```

---

## 2. 10 队 × 10 条

每队：Memory Pair×2 + Skill 正文 Pair×1～2 + files_read Pair×1 + distractor×1 + natural×1 = 10。  
T04-T01 三个 own Skill 全在 8 条里，**没有** search 步；缺的 search Pair 放在 T05 / banzuke（catalog 里 in8=false）。

### DVG-THREAD-04-TEAM-01（`0274abb4`，catalog 全队同一份）

8 可见 own：`unity-navmesh-patrol` / `unity-procedural-terrain` / `unity-enemy-behavior`  
干扰：面试 / AWS / JDBC / Android XML / i18n

| id | 角色 | 目标资产 | Gold |
|---|---|---|---|
| C001 / C002 | Memory Pair | `game_concept` | `tdai_memory_search` |
| C029 / C030 | Memory Pair | `terrain_design` | `tdai_memory_search` |
| C032 / C033 | Skill 正文（在 8 条内） | `enemy_behavior` | **`skill_view`**（勿抄旧 search） |
| C032 另做 files 或单独一对见下 | files_read | 同一 Skill + `references/sight-gate.md` | `skill_view` + `skill_files_read` |
| C003 | distractor | — | 不调（Query 已写 Raycast） |
| C006 | natural | — | 不调 |

files_read 不要占用 C032 正文 Pair。用 **C010/C011 改造成 files_read Pair**（旧 Memory 架构题丢掉）：Query 问附件里 Play 前 Tag/Layer 检查；正文只写「见 references/sight-gate.md」。

资产改写：
- Memory `game_concept`：内部名 Forest Spirit / Evil Spirits，禁止对外文档名。
- Memory `terrain_design`：禁止用手雕 Terrain prefab 替换 WorldGenerator+Perlin。
- Skill `enemy_behavior`：状态门（禁止 OnTriggerStay）；附件写 TagManager 必须有 Player、playerLayer 不得为 Enemy。

### T05（两份 catalog）

| id | 角色 | 目标 | Gold |
|---|---|---|---|
| `c_05ac2a5c98a1a3a6` / `c_0712f427d1b1435e` | Memory | `coverage_priorities` | search |
| `c_fe64ad918b22bc8b` / `c_d647e6e21bfc139e` | Memory | `provider_transport` | search |
| `c_0c03d7a87bb604cc` / `c_f21f92f9641e55da` | Skill 在 8 条（cat02） | `test_llm_providers` | **view** |
| `c_cfcd7dfe4c055f59` / `c_3381e45f2f915dcb` | Skill 不在 8 条（cat01） | `test_coverage` | **search→view_by_id** |
| 上列 view 对改为 files 则另选一对；推荐给 `test-llm-providers` 加 `references/provider-fetch-checklist.md`，用 cat02 那对做 **view+files_read**，search 对保持正文-only | | | |
| 再取一条短 natural + 一条 distractor（原 natural_coding） | | | 不调 |

### dvg06_banzukesurfing

Memory：`c001/c002` localstorage_patterns；`c003/c004` jest_setup（改成锁定约定，非复述测试文件）。  
Skill 不在 8 条：`c013/c014` jest-test-refactor（cat01 in8 false）→ search 链。  
Skill 在 8 条：catalog02 的 `initialize-lifecycle` 找对应 case_id 做 view。  
files：给 `localstorage-debug` 加 `references/key-trace.md`。  
distractor + natural 各 1。

### dvg10_ultimate_utils

Memory：`m01_call/none` hf prefs；`m02_call/none` wandb 锁定。  
Skill 在 8 条：`s01` hf-training-setup → view。  
Skill：`s02` wandb-sweep + `files[]` → view+files_read（cat01 可见）。  
search 对：选一个 cat 里 in8=false 的 own skill（查 windows）。  
distractor + natural。

### dvg09_playbilling

Memory：`m01` billing 6.0.1+PlayBillingManager 若仓库已有则改成「公钥必须从 Unity 传入」`mem_security_practice`（`m` 里找该 target 的 pair）。优先 `mem_security_practice` 对应 pair。  
Skill：`unity-bridge-setup` 在 cat02 的 8 条内 → view；`add-acknowledgement` 在 cat02 in8 false → search。  
files：`add-acknowledgement` 加 `references/ack-states.md`（仅 PURCHASED 可 ack）。  
distractor + natural。

### dvg03_gmdh

Memory：`m01` csv protocol；`m` website_structure 对应 pair（锁定 IA）。  
Skill：`skill_biographical_data_schema` cat01 in8 true → view；`skill_csv_batch_processing` cat02 in8 false → search。  
files：`dh-data-cleaning` 加日期校验表。  
distractor + natural。

### dvg03_planpal

Memory：`m02` auth-token httpOnly 7 天；`m` cors 禁止 origin *。  
Skill：`cookie-debug` cat01 in8 true → view；files 加「禁止用 document.cookie 判断 httpOnly」。  
另一 Skill 用 cat 中 in8 false 的 own（查 windows）。  
distractor + natural。

### dvg09_judgegpt

Memory：`m02` 密钥禁止服务端硬编码；`mem_code_style` tab 缩进 pair。  
Skill：`add-api-key-input` cat01 in8 true 但旧 Gold 是 search——**改成 view**；`add-api-key-input` cat02 in8 false 的 s03 → search。  
files：input 的 placeholder/password 规则放附件。  
distractor + natural。

### dvg05_pbrudny_jobsforit

Memory：`m02` commit 必须带 ChatGPT share 链接；`mem_ui_migration` Ant→MUI。  
Skill：`component-refactor` cat01 in8 true → view；`package-cleanup` cat02 in8 false → search。  
files：commit 消息格式示例放附件（若挂在 markdown-doc）。  
distractor + natural。

### dvg08_temporalio_temporal

Memory：`m009/m010` snake_case；`m011/m012` nDC→ndc。  
Skill：`python-file-renaming` cat01 in8 true → view；`camel-to-snake-conversion` cat01 in8 false → search。  
files：缩写表放 `references/acronyms.md`。  
distractor + natural。

---

## 3. 每条怎么写（资产 → Case）

**Memory**  
1. 改 `content` 为一句仓库+L3 没有的锁定。  
2. 正端 Query 问这句，Context 不给答案。  
3. 负端同一 Query，Context=整句 content。  
4. Gold：`["tdai_memory_search"]`，target=该 L1。后两队 L1 不能当完整答案。

**Skill 正文**  
1. 改正文为仓库没有的步骤。  
2. 查该 case_id 的 `visibleSkillNames`。  
3. 正端 Query 问流程、不写步骤；加本仓库词，挡住另外 7 条 + 后两队。  
4. 负端 Context=步骤。  
5. 在 8 条 → `["skill_view"]`；否则 `["skill_search","skill_view_by_id"]`。

**files_read**  
1. 资产阶段就加 `files: [{path, content}]`。SKILL.md 只写「见该 path」。  
2. Query 问附件里才有的一行。  
3. Gold 在 view/search 链后加 `skill_files_read`，`target_resource_paths: [path]`。  
4. 负端 Context=附件那一行。

**distractor / natural**  
对照已存在的 8 条 Skill：同主题但不必要；短本地改。

禁止 Query 里出现工具名、资产 id。

---

## 4. 校验

- 100 条，10 队。  
- Pair Query 字节相同。  
- 每条 CALL 能指回一段 Memory content、Skill 正文或一个 file path。  
- Skill 序列与 `case-windows.jsonl` 的 targetVisible 一致。  
- 至少 8 对 files_read（每队 1 对，T04 用 C010/C011）。  
- 至少 6 对 search 链（T04 没有，其它队补）。

---

## 5. 执行顺序（必须拆批）

一次跑 10 队会爆上下文。按队原子，不要「先改完全部 assets 再写 100 条 Case」。

| 批次 | 内容 | 状态 |
|---|---|---|
| **0 脚手架** | 建 `test100/`、拷 10 队、裁成冻死的 10 条、写 `keep-case-ids.jsonl` + `case-windows.jsonl` | **已完成** |
| **1a T04 资产** | 只改 `test100/teams/DVG-THREAD-04-TEAM-01/data/assets.json`（两 Memory 锁定 + Skill 状态门 + `files[]`） | **已完成** |
| **1b T04 Memory** | 只写 C001/C002、C029/C030（Query/Gold/evidence） | **已完成** |
| **1c–1e T04 Case** | C032/C033 view、C010/C011 files、C003/C006 | **已完成** |
| **2–10** | 余下 9 队资产 + 10 条 Case/Gold | **已完成** |
| **11 校验** | Pair Query 字节、Gold vs keep 序列、10 对 files、9 对 search | **已完成**（`python test100/validate_test100.py`） |
| **评测** | 提示词指到 `test100/` | 不要和写数据绑在一起 |

再生脚手架：`python test100/build_scaffold.py`（会覆盖 `test100/teams/` 的拷贝；已改过的资产会被打回旧稿，改资产后不要重跑）。

---

## 6. 冻结表（批次 0，以 `test100/keep-case-ids.jsonl` 为准）

每队 10 槽：Memory×2 + in8 Skill（view 或 view+files）+ 不在 8 条 Skill（search 或 search+files）+ distractor + natural。  
Skill Gold **只看该 Case 的 `case-windows.jsonl.targetVisible`**。同一 Pair 的 CALL/NONE 可能抽到不同 catalog，序列只看正端。

为塞进 10 槽，相对上文 §2 原文的取舍（资产仍留，只是不出题）：

| 队 | 10 个 case_id | 计划链 / 改靶 |
|---|---|---|
| T04-T01 | C001/C002 mem `game_concept`；C029/C030 mem `terrain_design`；C032/C033 view `unity-enemy-behavior`；C010/C011 view+files 同 Skill `references/sight-gate.md`；C003 dist；C006 nat | 无 search |
| T05 | coverage_priorities；provider_transport；`c_0c03…`/`c_f21f…` view+files `test-llm-providers`；`c_cfcd…`/`c_3381…` search `expand-vitest-coverage`；`c_5e9a…` dist；`c_dfee…` nat | search 对旧 Gold 是 view，已改 |
| banzuke | c001–c004 两 Memory；c013/c014 search `jest-test-refactor`；c027/c028 view+files `localstorage-debug`；c005 dist；c007 nat | 不出 initialize-lifecycle。c005/c007 旧是 Memory CALL，要改写成 dist/nat |
| ultimate | m01 hf；m02 wandb；s02 view+files `wandb-sweep-workflow`；s05 **改靶** `vectoring-research-planning` search；none_02 dist；none_01 nat | 不出 s01。s05 原 ml-patent |
| playbilling | m01 **改靶** `mem_security_practice`；m03 subscription；s_pilot01 view `unity-bridge-setup`；m04 search+files `add-acknowledgement` `ack-states.md`；none_nat08 dist；none_nat01 nat | s_pilot 旧 search→view；m04 旧 view→search |
| gmdh | m01 csv；k03 website_structure；s01 search `csv-batch-processing`；s_sa01/none_sa02 view+files `dh-data-cleaning`；none_sa03 dist；none_sa05 nat | 不出 biographical。s01 旧 view→search |
| planpal | m02 auth-token；m03 cors；s01 view+files `cookie-debug`；s02 **改靶** `nextjs-api-setup` search；n06 dist；n04 nat | s02 原 nestjs-auth |
| judgegpt | m02 api key；m04 tab；s01 **改靶** `add-api-key-input` view+files；s03 同技能 search；none_nat01 dist；none_nat03 nat | s01 原 setup-sqlite |
| jobsforit | m02 commit；m04 Ant→MUI；s01 view+files `component-refactor` `hooks-conversion.md`；s02 search `package-cleanup`；n01 dist；n03 nat | files 不挂 markdown-doc |
| temporal | m009/m010 snake_case；m011/m012 nDC；s019/s020 view `python-file-renaming`；s021/s022 search+files `camel-to-snake` `acronyms.md`；n008 dist；n001 nat | s021 旧 view→search |

合计：files_read **10 对**，search **9 对**（T04 没有）。`test100/` 已按上表改写资产与 100 条 Case/Gold。
