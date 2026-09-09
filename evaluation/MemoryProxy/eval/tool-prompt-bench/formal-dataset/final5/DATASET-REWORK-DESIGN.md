# final5 数据集改造设计

日期：2026-09-08。对照仓：`D:\projects\TencentDB-Agent-Memory-submission`。  
只改本目录 `teams/<Team>/data/`。不改 `implementations/baseline`、`implementations/final`。改完前不算冻结快照。

---

## 1. 实验约束

| | baseline | final |
|---|---|---|
| 路径 | `implementations/baseline` | `implementations/final` |
| variant | `server_team` | `V4` |
| 注入 | `legacy`：历史/偏好必须先查 Memory；Skill 沾边就 view | `v4-compact`：Memory=过去事实；Skill=缺的工作流；**当前代码用本地** |

两边共用：作者数据、`skill-catalog/`、评分、清单。假 CALL（仓库已有答案）会让 final 按「本地代码」不调工具，ECR 吃亏。改造必须让缺口只在 TDAI 资产里。

评分只认 executor-bound TDAI（curl memory-bridge / skill-bridge）。本地 `rg`/`Get-Content` 不算 Gold 步骤。

---

## 2. 一条 Case 运行时模型看见什么

独立工作区 = 该条 `base_sha`。新 session。

### 2.1 不调工具就能看见

| 来源 | 内容 |
|---|---|
| Query/Context | `cases.jsonl` 的 `messages` |
| 仓库 | 该 commit 源码/文档 |
| **L3** | **全文**（人设）。够用则不应再搜 Memory |
| **L2** | 仅 **path + summary**，无正文 |
| **Skill 第一层** | **恰好 8 个** `name: description`（own 3 + next1 3 + next2 2） |

### 2.2 必须调工具

| 资产 | 工具 | 步数 |
|---|---|---|
| L1 事实/偏好/规则 | `tdai_memory_search` | 1 |
| L0 某次原话 | `tdai_conversation_search`（必要时再 `conversation_query`） | 1–2 |
| L2 正文 | `tdai_read_scene`（path 已在索引里）；索引不够才先 `tdai_scenario_ls` | 1（现网 3 条）；2 很少用 |
| Skill 正文 | 见 2.3 | 1 或 2 |
| Skill 附件 | `skill_files_read`（先 view 拿 path） | +1 |

后两队 **全部** Memory/Skill 在窗口里：L1 可被 search 打到；Skill 不在 8 条里的仍可 `skill_search`。

### 2.3 Skill 一步还是两步（必须查该 Case 的 catalog）

文件：`skill-catalog/case-skill-catalog.jsonl`。

- 同队可有多份 8 条列表；Case 用 `sha256(seed:case_id) mod 份数` 抽一份。仅 T04 三队全队同一份。
- **不要用 `assets.visibility` 猜链。** C032 作者写 search，派生 Gold 因目标在 8 条里改成 `skill_view`。

```text
目标 name ∈ 该 Case visibleSkillNames
    → ["skill_view"]
    → 若答案在 files[] → ["skill_view","skill_files_read"]

目标 name ∉ 8 条，但在 own+next2 可搜池
    → ["skill_search","skill_view_by_id"]
    → 若答案在 files[] → ["skill_search","skill_view_by_id","skill_files_read"]
```

`files_read` 必须带 `target_resource_paths: ["<一个 path>"]`。编译器把 `skill_id` 绑到上一步响应。

当前 1560 条：`files[]` 全空，**0 条 files_read**。附件必须在 **造 Case 之前** 写进 Skill（第 4 节），不能事后补。

---

## 3. 四种 Case（只保留这些）

