# Case 怎么改（baseline vs final 对照实验）

数据只改：`formal-dataset/final5/teams/<Team>/data/{assets,cases,gold}.jsonl`  
代码对照：`implementations/baseline`（server_team / legacy）vs `implementations/final`（V4 / v4-compact）。  
两边 **同一批 Case、同一 catalog、同一评分**。改 Case 是为了测「该不该调 TDAI」，不是测会不会改 Unity。

---

## 1. 一个 Case 跑起来时模型看见什么

每个 Case 独立工作区（该条 `base_sha`）+ 同一套注入。

**永远看见**

- 用户 `messages`（Context + Query）
- 仓库当前 commit
- Memory：L3 全文、L2 路径/摘要（不必调工具）
- Skill 第一层：**8 个名字+一句 description**（本队 3 + 后队 3 + 再后队 2）
- 后两队其余 Skill 不在这 8 条里，但 **search 能搜到**

**必须调工具才看见**

- L1 原子记忆 / L0 对话原文
- Skill 正文（`skill_view` 或 search 后再 view）

同队不同 Case 的 8 条列表 **可以不同**（`sha256(case_id)` 抽 catalog）。T04 三队例外：全队同一份。  
写 Gold 前先打开 `skill-catalog/case-skill-catalog.jsonl` 里 **这一条 Case** 的 `visibleSkillNames`。

---

## 2. 对照实验在测什么（决定 Case 该长什么样）

| | baseline | final (V4) |
|---|---|---|
| 注入 | 长文：历史/偏好必须先查 Memory；Skill 沾边就 `skill_view` | 短卡 + 路由：Memory=过去事实；Skill=缺的工作流；**当前代码用本地** |
| 容易错 | 仓库已有答案仍去搜 Memory；或列表里外队 Skill 也去 load | 该调时不调；或家族调错 |

因此留下的 Case 要分得清：

1. **该调 Memory**：答案只在 L1，仓库/L3/这 8 个 Skill 摘要都没有。
2. **该调 Skill**：缺的是步骤；目标在不在这 8 条里，决定 `skill_view` 还是 `search→view_by_id`；后两队 Skill 不能当完整答案。
3. **不该调**：Context 已给全 / 仓库能改完 / Query 已写死 API（distractor）。

不要造「打开 README 就能答却标 Memory CALL」——V4 按「本地代码」不去调，ECR 会被打成漏召。

---

## 3. 一条 Case 的改造步骤

### 3.1 先定性，再动字

打开该行 gold + cases + 该 Case 的 catalog 行，判定：

- 仓库 + Query 是否已经够？（够 → NO_CALL `natural_coding`，或丢掉）
- 缺口是 **一句事实** 还是 **一套步骤**？
- 若是 Skill：目标 name 在不在这 8 条？`true`→`["skill_view"]`，`false`→`["skill_search","skill_view_by_id"]`
- 后两队可见/可搜 Skill 会不会也能答完？能 → 改 Query 加本仓库约束，或换目标

### 3.2 改资产（只改 content，尽量不改 id/name）

Memory：写成仓库没有的锁定约定（内部名、禁令、偏好数字）。  
Skill：写成源码里看不出的顺序。不要和 Memory 互抄。

### 3.3 改 Query / Context

形状保持 1～2 条 user：`[Context?] + Query`。禁止出现工具名和资产 id。

**Memory 正端**

- Context：只说「约定不在这轮聊天里」，不要贴仓库摘要。
- Query：问那句锁定事实，并写清不要用对外文档里的叫法（若文档有近似说法）。

**Memory 负端**

- Query **字节与正端完全相同**。
- Context **只粘贴 Memory 那一句**。

**Skill 正端**

- Context：只点现象（「一进触发器就追」），不要列出距离/Raycast 等步骤。
- Query：问谁、按什么顺序做；用本项目模块名，避免外队 Android/JDBC/面试 Skill 能答。

**Skill 负端**

- 同一 Query。
- Context 只贴本队目标 Skill 的步骤。

**distractor**：Query 已写 `Physics.Raycast` / 改拼写等，列表里可以有同主题 Skill，但不必 load。

**natural_coding**：单文件加字段/改注释。少留。

### 3.4 改 Gold

CALL：`should_call=true`，一个 `target_asset_ids`，`expected_sequence` 按 3.1。  
NO_CALL：空目标、空序列，`no_call_basis` 为 `pair_context | distractor | natural_coding`。  
`gold_reason` 写清：缺口、为何仓库不够、为何 Context 不够、为何另一家族不够、为何外队不够、为何是这条链。

---

## 4. 用旧 C001 / C032 说明

**C001 旧 Query**「这个 Unity 项目 premise 和两种 spirit 是谁」  
仓库 `ProjectDocument.md` 已有。两边去扫仓库都合理。  
**改成**：问 pickup **内部锁定名**（Forest Spirit / Evil Spirits），并写明不要用文档对外名。负端 Context 只给这一对名字。

**C032 旧 Query** 已写 distance / view angle / Raycast  
步骤在 Query 里，源码也有注释。且 catalog 里 `unity-enemy-behavior` **已在 8 条中**。  
**改成**：问「谁允许从巡逻切到追击、同一帧必须先成立什么」，不写 Raycast。  
Gold：**`["skill_view"]`**，不是 search。后两队是面试/Android/JDBC，答不了 Unity 状态门。

---

## 5. 建议规模（时间紧）

先筛再改：每队只留 Pair 最多的一个 `base_sha`，约 1000 条。未 keep 的行从本目录 `cases.jsonl`/`gold.jsonl` 删掉即可，不必改字。  
Skill `name` / 资产 id 尽量不动，否则要重算 catalog。

顺序：T04-T01（列表全队相同）→ T05（两份 catalog）→ 其余 keep 队。

---

## 6. 一条 Skill CALL 出门检查

- [ ] 对着 **该 Case** 的 `visibleSkillNames`，不是对着整队 assets
- [ ] 目标在列表 → `skill_view`；不在 → search + view_by_id
- [ ] 其余 7 条 + 后两队可搜 Skill 不能完整答
- [ ] Query 没把步骤写穿
- [ ] 仓库源码没有同一套流程
- [ ] Pair 负端 Query 与正端相同
