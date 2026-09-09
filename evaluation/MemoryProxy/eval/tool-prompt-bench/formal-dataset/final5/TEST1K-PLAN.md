# test1k 执行计划（大规模改造）

日期：2026-09-08。本文是 **1k 对照集的唯一执行计划**。  
语义总则仍见 `DATASET-REWORK-DESIGN.md`。test100 已冻结，见 `TEST100-PLAN.md` / `test100/README.md`。  
旧 `REWORK-PLAN.md` §4「每队一个 SHA / 980–1030」作废，以本文为准。

对照仓：`D:\projects\TencentDB-Agent-Memory-submission`。

---

## 0. 已定口径

| 项 | 决定 |
|---|---|
| 规模 | **全 Pair**（跨 SHA）+ best-SHA distractor + 最多 4 条 natural ≈ **1133** |
| 目标口径 | 「约 1100」 |
| 洞 | 只补缺层：`cookies` 造 1 Memory 对 + 1 Skill/files 对；`colorpalette` 造 1 Memory 对。瘦队（mspr/`T04`）不灌 Pair |
| test100 | **已完成的 10 条冻死，1k 里禁止改 Query/Gold/资产锁定。** 同队其余 keep **可以追加**（批 2），不得重做那 10 个 id |
| 原 1560 | `final5/teams/` **一行不改** |
| 附件 | 跟 test100：自造不可猜 token + `LICENSE`；不下载公开 Skill |
| listing | 8 条 **id/name 冻死**（`case_id` 抽签）。description 等 **39 队资产全部改完** 再从 `assets.json` 刷一次 |
| 评测 | 另做。test100 与 test1k **禁止导入同一 TDAI space** |

实验对照不变：baseline=`server_team`/`legacy`，final=`V4`/`v4-compact`。假 CALL（仓库已能答）惩罚 V4，缺口必须只在 TDAI。

---

## 1. 写哪里（三套隔离）

```text
formal-dataset/final5/
  teams/          ← 原 39×1560，只读
  test100/        ← 已冻结 10×10，只读
  test1k/         ← 本次唯一写入
    README.md
    keep-case-ids.jsonl
    case-windows.jsonl
    teams/<Team>/data/{team.json,assets.json,cases.jsonl,gold.jsonl,evidence.jsonl}
    skill-catalog/          ← 最后从 assets 刷 description
    validate_test1k.py
    build_scaffold.py
```

评测指向：

```text
FINAL5_TEAMS_ROOT=.../final5/test1k/teams
FINAL5_SKILL_CATALOG_BINDINGS=.../final5/test1k/skill-catalog/case-skill-catalog.jsonl
FINAL5_PLAN=.../final5/test1k/manifests/<plan>.json
```

不要指 `final5/teams/`，不要和 test100 混导入。

---

## 2. Keep 规则（筛完再改字）

对每个队、每条 Case（`cases.jsonl` ⋈ `gold.jsonl`）：

1. **成对 Pair**：`pair_id` 两端都在、一正一负、**两端 `base_sha` 相同** → **所有 SHA 都留**。
2. **unpaired CALL**（`should_call=true` 且无完整负端）→ **丢**，一行不改。
3. **distractor**：只留 **Pair 最多的那个 SHA** 上的全部 distractor（其它 SHA 的 distractor 丢）。
4. **natural_coding**：只留该 best SHA，最多 4 条。挑选：该 SHA 上 `no_call_basis=natural_coding` 按「最后一条 user 消息字符数升序，同分按 `case_id`」。
5. 其它 NO_CALL → 丢。
6. **test100 十队：** keep 仍按 1–5 收全 Pair。其中已在 `test100/keep-case-ids.jsonl` 的 10 个 id **原样覆盖、禁止再改**；其余 keep id **追加**（只写这些新行）。覆盖后若某 `pair_id` 只剩负端（例如 banzuke `c005` 改成 distractor，原配 `c006` 悬空）→ **丢掉残端**，禁止 unpaired CALL。
7. **洞位预留：** 强制 keep `dvg06_cookies__c001`–`c004`（批 1 要改写成 Pair）。

不要「再留一个第二 SHA」：多出来的 Pair 本来就是一 commit 一对。评测已按 case 绑 `baseSha`。

**预估（改资产前，洞填充不增行）：**