| 类 | 何时 | Gold |
|---|---|---|
| Memory Pair 正 | 缺口只在本队 L1；仓库/L3/L2 summary/8 个 Skill 摘要都没有 | `tdai_memory_search` |
| Memory Pair 负 | 同一 Query，Context 已贴那句 L1 | `pair_context`，不调 |
| Skill Pair 正 | 缺口只在本队 Skill 正文或附件；外队干扰答不全 | 按 2.3 |
| Skill Pair 负 | 同一 Query，Context 已贴步骤或附件那句 | `pair_context` |
| distractor | Query 已写死 API/本地改法；列表可有同主题外队 Skill | `distractor` |
| natural_coding | 当前文件就能改完 | `natural_coding`；少留 |

禁止 Query/Context 出现工具名、资产 id、`tdai_`、`should_call`。Pair 两端 Query **字节相同**，只改 Context。

---

## 4. 顺序：先资产（含网上 Skill/附件），再按资产造 Case

**禁止先写 Query 再找资产凑。** Memory 和 Skill 一样：先定稿资产，再从资产反推 Context / Query / Gold。

```text
筛 keep 队/SHA
    → 定本队 Memory + Skill 资产（改正文、加网上领域 Skill 的 files[]）
    → 用新资产看窗口：8 条列表 + 后两队可搜池（name 尽量不变则沿用现 catalog）
    → 每个目标资产构造 Pair：正端藏缺口、负端 Context 贴缺口
    → 按该 Case 的 catalog 写 Gold 链
```

### 4.1 先改 `assets.json`

对每个准备出题的目标：

1. Memory：先写死 L1 `content`（锁定名/禁令/偏好）。仓库和 L3 都没有这句话。后两队 L1 也不能当完整答案。不要复述源码。
2. Skill 正文：先写死步骤（或附件）。仓库没有。**不要**预谋把同一段再写进 Query。
3. **files_read 用的附件现在就加**：公开领域 Skill（`references/` + LICENSE）。SKILL.md 只指路，答案只在附件。优先挂在 **已有 name** 上，避免打乱 own 3 配额。每 keep 队至少 1 个带 `files[]` 的 Skill，好造两/三步题。
4. 后两队同类 Skill 不要放同一附件答案。
5. 尽量不改 Skill `name` / 资产 id / visibility。

没有定稿资产，不准写 Case。

### 4.2 再按「这条资产 + 这个窗口」造 Case

Memory、Skill（含附件）都按「一个目标资产 → 一对 Case」来造：

1. 打开该 Case 将落入的 catalog（8 名、next1/next2）。新 Case id 会改变 `sha256(case_id)` 抽中的 catalog——**尽量复用旧 case_id**，否则要重算窗口。
2. 从 **已定稿资产** 抽出唯一缺口句：Memory 用那条 `content`；Skill 用正文里仓库没有的步骤，或 `files[]` 里一行。
3. 正端 Query 只指向这个缺口，不把答案写出来。
   - Memory：L3、本队其他 L1、后两队 L1 都不能完整答。
   - Skill：该 Case 8 条里另外 7 个、后两队可搜 Skill 都不能完整答（加本仓库约束）。
4. 负端 Query 与正端相同；Context = 缺口句（Memory content / Skill 步骤 / 附件那行）。
5. Gold：`target_asset_ids` = 该资产。Memory 一般为 `["tdai_memory_search"]`。Skill 按 2.3（在不在 8 条、有没有 files）。
6. `gold_reason`：缺口来自哪段资产、仓库/L3 为何不够、另一家族为何不够、外队为何不够、为何是这一步链。

distractor / natural 对照 **已经存在的** Memory 和 8 条 Skill：同主题但不必要才标 distractor。

---

## 5. Query / Context 写法（由资产反推）

**Memory 正**（从已定稿的那条 L1 `content` 出题）  
Context：只说这条约定不在这轮聊天。不要贴 README、不要贴 content。  
Query：问 content 里那句锁定名/禁令/偏好；若文档有对外叫法，写明不要用对外名。

**Memory 负**  
Context：**只贴那条 L1 content**。Query 与正端相同。

