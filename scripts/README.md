<h1 align="center">运行指南</h1>

test1k 评测按 [快速启动评测](QUICK-EVALUATION.zh-CN.md) 执行（39 队、1,140 条）。`evaluate-test1k.ps1` 提供 prepare、initialize、check、execute，用于生成配置、导入资产并管理本地 Core。

<p align="center">
  <a href="../README.md">仓库首页</a> ·
  <a href="QUICK-EVALUATION.zh-CN.md">复现指南</a> ·
  <a href="../docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md">技术报告</a> ·
  <a href="../evaluation/MemoryProxy/eval/tool-prompt-bench/README.md">评测说明</a> ·
  <a href="EXPERIMENT-RUNS.md">运行目录与隔离机制</a>
</p>

---

本目录提供 Final5 数据准备、双客户端对照和离线复算入口。面向评审的端到端步骤见 [复现指南](QUICK-EVALUATION.zh-CN.md)。以下命令都从仓库根目录执行；数据准备、服务检查和真实模型运行是不同阶段。

交付范围见 [仓库首页](../README.md#提交内容)。历史运行记录在本地保留，不随 Git 仓库交付；[整理记录](SUBMISSION-INVENTORY.zh-CN.md)保留早期检查过程。

最终数据集以 test1k 为准；离线回归通过不等于真实模型全量评测完成。

离线文件预检不需要 npm 依赖、CLI、密钥或外部工作区，只使用 Node.js 内置模块：

```powershell
node scripts/check-submission.mjs
node scripts/check-submission.mjs --config scripts/final5-evaluation.example.json --runtime
```

默认模式检查提交文件，将尚未整理的运行时文件和仓库外工作区标为 `deferred`；`--runtime` 将这些缺口视为错误并返回非零退出码。路径以配置文件目录解析，检查器不会读取仓库外文件，也不输出凭据。它只检查文件和路径边界，不代替运行器的服务、协议、资产及 Git SHA 预检；`ok: true` 不等于端到端就绪。

<details>
<summary><strong>脚本索引与执行范围</strong></summary>

| 脚本 | 用途 | 是否调用真实服务 |
| --- | --- | --- |
| [evaluate-test1k.ps1](evaluate-test1k.ps1) | test1k：准备完整输入、初始化资产、管理 Core 并启动评测 | initialize 调用本地 Core；execute 调用真实模型 |
| [run-final5-evaluation.ps1](run-final5-evaluation.ps1) | 通过 `preview`、`check`、`execute` 编排两个客户端与两份服务 | 取决于模式 |
| [run-dual-cli-smoke.mjs](run-dual-cli-smoke.mjs) | 检查两个 CLI 与已有 Proxy 的连通性 | 是；不是行为评分 |
| [audit-final5-input.mjs](audit-final5-input.mjs) | 审计已捕获的输入和供应商 usage | 否 |
| [final5-static-input.mjs](final5-static-input.mjs) | 从首个任务请求提取完整工具指令并统一计数 | 否；使用评测工程内安装的 `tiktoken` |
| [summarize-final5-complete.mjs](summarize-final5-complete.mjs) | 汇总完整配对结果，可合并静态输入账本 | 否；要求两侧配对证据完整 |

</details>

## 1. 准备依赖与配置

使用 Node.js 24.x、npm、Git 和 PowerShell 7。test1k 数据校验需要 Python 3；真实模型评测需要安装 Codex CLI、Claude Code，并配置可用的模型端点和 MemoryCore 运行环境。

```powershell
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
```

[配置示例](final5-evaluation.example.json)默认指向 test1k，并选择 4 条 Case 作对照样例。全量 1,140 条请使用 `evaluate-test1k.ps1`。

配置中的相对路径按 **JSON 配置文件所在目录**解析，不按启动命令的工作目录解析。更换配置位置时，需要同时检查 `baselineRoot`、`v4Root`、`envFile`、数据与输出路径。

<details>
<summary><strong>配置字段与环境变量</strong></summary>

| 配置字段 | 含义 |
| --- | --- |
| `baselineRoot` / `v4Root` | 两份服务源码目录，不能指向同一目录 |
| `proxyConfig` / `envFile` | Proxy 的 YAML 配置与本地环境文件 |
| `plan` / `workspaceManifest` | 样本选择、数据摘要和 Git 工作区绑定 |
| `teamsRoot` / `skillCatalogBindings` | 同一数据版本的作者集与 Skill catalog |
| `runtimeBindings` | 经资产导入和校验后获得的 Team、Agent 等真实身份映射 |
| `outputRoot` | 独立运行目录；改变输入或源码后使用新目录 |
| `clients.*.concurrency` | 每个客户端的并发数，允许 1 至 10；test1k 入口默认 5，单条测试实际只占一个槽 |

模型名称从 `envFile` 读取，示例默认指向 `evaluation/.env`。不要在 README、JSON 示例或日志里填写真实凭据。

| 环境变量 | 用途 |
| --- | --- |
| `TDAI_CODEX_MODEL` / `TDAI_CLAUDE_MODEL` | 两个客户端各自使用的具体模型 |
| `TDAI_CODEX_PROVIDER_API_KEY` / `TDAI_CLAUDE_PROVIDER_API_KEY` | 模型供应商凭据 |
| `TDAI_CODEX_UPSTREAM_URL` / `TDAI_CLAUDE_UPSTREAM_URL` | 两个客户端的模型服务地址 |
| `TDAI_CODEX_PROXY_PORT` / `TDAI_CLAUDE_PROXY_PORT` | 不同的本地 Proxy 端口，默认 8096 和 8097；显式 JSON 端口优先 |
| `TDAI_MEMORY_USER_KEY` / `TDAI_SPACE_ID` / `TDAI_TEAM_ID` / `TDAI_AGENT_ID` / `TDAI_TASK_ID` | 常规运行路径所需的 MemoryCore 身份信息 |

字段优先级和本地资产恢复模式见 [dual-client-plan.ts](../evaluation/MemoryProxy/eval/tool-prompt-bench/dual-client-plan.ts) 与 [managed-eval-config.ts](../evaluation/MemoryProxy/eval/tool-prompt-bench/managed-eval-config.ts)。本地恢复模式可从已保存的真实身份记录读取身份，不能用手填 `verified: true` 替代资产校验。

</details>

## 2. 准备 test1k 输入

选择一个尚不存在的运行目录：

```powershell
.\scripts\evaluate-test1k.ps1 -Mode prepare
```

脚本只接受本仓库 `runs/` 下的新目录，不覆盖已有实验输入。默认输出 `runs/test1k/`，内含 campaign、workspaces、evaluation 配置与 test1k 数据快照。

> [!IMPORTANT]
> 准备成功只表示文件已生成，不表示资产已导入，也不会启动模型。

## 3. 检查并运行

全量 test1k 使用刚生成的配置；4 条 Case 样例可改用 `scripts/final5-evaluation.example.json`。

```powershell
.\scripts\evaluate-test1k.ps1 -Mode initialize
.\scripts\evaluate-test1k.ps1 -Mode check
```

| 模式 | 实际行为 | 不代表什么 |
| --- | --- | --- |
| `preview` | 解析配置，读取输入与源码指纹，输出源码契约检查项 | 不启动 Proxy，不验证真实资产或完整工作区就绪状态 |
| `check` | 校验凭据与端口，启动受管 Proxy，检查健康信息并执行工作区和 catalog 预览 | 不执行 Case，也不产生行为得分 |
| `execute` | 运行真实 CLI、保存证据，完成同一客户端的两阶段后收集评分 | 不保证每项指标都有足够证据或全量实验已完成 |

确认输入、资产与服务检查均满足要求后执行。`initialize` 导入资产，`execute` 调用真实模型。

```powershell
.\scripts\evaluate-test1k.ps1 -Mode execute
```

运行器要求所选端口空闲，不会把已有服务默认为 baseline。两个客户端独立运行，每个客户端先完成 `server_team` 再运行 `V4`。每次尝试使用独立 CLI Home 与任务工作区。

`evaluate-test1k.ps1` 每次执行均创建新的 `execution/quick-*` 目录，不支持 `-Resume`。底层 `run-final5-evaluation.ps1` 的非 quick 运行仅在输入、源码和运行器版本一致时才可使用 `-Resume`。输出目录、清理行为和日志安全边界见 [EXPERIMENT-RUNS.md](EXPERIMENT-RUNS.md)。

## 4. 离线复算

下面的命令要求已有完整执行回执和 HTTP 采集文件。把示例运行目录替换为实际目录，输出指向新的派生报告目录。

```powershell
$runRoot = "runs/test1k"
$executionRoot = "$runRoot/execution/quick-<本次运行ID>"
$tsx = "evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs"
$bench = "evaluation/MemoryProxy/eval/tool-prompt-bench"

node $tsx "$bench/collect-final5-evidence.ts" `
  "$runRoot/inputs/test1k/teams" `
  "$executionRoot/codex" codex "$executionRoot/reports-v2/codex"

node $tsx "$bench/collect-final5-evidence.ts" `
  "$runRoot/inputs/test1k/teams" `
  "$executionRoot/claude-code" claude-code "$executionRoot/reports-v2/claude-code"
```

收集器输出 `normalized-evidence.jsonl`、`case-scores.jsonl`、`pair-scores.json`、`comparison.json`、`metric-support.json` 和 `report.md`。历史运行如果缺少 `attempt-capture.json` 或 `http-events.jsonl`，复算不会补出不存在的观测。

<details>
<summary><strong>静态 token 计量与小批次汇总的限制</strong></summary>

静态输入计量由 `node scripts/final5-static-input.mjs <execution-root> <new-ledger-directory>` 完成。默认使用评测工程安装的固定版本 `tiktoken`；历史三参数调用仍兼容，但复现无需外部 tokenizer 目录。

该脚本针对已有首请求采集格式提取指令；遇到未映射的运行时资产布局会拒绝计数，不能把失败结果写成零。`summarize-final5-complete.mjs` 可合并两客户端报告和静态账本，按实际配对 Case 数显示范围；正式指标仍以收集器的 comparison.json 和 metric-support.json 为准。

</details>

## 本地验证

提交用 Final5 链路的统一回归入口（无需真实模型和外部业务仓库）：

```powershell
.\scripts\verify-reproduction.ps1
```

该入口覆盖当前 Final5 的配置读取、Memory 导入、执行辅助逻辑、采集、评分、统计和脚本测试。`measurement-v2` 全目录测试还包含旧 formal-world 链路，依赖本提交缺失的历史 Git 标签 `task1-data-formal-v2.1` 和 `production-source` / `bridge-entry-observer` 源码；原测试仍保留，不宣称它们已通过。提交测试范围明确列在 `evaluation/MemoryProxy/vitest.reproduction.config.ts`。

外部业务源码单独交付为 `release/external-workspaces-ready.zip`。解压到主项目根目录后，评测入口自动使用源码，无需额外参数。使用及打包命令见 [外部源码资产包](WORKSPACE-BUNDLE.zh-CN.md)。

以下脚本测试不使用模型或业务服务：

```powershell
node --test `
  scripts/audit-final5-input.test.mjs `
  scripts/final5-static-input.test.mjs `
  scripts/summarize-final5-complete.test.mjs
```

当前入口以本指南、[快速启动评测](QUICK-EVALUATION.zh-CN.md) 和对应源码为准。