| | 数 |
|---|---|
| 队 | 39 |
| 成对 Pair | 467 |
| distractor（best SHA） | 100 |
| natural（封顶 4） | 99 |
| **keep 合计** | **1140**（批 0 实数；估 1133 + overlay 强制 9 − 悬空负端 2） |
| 其中 test100 已完成 | 100（冻死） |
| CALL mem / skill | 237 / 228 |

洞填充只把 keep 内 NO_CALL **改写成** Pair，不增行。

丢掉的 Case **拷进 test1k 时直接不拷**，不在原目录删行。

`team.json.case_count` = 该队 keep 条数。

---

## 3. 洞队（缺层才造，不灌数量）

| 队 | 现网 | 动作 |
|---|---|---|
| `dvg06_cookies` | 40 条全 NO_CALL。L1/Skill 都在，但是仓库回声 | 改资产；从 keep 的 distractor/natural **改写** 2 对：Memory + Skill/files |
| `dvg06_colorpalette` | 6 对 Skill，0 条 Memory CALL | 改 1 条 L1；从 keep NO_CALL **改写** 1 对 Memory |
| `dvg06_mspr` / `T04` / `DVG-THREAD-04-TEAM-01` | 两层都有 | **不造新 Pair**。T04-T01 用 test100 那 10 条 |

约束：

- 不删队（catalog next1/next2 还指着它们）。
- 不新开 `case_id`（抽签冻死）。
- 必须成对。禁止 unpaired CALL。
- 禁止把仓库 API 标成 CALL。

cookies 建议占用：`c001/c002` → Memory 对；`c003/c004` → Skill/files 对。  
colorpalette：best SHA 上两条最短 natural → Memory 对。  
`pair_id` 新赋：`dvg06_cookies__pair_hole_mem` / `__pair_hole_skill`，`dvg06_colorpalette__pair_hole_mem`。

---

## 4. 与 test100 的关系

test100 十队：

`DVG-THREAD-04-TEAM-01` `T05` `dvg06_banzukesurfing` `dvg10_ultimate_utils` `dvg09_playbilling` `dvg03_gmdh` `dvg03_planpal` `dvg09_judgegpt` `dvg05_pbrudny_jobsforit` `dvg08_temporalio_temporal`

脚手架时：

1. 从 `final5/teams/` 拷 39 队五文件，裁成 keep 行。
2. 这 10 队：`assets.json` **整文件覆盖**为 `test100/teams/<Team>/data/assets.json`。
3. 这 10 队里已完成的 `case_id`：**整行覆盖**为 test100 的 cases/gold/evidence，**禁止再改**。
4. 这 10 队 **其余 keep 行（追加）**：不碰已完成 id；只给未出题的 L1/Skill 补锁定，再写这些新 Case（§6.4）。禁止改 test100 已锁定的 content/files。

---

## 5. 资产改造规范（先资产，再 Case）

**禁止先写 Query 再找资产凑。** 没有定稿 `assets.json` 不准写该队 keep CALL。

### 5.1 动什么、不动什么

| 动 | 不动 |
|---|---|
| 非 test100 队：全部 L1 `content` + 全部 Skill `description`/`content` | 资产 `id`、Skill `name`、`visibility` |
| test100 十队：只给 **未出题** 的 L1/Skill 补锁定（批 2）。已锁定 content/`files[]` 禁止改 | `knowledge` 占位；`final5/teams/`；`test100/` |
| 非 test100 队：恰好 1 个已有 Skill 加 `files[]`（path + LICENSE） | 新开 Skill / 改 own 3 配额 |

### 5.2 Memory L1

每条 L1 写成 **一句** 仓库 + L3 + README **都没有** 的锁定。模板（test100）：

- 内部名 vs 对外名（Forest Spirit / Evil Spirits，禁止 flame keeper）。
- 禁止替换现有架构（禁止手雕 Terrain 替换 WorldGenerator+Perlin）。
- 前缀/模块顺序/env 禁令。

反例：复述源码 API、复述 README、把公开 CSS/Spring 教程当 L1（cookies/colorpalette 现网就是这种，必须换掉）。

后两队 L1 不能当本队 Memory CALL 的完整答案 → token 必须本队独有。

### 5.3 Skill 正文

