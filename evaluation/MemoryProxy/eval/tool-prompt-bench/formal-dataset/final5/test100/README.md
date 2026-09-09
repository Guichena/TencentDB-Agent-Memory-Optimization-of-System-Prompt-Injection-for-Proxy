# test100

第一批对照集，共 10 队、100 条 Case，其中 40 条 CALL、60 条 NO_CALL。与 `final5/teams/` 的原始 39 队、1,560 条数据相互独立。

[评测说明](../../../README.md) · [脚本指南](../../../../../../../scripts/README.md) · [扩展集 test1k](../test1k/README.md)

## 状态

- 10 队已按规则重做：先定资产（含不可猜的 `files[]` 锁定），再反推 Query/Context/Gold，缺口只在 TDAI。
- 结构校验：`python test100/validate_test100.py`（Pair Query、Gold 序列、10 对 files、9 对 search）。
- 本目录是作者数据，不是执行结果；是否完成评测以具体运行的回执为准。
- 使用本集时，作者数据和 catalog 都指向本目录；准备后由 runner 读取本次运行的输入快照，不使用 `final5/teams/`。
- 8 条 listing 用 `test100/skill-catalog/`（description 从当前 `assets.json` 同步），不要用 `final5/skill-catalog/` 旧冻结文案。
- 再生 listing：`python test100/sync_listing_from_assets.py`

## 10 槽模板（每队）

2 Memory pair + 1 in8 Skill pair（view 或 view+files）+ 1 不在 8 条 Skill pair（search 或 search+files）+ 1 distractor + 1 natural。

T04 三个 own Skill 全在 8 条里，没有 search；files 占用 C010/C011。

为塞进 10 槽，相对 `TEST100-PLAN.md` 原文做了这些取舍（资产仍保留，只是不出题）：

| 队 | 取舍 |
|---|---|
| banzuke | files 挂 `localstorage-debug`（c027 in8）；不出 `initialize-lifecycle` |
| ultimate_utils | files 挂 `wandb-sweep-workflow`；search 把 s05 **改靶** 到 `vectoring-research-planning`；不出 s01 hf-training-setup |
| gmdh | files 挂 `dh-data-cleaning`；不出 biographical-data-schema |
| planpal | search 把 s02 **改靶** 到 `nextjs-api-setup`（cat02 不在 8 条） |
| judgegpt | s01 **改靶** 到 `add-api-key-input` 做 view+files；s03 同技能 search |
| jobsforit | files 挂 `component-refactor`，不挂 markdown-doc |
| playbilling | m01 **改靶** `mem_security_practice`；files 挂 add-acknowledgement 的 search 链 |

## 文件

- `keep-case-ids.jsonl` 100 行：角色、计划靶、计划序列、附件 path、改靶说明
- `case-windows.jsonl` 100 行：该 case_id 的 catalog、8 名、next1/next2、`targetVisible`、`derivedSequence`
- `teams/<Team>/data/` 五文件；cases/gold/evidence 已裁成 10 行；`team.json.case_count=10`

`build_scaffold.py` 是初始构建脚本，会重写生成内容，不是日常校验入口。已有作者改写应保留；日常检查使用 `validate_test100.py`，仅同步列表描述时使用 `sync_listing_from_assets.py`。

## 导入 / 评测怎么指过来

从仓库根目录准备本集：

```powershell
.\scripts\prepare-final5-test100.ps1 -OutputRoot .\runs\final5-test100-new
```

脚本会同步描述、校验数据，并将作者数据和 catalog 复制到本次运行的 `inputs/test100/`，同时生成 plan、workspace manifest、配置与资产包。它不会导入资产或调用模型。运行配置使用生成的 `inputs/evaluation.json`，详细阶段见[脚本指南](../../../../../../../scripts/README.md)。

以下是 runner 的输入约定；手工配置时也必须同时满足：

1. **作者数据**  
   `FINAL5_TEAMS_ROOT` = `.../final5/test100/teams`  
   `loadFinal5Dataset` 会读每队 `cases.jsonl` + `gold.jsonl` + `evidence.jsonl` + `assets.json`。

2. **8 条 listing**  
   `FINAL5_SKILL_CATALOG_BINDINGS` = `.../final5/test100/skill-catalog/case-skill-catalog.jsonl`  
   不要用 `final5/skill-catalog/`（旧 description）。改过 `assets.json` description 后先跑 `python test100/sync_listing_from_assets.py`。

3. **campaign 清单**  
   新建 plan：`selectedCaseIds` = `keep-case-ids.jsonl` 的 100 个 id，`allCaseCount=100`，`datasetDigest` = 对 `test100/teams` 跑 `loadFinal5Dataset` 得到的 `sourceDigest`。  
   `FINAL5_PLAN` 指这份 json。workspace-resolution 可沿用现有 manifest（case_id / `base_sha` 没变），按 100 个 id 过滤即可。

4. **TDAI 运行时资产**  
   用 `formal-assets/` 的恢复适配器导入 Memory、Skill 正文与 `files[]`，完成读回和可见性校验，再绑定真实运行时 ID。`memory-bridge` 与 `skill-bridge` 是模型调用入口，不是数据集导入 API。只改 listing 不导入资产，不能保证模型读到对应正文与附件。

5. **运行时校验**  
   `run-final5-native-campaign.ts` 已按数据摘要、`allCaseCount` 和 Case ID 校验，不再固定要求 39 队、1,560 条。test100 真实执行还要求 `FINAL5_RUNTIME_BINDINGS`，其内容必须来自实际资产恢复与校验，不能把所有 Team 映射到同一环境身份。

环境变量汇总：

```text
FINAL5_TEAMS_ROOT=.../formal-dataset/final5/test100/teams
FINAL5_SKILL_CATALOG_BINDINGS=.../formal-dataset/final5/test100/skill-catalog/case-skill-catalog.jsonl
FINAL5_PLAN=.../formal-dataset/final5/test100/manifests/<your-plan>.json
FINAL5_RUNTIME_BINDINGS=.../<verified-runtime-bindings>.json
```

不要修改原始作者集。原生 runner 的 `FINAL5_PREVIEW=1` 可检查工作区与 catalog；双客户端包装脚本的 `-Mode preview` 只展示配置和源码检查项，两者不是同一检查。执行前还需确认资产、身份与服务就绪，再依次运行 `server_team` 和 `V4`。
