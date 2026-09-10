# 快速启动评测

本指南使用最终 test1k 数据集。外部业务源码包单独交付，下载入口待补充；Git 仓库不含该包。拿到源码包前可完成依赖安装、数据准备和离线验证，真实 Case 执行需要解压后的 `workspaces/`。仅做离线检查见 [仓库首页](../README.md#离线验证)。

## 评测运行：test1k

`evaluate-test1k.ps1` 可通过完整路径从其他工作目录调用。它的相对 `-OutputRoot` 和 `-BundleRoot` 参数按仓库根目录解析，不按终端当前目录解析。

新执行 `prepare` 生成的 `evaluation.json` 使用相对于配置文件的路径。整体移动仓库并保持内部目录结构后，这些配置路径会跟随新位置解析；运行入口会重新生成本次源码绑定。旧版本生成的绝对路径配置不自动迁移，可在新位置选择新的 `-OutputRoot` 重新 prepare、initialize。历史执行证据及已经运行的 CLI 工作区可能仍含绝对路径，这项改动不迁移历史结果，也不提供跨位置续跑。

默认运行 39 队、1140 条 Case，两个客户端各运行 baseline 和 V4，共 4560 个执行槽位。每个客户端并发 5，单 Case 超时 8 分钟。全量运行会调用真实模型并产生费用；初始化不调用模型。

使用 Node.js 24.5+、npm、PowerShell 7、Git。Core 使用 pnpm 锁文件，下面通过 npx 调用固定版本。从仓库根目录安装：

```powershell
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
npx --yes pnpm@10.11.0 --dir implementations/final/MemoryCore install --prod --frozen-lockfile --ignore-scripts
npm install -g @openai/codex @anthropic-ai/claude-code
```

生成最终集快照、完整计划、资产导入包和本机配置：

```powershell
./scripts/evaluate-test1k.ps1 -Mode prepare
```

在 `evaluation/.env` 中填写模型地址、模型名称和 API Key；已有配置直接沿用，文件不存在时从 `.env.example` 创建。模板中的地址和身份来自示例环境，不能直接用于新机器；使用自己的模型端点和可用模型。文件被 Git 忽略，已有文件不会覆盖。运行配置为 `runs/test1k/evaluation.json`，Team、Agent 和 Task ID 由初始化自动生成，无须手工填写模板中的身份字段。

初始化独立本地 Core，导入 Memory、Skill 正文与附件并读回验证，再生成真实身份绑定：

```powershell
./scripts/evaluate-test1k.ps1 -Mode initialize
```

初始化完成后 Core 自动关闭；失败时可重试同一个初始化命令。默认 Core 端口为 8427。端口已占用时，用新目录重新准备，例如 `-OutputRoot runs/test1k-new -CorePort 18427`，后续命令使用同一个 `-OutputRoot`。

将另行交付的 `external-workspaces-ready.zip` 解压到仓库根目录，得到 `workspaces/bundle.json` 和 `workspaces/sources/`。

### 先测试一条 Case

完成上面的准备、模型配置和初始化后，选择一个客户端测试。

Claude Code：

```powershell
./scripts/evaluate-test1k.ps1 -Smoke -Client claude-code
```

Codex：

```powershell
./scripts/evaluate-test1k.ps1 -Smoke -Client codex
```

两条命令各自只执行最终集中的 `DVG-T04-T01-C001`，默认使用 V4，结束后自动停止本次服务。每次结果单独落盘，不修改全量计划。可用 `-Variant baseline` 测试基线，或用 `-CaseId <ID>` 更换 Case。单条测试沿用配置中的超时上限，默认 8 分钟。

执行结束会在终端输出 `execution-summary`，列出各客户端、变体的 `completed`、`failed` 及回执路径。Smoke 或显式 `-CaseId` 的单条执行失败时返回非零退出码；全量运行保留已完成结果，有失败时标记 `completed-with-failures`，请结合失败数量和评分覆盖率判断，不以命令退出码代替验收。工具选错、误调用等行为评分失败不等于执行失败。

新配置使用 `/` 保存相对路径，读取时兼容旧相对路径中的 `\`。跨操作系统无法使用原 Windows 绝对路径时会要求重新准备。跨系统应重新安装依赖并 prepare、initialize；不直接复用原系统的数据库、CLI 状态或历史证据。整体移动目录的支持主要针对同一系统保持仓库内部布局的情况。

查看 `runs/test1k/execution/quick-*/<客户端>/V4/execution.json`：`completed=1`、`failed=0` 表示执行完成；同目录的 `execution.json.evidence/` 保存 CLI 日志和 HTTP 采集。这个检查只确认执行及落盘，不代表工具调用或答案评分正确。

### 全量评测

确认单条测试完成后，再启动全量评测：

```powershell
./scripts/evaluate-test1k.ps1 -Mode execute
```

只使用一个客户端或变体：

```powershell
./scripts/evaluate-test1k.ps1 -Mode execute -Client codex -Variant V4
```

仅验证一条最终集 Case 是否能执行并落盘，可增加 `-CaseId DVG-T04-T01-C001`。单条计划单独生成，不修改全量计划。

入口自动绑定外部源码、启动 Core、运行评测，结束或失败后关闭本次启动的服务。可先用 `-Mode check` 检查服务及运行输入。外部源码放在其他位置时添加 `-BundleRoot <目录>`。

执行日志位于 `runs/test1k/setup-logs/`；结果位于 `runs/test1k/execution/quick-*/`，其中 `launch-config.json` 保存实际配置。运行器只保存执行证据和回执，不自动计分。两种变体全部结束后，手动执行 `node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/results.ts score <本次quick目录> <codex或claude-code>` 生成报告。每次 execute 创建新结果目录，不覆盖旧结果，也不续跑上次执行。

当前入口采用 Quick 模式，保留采集和评分，结果标记为 `quick`。它不提供严格源码指纹复现保证。修改数据或资产后应另建运行目录；不要修改已初始化快照。

## 已有环境的手动入口

所有命令从仓库根目录运行。使用当前磁盘上的 baseline/final，无须 Git 提交或另做源码快照。

把 `release/external-workspaces-ready.zip` 解压到主项目根目录，得到 `workspaces/` 后，直接运行下述评测命令即可，无需增加参数。详见 [外部源码资产包](WORKSPACE-BUNDLE.zh-CN.md)。

```powershell
./scripts/run-final5-evaluation.ps1 -Config ./runs/my-run/evaluation.json -Mode execute -Quick -Variant V4 -Client codex
```

只跑 baseline：

```powershell
./scripts/run-final5-evaluation.ps1 -Config ./runs/my-run/evaluation.json -Mode execute -Quick -Variant baseline -Client claude-code
```

`-Variant` 可选 `baseline`、`V4`、`both`，默认 both；`-Client` 可选 `codex`、`claude-code`、`both`，默认 both。不传 `-Quick` 保留原严格流程。快速执行不需要先运行 preview/check。

## 修改配置路径

以已有成功运行的 `evaluation.json` 为基础，路径相对 JSON 所在目录解析；移动配置时推荐改成绝对路径。

| 字段 | 填写内容 |
| --- | --- |
| `baselineRoot` / `v4Root` | 当前仓库 `implementations/baseline` / `implementations/final` |
| `plan` | 对应终端的 `all.plan.json`，或仅含选中 case 的单条计划 |
| `outputRoot` | 本次结果目录；Quick 自动在其下创建唯一的 `quick-...` 子目录并打印实际路径 |
| `teamsRoot` | 与计划对应的数据集 teams，test1k 不能改成原始作者集 |
| `workspaceManifest` | 本机业务代码仓库路径映射 |
| `skillCatalogBindings` | 对应数据集的 `case-skill-catalog.jsonl` |
| `runtimeBindings` | 已有 MemoryCore 的团队、Agent 和 Task 身份映射 |
| `assetRunRoot` / `coreUrl` | 已恢复资产的运行目录和实际 Core 地址 |
| `envFile` / `proxyConfig` | 本机 `evaluation/.env` 和 Proxy 配置模板 |
| `timeoutMs` | `480000`，每 case 8 分钟 |
| `clients.<终端>.concurrency` | `5`；单 case 实际只占一个槽 |
| `clients.<终端>.port` | 未占用的 Proxy 端口 |

重跑清单位置：`runs/final5-test1k-20260909-consolidated/V4/baseline-aligned-retry/<终端>/all.plan.json`。子计划已包含在 all 中，不再重复跑。单 case 计划同时筛选 `selectedCaseIds` 和 `slots`，保留所需变体的槽。

## Quick 的范围

跳过产品源码指纹及运行期间漂移检查、旧计划数据摘要/数量比对、全数据集工作区 Git 预检、资产恢复 verified/摘要比对，以及启动前额外模型探测。运行记录标记 `quick`，不冒充严格复现结果。

仍需真实存在的 Case、仓库、身份、CLI、模型端点和已运行的 MemoryCore。保留端口可用性、服务健康、输入格式、工具调用采集和评分；业务代码仍在独立工作区运行，避免模型改动污染下一条 case。CLI 已使用无审批执行模式。

Quick 每次从头跑到新目录，不和 `-Resume` 合用。输出中的 `launch-config.json` 保存解析后的路径，`experiment.json` 标识快速运行，终端/V4 或终端/server_team 下保留执行回执与证据。