- 步骤是仓库里没有的流程门（谁可以写状态、同帧必须先过哪扇门）。
- `description` 一行，将来进 8 条 listing。Skill CALL 的 Query **必须能对上这句 description**（test100 C010：listing 写 sight tracking，Query 也要问 sight tracking）。
- 不要把锁定 token 写进 description（否则 8 条里直接看见答案）。
- 本队其它 Skill、后两队可搜 Skill，不能完整包含这套步骤。

### 5.4 files[]（每队至少 1 个 Skill）

挂在 **已有 name** 上。SKILL.md **只指路**，答案只在附件。

```json
"files": [
  { "path": "references/<short>.md", "content": "# ...\n<不可猜 token 表>\n" },
  { "path": "LICENSE", "content": "Invented lock for this evaluation scene. MIT-0.\n" }
]
```

- token 必须像 `KindleWisp` / `BZLS#` / `HOLD_FOR_UNITY` / `circa?EXIL`：仓库没有、公开文档没有、邻队 Skill 没有。
- 每条 files Case 只考 **一个** path。
- 禁止把附件答案抄进 Skill `content` 或 Query。
- 邻队不要复用同一附件答案。

test100 队：沿用已有 `files[]`，不要再给第二个 Skill 加附件，除非该队没有任何 files Pair 被 keep 进来（不应发生）。

### 5.5 每队资产出门清单

改完该队 `assets.json` 必须能勾：

- [ ] 每个 **keep Memory CALL 目标** 的 content 含不可猜锁定，且 `rg` 仓库+README 没有这些 token
- [ ] 每个 **keep Skill CALL 目标** 的正文是流程，不是源码复述
- [ ] 恰好 1 个 Skill 有 `files[]`；正文只含 path 指针
- [ ] 未改 id/name/visibility
- [ ] cookies：至少 1 条新 L1 + 1 个带 files 的 Skill（原教程正文作废）
- [ ] colorpalette：至少 1 条新 L1（原 m01–m06 教科书不能当 Memory CALL 目标）

---

## 6. Case 改造规范

### 6.1 窗口（写 Gold 前打开）

`test1k/case-windows.jsonl` 每条 keep 一行，从原 `skill-catalog/case-skill-catalog.jsonl` 按 `case_id` 抽：

- `visibleSkillNames`（8）
- `ownVisible` / `next1Names` / `next2Names`
- Skill 目标：`targetVisible = (target name ∈ 8)`
- `derivedSequence` 只看正端

抽签：`sha256("final5:" + case_id) mod team_catalog_count`。T04 三队全队同一份。  
**不要用 `assets.visibility` 猜链。**

```text
name ∈ 8                     → ["skill_view"]
name ∉ 8，在 own+next2 可搜   → ["skill_search","skill_view_by_id"]
答案在 files[]               → 再加 skill_files_read
Memory                       → ["tdai_memory_search"]
NO_CALL                      → []
```

合法字面量仅：`tdai_memory_search`、`tdai_read_scene`、`skill_view`、`skill_search`、`skill_view_by_id`、`skill_files_read`。

### 6.2 四种 Case 怎么写

**共同：**

- Pair 两端 Query（`messages` **最后一条 user**）**字节相同**，只改 Context（前面的 user）。
- 禁止 Query/Context 出现工具名、资产 id、`tdai_`、`should_call`。
- 正端 Context：只说缺口不在这轮聊天，不贴答案、不贴 README。
- 结构保持 `messages[]`；可以改成 test100 的两段 user（context + query），丢掉无用 assistant 轮。

**Memory 正**  
Query 问 content 里的锁定名/禁令。不要问「仓库结构是什么」。  
Gold：`should_call=true` `tool_family=memory` `expected_sequence=["tdai_memory_search"]` `target_asset_ids=[该 L1]`。

**Memory 负**  
Context = **整句** L1 content。`no_call_basis=pair_context`。

**Skill 正文正**  
Query 问流程、不写步骤；带本仓库专有名词；用语对齐 **该 Skill 新 description**（listing 将显示它）。挡住 8 条里另外 7 个 + next1/next2。  
Gold 按 `targetVisible`。

**Skill 负**  
Context = 目标 Skill **正文**（或 files 那一行）。

**files 正**  
Query 问附件里才有的具体项。Gold 加 `skill_files_read` + `target_resource_paths: ["references/..."]`。

**files 负**  
Context = 附件那一句。

**distractor**  
Query 已写死本地 API/改法；8 条里可有同主题 Skill，但不必调。`no_call_basis=distractor`。对照 **改完后的** 8 条 description。

