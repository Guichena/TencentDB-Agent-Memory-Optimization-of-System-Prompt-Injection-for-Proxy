# test1k

正式对照集：**39 队、1,140 条**。

## 状态（已收口）

- keep 已定：全 Pair（跨 SHA）+ best-SHA distractor + 最多 4 条 natural。
- 39 队资产已改（L1 锁定 + Skill 正文 + 每队 1 个 `files[]`）。
- Query/Gold 已按资产重写；CALL 正端已去掉 `not in this chat` / `locked` 等出题人口径。
- `keep-case-ids.jsonl` / `case-windows.jsonl` 已与 Gold 对齐。
- listing description 已从本目录 `teams/*/data/assets.json` 同步。
- `python test1k/validate_test1k.py` → `bad=0`。

## 评测怎么指

```text
FINAL5_TEAMS_ROOT=.../formal-dataset/final5/test1k/teams
FINAL5_SKILL_CATALOG_BINDINGS=.../formal-dataset/final5/test1k/skill-catalog/case-skill-catalog.jsonl
```

restore 必须导入本目录 Memory + Skill（含 `files[]`）。

## 不要做

- 不要重新生成或混入其它版本的数据集。
- 不要改已有 `case_id`。

## 文件

- `keep-case-ids.jsonl` 1140 行
- `case-windows.jsonl` 窗口与派生链
- `teams/<Team>/data/` 五文件
- `skill-catalog/` 8 条 id/name 冻死，description 来自当前 assets
- `merge_keep_from_gold.py` / `sync_listing_from_assets.py` 收口脚本
