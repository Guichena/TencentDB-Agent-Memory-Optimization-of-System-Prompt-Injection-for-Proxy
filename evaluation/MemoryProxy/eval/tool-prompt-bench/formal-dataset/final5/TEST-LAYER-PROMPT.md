# 给其他 AI：建造 `test-layer/`（每队 1 对 L2）

把下面「提示词」整段交给执行模型。不要改 test1k。

---

## 提示词（从这里复制到文末）

你要新建独立目录 `test-layer/`，风格对齐 `test100/`。只补 test1k 几乎没有的 **L2 场景正文**（`tdai_read_scene`）。

- **做：** 每队 1 对 L2 Pair（正 + 负 = 2 条）。39 队合计 **78 条**。
- **不做：** L0、L1、Skill、natural、`tdai_scenario_ls`、L3 CALL。

不要改 `test1k/`、`test100/`、`final5/teams/`。

主集 1140 条已定稿。本集另指 `FINAL5_TEAMS_ROOT`；算分时 `P/N/Q` 按 case_id 并集。L2 资产必须写进 `assets.json`，评测时和 L1 一样 restore 进 memory-bridge，否则 `tdai_read_scene` 是空的。

### 写哪里

```text
formal-dataset/final5/test-layer/
  README.md
  keep-case-ids.jsonl
  case-windows.jsonl
  teams/<Team>/data/{team.json,assets.json,cases.jsonl,gold.jsonl,evidence.jsonl}
  skill-catalog/case-skill-catalog.jsonl
  validate_layer.py
```

根：`D:\projects\TencentDB-Agent-Memory-submission\evaluation\MemoryProxy\eval\tool-prompt-bench\formal-dataset\final5\`  
39 队 = `test1k/teams/` 目录名。

### 脚手架

每队从 `test1k/teams/<Team>/data/` 拷 `team.json`、`assets.json`。`case_count=2`。  
`base_sha` = 该队 test1k cases 里出现最多的 sha。

新 id（禁止撞 1140/100）：

```text
{team}__l2_pos   {team}__l2_neg   pair_id={team}__pair_l2
```

catalog 抽签：

```python
import hashlib
def catalog_index(case_id: str, n: int) -> int:
    return int(hashlib.sha256(f"final5:{case_id}".encode()).hexdigest(), 16) % n
```

从 `test1k/skill-catalog/skill-catalogs.jsonl` 按队取 catalog，按 index 复制 `case-skill-catalog` 行，只改 `caseId`。8 条 **id/name/顺序不准改**。

windows：`targetSkillName=null`，`targetVisible=null`。正端 `derivedSequence=["tdai_read_scene"]`，负端 `[]`。

### 资产（只追加，不改旧 id/name/content/files）

照 `final5/teams/DVG07_T02_frieghtkb_fork` 的 L2：

```json
{
  "id": "<team>__memory__l2_scene",
  "layer": "l2",
  "path": "scenes/<short>.md",
  "summary": "目录级一句，禁止含答案 token",
  "content": "正文才有不可猜 token / 表 / 步骤"
}
```

运行时 **summary 不调工具就能看见**。答案只在 `content`。summary 泄漏 = 假 CALL。  
token 带队名碎片。仓库/README/L1/Skill 都没有这句。

禁止写进 Query：`locked`、`not in this chat`、`this team's X is not`、工具名、`tdai_`。

### Case / Gold

Pair 两端最后一条 user Query **字节相同**。正端 Context 不贴答案；负端 Context = L2 content 要考的那段。`evidence.original_prompt`=Query。

**正端** `{team}__l2_pos`

```json
{
  "should_call": true,
  "tool_family": "memory",
  "target_asset_ids": ["<team>__memory__l2_scene"],
  "expected_sequence": ["tdai_read_scene"],
  "pair_id": "<team>__pair_l2",
  "origin": "pilot",
  "gold_reason": "缺口在 L2 content 哪句；summary/仓库/L1/Skill 为何不够；为何是 tdai_read_scene 不是 tdai_memory_search"
}
```

Query=同事派活；仓库有一个会做错的现成答法；完整答案只在 L2 **content**（不是 summary）。  
样板：`final5/teams/DVG07_T02_frieghtkb_fork/data/gold.jsonl` 的 `k01_call`。

**负端** `{team}__l2_neg`：`should_call=false` `tool_family=none` `expected_sequence=[]` `no_call_basis=pair_context`。

### 校验 `validate_layer.py`

- 39×2=78；keep=cases=gold=evidence=windows  
- Pair Query 相同  
- 正端 `["tdai_read_scene"]`，target `layer==l2`  
- receipt 里的 secret token 不得出现在 summary 或 Query  
- 无 `tdai_` / `should_call` / `not in this chat` / `\blocked\b`（lockfile 除外）  
- 未改从 test1k 拷来的 Skill name/id  

### 并发

4 队一批。每队原子：追加 1 条 L2 + 写 2 条 Case。最后 validate。  
不要跑 `test1k/build_scaffold.py`。

### 评测怎么并上（只准备数据）

```text
FINAL5_TEAMS_ROOT=.../test1k/teams
FINAL5_TEAMS_ROOT=.../test-layer/teams
```

算分：`P = P_1k ∪ P_layer`。layer 的 CALL 全是 `tdai_read_scene`，可单独一列。restore 必须带上新 L2。

### 出门

README：78 条、每队 1 L2 Pair。  
每队 receipt：`l2_id, path, secret_tokens, base_sha`。