**natural**  
单文件短改，当前 sha 源码够。`no_call_basis=natural_coding`。

**假 CALL：** 整对改 natural 或从 keep 删除。禁止留 `should_call=true`。

### 6.3 `gold_reason` 必须写清五件事

1. 缺口在哪段资产（content / 正文步骤 / file path）。  
2. 仓库 / README / L3 为何不够。  
3. 另一家族（Memory vs Skill）为何不够。  
4. 8 条其余 + next2 为何不够。  
5. 为何是这一步链（在不在 8 条、要不要 files）。

负端可以短：`Context is the full <asset> content.`

### 6.4 test100 十队：只追加，不重做

已覆盖的 10 个 id：**整行跳过**（assets 锁定、Query、Gold、evidence 都不动）。

其余 keep 行是 **新加的 Case**，不是重跑 test100：

- 目标必须是 **test100 没锁过的** 其它 L1/Skill（先在资产阶段给这些目标补锁定）。
- 禁止第二对 Memory 再考 Forest Spirit / coverage-gap: 等已考 token。
- 不必再造 files 对（每队已有 1 对）。
- 原 Gold 序列若与窗口 `targetVisible` 冲突，以窗口为准（作者写成 search、目标在 8 条 → `skill_view`）。

其余 distractor/natural：按新 8 条与新资产改 Query，避免变成假 CALL 或假 NO_CALL。

### 6.5 evidence.jsonl

每条 keep 一行。`original_prompt` = 该 Case `messages` 最后一条 user（与 Query 字节相同）。  
`source_locator` = `case:<case_id>`。`commit_sha` 可空。`episode_root_id` 用 `pilot_synthetic`。

---

## 7. 字段合同

**cases.jsonl：** `case_id` `team_id` `repo_id` `repo_url` `base_sha` `messages`。

**gold.jsonl CALL：**

```json
{
  "case_id": "...",
  "should_call": true,
  "tool_family": "memory|skill",
  "target_asset_ids": ["<一个 id>"],
  "expected_sequence": ["..."],
  "pair_id": "<同对>",
  "origin": "pilot",
  "gold_reason": "..."
}
```

files 正端另加 `"target_resource_paths": ["references/....md"]`。

**gold.jsonl NO_CALL：** `should_call=false` `tool_family=none` `target_asset_ids=[]` `expected_sequence=[]` `no_call_basis=pair_context|distractor|natural_coding`。Pair 负端必有同一 `pair_id`。

**keep-case-ids.jsonl 角色：**

`memory_pos/neg` `skill_view_pos/neg` `skill_search_pos/neg` `skill_view_files_pos/neg` `skill_search_files_pos/neg` `distractor` `natural`

---

## 8. Catalog / listing

1. 脚手架：从 `final5/skill-catalog/` **按 keep `case_id` 过滤** 拷到 `test1k/skill-catalog/`（id/name/8 条顺序不动）。
2. **39 队资产全部改完之后** 才跑 `sync_listing_from_assets.py`：只改 description，不动 id/name/顺序。
3. 然后做 **Query 对齐扫描**：每条 Skill CALL 的 Query 是否用了 listing 里该目标的 description 用语；未对齐则改 Query（Gold 序列不动）。
4. 禁止中途按单队刷 listing（邻队 description 会来回漂）。并行改资产时，作者用 **本队即将写入的新 description** 写 Query，最后扫描收口。

评测不要用 `final5/skill-catalog/` 旧冻结文案。

---

## 9. 校验（`validate_test1k.py`）

结构（每批跑、全量再跑）：

- keep 条数 = cases = gold = evidence = windows；39 队。
- Pair Query 字节相同；负端 Context 非空。
- `expected_sequence` = keep 计划 = windows `derivedSequence`。
- CALL `target_asset_ids` 存在于该队 assets。
- files 正端：`target_resource_paths` 命中该 Skill `files[].path`。
- 无 `tdai_` / `should_call` 泄漏。
- evidence.original_prompt = Query。
- 每队 ≥1 Memory 对（cookies/colorpalette 洞补后）、≥1 Skill 对、≥1 files 对。
- 无 unpaired CALL。
- 每队 natural ≤ 4。
- Skill `name`/id 相对原 `final5/teams` 未变。

语义抽检（人工/agent，每队至少 1 个 Memory 正 + 1 个 Skill 正）：