**Skill 正**（从已定稿 Skill 正文或 `files[]` 出题）  
Context：只点现象。不要列出正文/附件里的步骤。  
Query：问那套缺口流程；带本项目名词，挡住该 Case 8 条里另外 7 个和外队可搜 Skill。

**Skill 负**  
Context：只贴本队目标正文（或附件里要考的那句）。Query 相同。

**files_read 正**  
SKILL.md 只写「详见 `references/xxx.md`」，**答案不在正文**。  
Query 问附件里才有的具体项（某注解、某表、某条命令）。  
Gold 加 `skill_files_read` + `target_resource_paths`。

**files_read 负**  
Context 直接给出附件里那一句，模型不必 read。

**反例**  
- 「这个仓库 premise 是什么」→ 文档有。  
- 「用 distance、FOV、Raycast 接线」→ 步骤在 Query 里。  
- 目标已在 8 条却写 `skill_search`。

---

## 6. 网上领域 Skill 长什么样（属于 4.1，不是收尾）

现状无附件。细评测 = 先把附件写进资产，再出 files_read Pair。

```json
"files": [{ "path": "references/checklist.md", "content": "..." }]
```

- 自造不可猜 token + LICENSE（MIT-0）；不下载公开 Skill。改编说明可写进 evidence。
- 每 Case 只考一个 path。
- listed 目标 → `skill_view` + `skill_files_read`；可搜目标 → 三步。
- 每 keep 队：正文-only Pair 和 files_read Pair 都要有（若该队有带附件的 Skill）。

---

## 7. 筛选 keep（在改资产之前定队/SHA，在造 Case 时只动 keep 行）

当前 39 队 × 40 = 1560。1k 目标见 `TEST1K-PLAN.md`：**全成对 Pair（跨 SHA）+ best-SHA distractor + 最多 4 条 natural ≈ 1133**，写入 `test1k/`。  
Pair 两端必须同一 `base_sha`。unpaired CALL 丢掉。不在原 `teams/` 删行。Skill name / 资产 id 不动则 8 条 id/name 可沿用。

产出：

```text
final5/test1k/keep-case-ids.jsonl
final5/test1k/case-windows.jsonl
  case_id, catalogId, visibleSkillNames, next1/next2 names,
  targetVisible, derivedSequence
```

没有 `case-windows.jsonl` 不准写 Skill Gold（要知道在不在 8 条里）。Memory Gold 同样必须能指回已定稿的那条 L1，并排除 L3/后两队 L1。

---

## 8. 字段（作者 gold.jsonl）

CALL：`should_call=true`，`tool_family=memory|skill`，一个 target，完整 `expected_sequence`，有负端则 `pair_id`。  
NO_CALL：`tool_family=none`，空 target/序列，`no_call_basis`，pair 负端必有 `pair_id`。

合法序列：`[tdai_memory_search]`、`[tdai_read_scene]`、`[skill_view]`、`[skill_search, skill_view_by_id]`、`[skill_view, skill_files_read]`、`[skill_search, skill_view_by_id, skill_files_read]`、`[]`。

---

## 9. 执行顺序

1. 按 `TEST1K-PLAN.md` 筛 keep 写入 `test1k/`（未 keep 的 Case 不拷，不改原 1560）
2. **定资产**：改 Memory/Skill 正文；每队 1 个已有 Skill 加自造 `files[]`（test100 十队拷已改资产）
3. 生成/核对 `test1k/case-windows.jsonl`
4. **按资产造** Query/Context/Gold（样板：`test100/teams/DVG-THREAD-04-TEAM-01/`）
5. 39 队资产齐后刷 listing description；校验 Pair Query、序列↔窗口、每队 files 对
6. 更新 campaign 指向 `test1k/`

出门：每条 CALL 的缺口能指回 **已定稿** 的一条 Memory `content`、一段 Skill 正文、或一个 `files[]` path。不是先写 Query 再贴资产。