- 仓库里搜不到锁定 token。
- 8 条其余 description 答不全。

---

## 10. 批次（必须拆；一次 3 队）

一次改 39 队会爆上下文。**按队原子：该队资产 + 该队全部 keep Case 同一批写完**，不要「先改完全部 assets 再写 1133 条」。

| 批 | 内容 | 出口 |
|---|---|---|
| **0 脚手架** | 建 `test1k/`；脚本筛 keep；拷 39 队并裁行；test100 十队覆盖资产+10 条；写 keep/windows；拷过滤后的 catalog | **已完成** keep=1140 overlay=100 `validate_test1k.py` bad=0。此后不准改 keep 集合 |
| **1 洞** | cookies 资产+2 对；colorpalette 资产+1 Memory 对；顺手改这两队其余 keep | validate 这两队 |
| **2 追加** | 10 队里 **非那 10 个已完成 id** 的 keep：只补未锁目标 + 写新 Case。已完成 10 条禁止动 | 10 队 validate |
| **3–N 其余队** | 每批 3 队：资产 → windows 核对 → 全 keep Query/Gold/evidence | 每批 validate |
| **L listing** | 39 队资产齐后刷 description；Skill Query 对齐扫描 | listing diff 只有 description |
| **V 全量校验** | `validate_test1k.py` + 假 CALL 抽检 | `bad=0` |
| **评测** | campaign 开关、独立 TDAI space、restore 资产 | 不和写数据绑在一起 |

其余 27 队建议顺序（catalog 邻居尽量错开并行冲突；仍按 3 队一批）：

```text
A  DVG-THREAD-04-TEAM-02, DVG-THREAD-04-TEAM-03, T04
B  DVG07_T01_frieghtkb, DVG07_T02_frieghtkb_fork, T01
C  T02, T03, T06
D  T07, T08, T09
E  T10, T11, T12
F  T13, T14, T15
G  dvg01-junior, dvg02-pygpt, dvg03_cpp100days
H  dvg03_cryptoproc, dvg03_cse491, dvg05_goeko_github_io
I  dvg06_mindfulai, dvg06_mspr, t02r17-ipv4
```

批 2 是 **追加**，不是重做 test100。已完成 10 条禁止动。  
`cookies` / `colorpalette` 只在批 1 写，不要在批 I 重写。

**两线程 × 4 并发 × 5 波（批 0 之后）。** 待写约 A 549 / B 491。队不重叠。提示词：`test1k/THREAD-A.md`、`test1k/THREAD-B.md`。

线程 A（20 队）= 洞 2 + test100 追加 10 + 挪来 8 队：

```text
A1  dvg06_cookies, dvg06_colorpalette, DVG-THREAD-04-TEAM-01, T05
A2  DVG-THREAD-04-TEAM-02, dvg06_banzukesurfing, dvg09_judgegpt, dvg03_gmdh
A3  dvg05_pbrudny_jobsforit, dvg03_planpal, dvg10_ultimate_utils, dvg09_playbilling
A4  dvg08_temporalio_temporal, dvg02-pygpt, T15, T14
A5  T03, T11, DVG07_T01_frieghtkb, DVG07_T02_frieghtkb_fork
```

线程 B（19 队）：

```text
B1  DVG-THREAD-04-TEAM-03, T04, T01, T02
B2  T06, T07, T08, T09
B3  T10, T12, T13, dvg01-junior
B4  dvg03_cpp100days, dvg03_cse491, dvg03_cryptoproc, dvg05_goeko_github_io
B5  dvg06_mindfulai, dvg06_mspr, t02r17-ipv4
```

A 里 test100 十队：只追加，`test100-overlay` 禁止动。cookies/colorpalette 走洞规则。A 挪来的 8 队和 B 全部：整队改资产 + 全 keep。

并行时 **只写** `test1k/teams/<Team>/data/{assets,cases,gold,evidence}.json(l)`。  
禁止并行改 `keep-case-ids.jsonl`、`case-windows.jsonl`、`skill-catalog/`。files token 用队名前缀防撞。  
改 Gold 序列（加 files）时先改该队 gold；全路结束后再串行回写 keep/windows 的 `planned_sequence`，再刷 listing。

每队子步骤（agent 提示词按此切）：

```text
1) 读 team.json、assets.json、该队 keep 行、case-windows、原 gold
2) 只改 assets.json
3) 按 keep 角色写 cases/gold/evidence（test100 已覆盖 id 跳过）
4) 跑 validate（可先写单队模式）
```

---

## 11. 评测（数据出门之后）

- `run-final5-native-campaign.ts` 去掉/开关 `records.length===1560 && teams.length===39`。
- `allCaseCount=1140`（以 keep 实数为准），`datasetDigest` 来自 `loadFinal5Dataset(test1k/teams)`。
- workspace manifest 按 keep 的 `case_id`+`base_sha` 过滤；多 SHA 队会有多个 checkout，这是预期。
- restore/import `test1k` 的 Memory + Skill（含 `files[]`）。只改 listing 不导入资产 → view 仍是旧正文。
- 指标分母是 keep 上的 `P`/`N`/`N_pair`/`Q`，不是 1560，也不是「1k」。ECR 与 FCR 分表，禁止加总。

---

## 12. 禁止事项

- 改 `final5/teams/` 或 `test100/`，或改 test1k 里 notes 含 `test100-overlay` 的已完成 Case。
- 新开 `case_id`、改 Skill `name`/资产 id。
- 先写 Query 再补资产。
- 把仓库已有 API/README 标 CALL。
- Query 里写步骤或贴答案。
- 用 `visibility` 猜 `skill_view` vs `skill_search`。
- 给瘦队灌到 12 对；给 cookies 留 0 对 CALL。
- test100 与 test1k 同一 space / 同一 campaign。
- 中途按单队刷 39 队 listing。
- 下载公开 Skill 当 `files[]`（用自造 token）。
- 把本地 `rg`/`Get-Content` 写成 Gold 步骤。

---

## 13. 脚手架脚本合同（批 0 **已完成**）

`test1k/build_scaffold.py`：

1. 读 `final5/teams/*/data/{cases,gold}.jsonl`，按 §2 算 keep 集合。
2. 写 `keep-case-ids.jsonl`（角色先按现网 gold 派生：mem/skill × 是否在 8 条 × 是否计划 files；files 角色在资产批再改 `planned_sequence` 的队，批 0 可先标 `skill_view`/`skill_search`，批内改 Gold 时同步 keep 行的 `planned_sequence`）。
3. 从原 catalog 写 `case-windows.jsonl`。
4. 拷 39 队五文件并裁行；`case_count` 改实际。
5. 覆盖 test100 十队资产 + 已完成 10 条 Case 行（其余 keep 行留着等批 2 追加，批 0 不改它们的 Query）。
6. 过滤 catalog → `test1k/skill-catalog/`。
7. **禁止**在已改资产后重跑（会打回旧稿）。keep 冻死后只允许改 Query/Gold/assets，不准改 keep 集合。

批 0 实数：`teams=39 keep_total=1140 pairs=465 CALL memory=237 skill=228 distractor=103 natural=107 overlay=100`。  
强制加入 9 个 test100 natural/dist + cookies `c002/c004`；丢掉 banzuke 悬空负端 `c006/c008`。  
`python test1k/validate_test1k.py` → `bad=0`。资产改过之后不要重跑 `build_scaffold.py`。

---

## 14. Agent 写作模板（每队）

复制到子 agent。只填该队。

```text
你在写 test1k/<TEAM>/，不要动 final5/teams 或 test100。
设计：formal-dataset/final5/TEST1K-PLAN.md 与 DATASET-REWORK-DESIGN.md。

1. 打开：
   - test1k/teams/<TEAM>/data/assets.json
   - 该队在 keep-case-ids.jsonl / case-windows.jsonl 的行
   - 当前 cases.jsonl gold.jsonl evidence.jsonl
   - 仓库 README（用 repo_url；不要把仓库内容写成 CALL 答案）

2. 先改 assets.json（§5）。token 必须本队独有。
   test100 已锁目标：列出并禁止改 content/files。

3. 再按 keep 每一行写 Case（§6）。
   跳过 notes 含 test100-overlay 的 id。
   Pair Query 字节相同。Gold 序列只看 windows.targetVisible。

4. files 对：Query 问附件 token；body 只指路。

5. gold_reason 写五件事。evidence.original_prompt=Query。

6. 不要改 case_id、name、id、visibility、base_sha。
```

样板（已完成，只读）：`test100/teams/DVG-THREAD-04-TEAM-01/`（C001 Memory，C032 view，C010 files，C003 dist，C006 natural）。
