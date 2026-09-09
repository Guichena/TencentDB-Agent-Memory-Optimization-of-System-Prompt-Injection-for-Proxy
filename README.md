<h1 align="center">TencentDB Agent Memory</h1>

<p align="center"><strong>任务一提交 · Proxy 系统提示词注入优化</strong></p>
<p align="center">改造方法 · 数据集 · 实验</p>

<p align="center">
  <a href="docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md">任务报告</a> ·
  <a href="#改造方法">改造方法</a> ·
  <a href="#数据集">数据集</a> ·
  <a href="#实验">实验</a> ·
  <a href="#运行评测">运行评测</a>
</p>

---

本提交完成 MemoryProxy 工具说明注入优化。针对 Memory、Skill二类工具，在应调用时发起真实 TDAI HTTP，在上下文充分或普通编码任务中保持不调用，并压缩完整工具说明。工作包括注入改造、test1k 构造，以及 Codex CLI 与 Claude Code CLI 上的 baseline / final 对照实验。

| 目标 | 实现要点 |
|---|---|
| 应调会调 | 信息缺口仍在时发起真实 TDAI 调用 |
| 不该调则不调 | 上下文已给出、同主题干扰或普通编码时不调用 |
| 选对工具 | 契约化工具卡与多步参数衔接 |
| 说明更短 | 共享协议一份，工具卡仅保留差异 |

## 改造方法

baseline 将「询问历史 / Skill 部分相关」写为强制检索或加载，并在 Memory、Skill、Knowledge 中各自重复 HTTP 协议。final 在注入层完成如下改造：

1. **信息缺口门控。** 仅当持久化资产能够补足当前缺失的必要事实或工作流时调用；关键词重合单独不构成调用条件。
2. **共享协议与工具卡。** 三个工具家族共用同一套调用协议、身份绑定与错误规则；单卡仅保留触发条件、路径、必选参数及相邻工具对照。
3. **契约编译。** 工具说明由运行时契约生成；Skill 标识与附件路径从前序工具响应衔接。
4. **静态前缀与动态后缀。** 决策规则与工具卡置于静态前缀，会话地址与运行时资产置于动态后缀。

生成链为：运行时契约 → 提示词中间表示 → 工具卡 → 统一注入区。

实现位于 `implementations/final`，对照位于 `implementations/baseline`。详见[任务报告第 3 章](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#3-final-实现)。

## 数据集

评测数据为 **test1k**。该集合在 39 个公开仓库语境上按资产先行原则构造，Gold 全部为受控标注，而非原始对话回放。同一最终 Query 仅改变 Context 是否已包含缺口正文，用以分离应调用与不应调用。

| 项目 | 数量 |
| ---: | ---: |
| Team / 仓库 | 39 / 39 |
| Case | 1,140 |
| 应调用 / 不应调用 | 464 / 676 |
| 正负 Pair | 464 |
| 记忆应调用 / 技能应调用 | 241 / 223 |
| 上下文已给 / 干扰 / 普通编码 | 464 / 109 / 103 |

每条 Case 固定展示 8 个 Skill（本队 3、邻队 5），可搜索池为 240 个 Skill。Gold 按该 Case 实际目录书写合法调用链，且不进入模型输入。

数据路径：`evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/`。构造说明见[任务报告第 4.1 节](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#41-test1k)与[附录 A](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#附录-a-数据与来源)。

## 实验

实验在真实 CLI 上执行，baseline 与 final 独立部署。计分仅统计绑定到执行器的 HTTP 请求；Gold 于离线阶段加入。

| 终端 | 模型 |
|---|---|
| Codex CLI | `gpt-5.6-luna` |
| Claude Code CLI | `glm-5.3-flash` |

| 指标 | Codex CLI | Claude Code CLI |
|---|---|---|
| 误调用率 | 90.00% → **31.43%**（−58.57 个百分点） | 64.60% → **16.28%**（−48.32 个百分点） |
| 调用后首工具正确率 | 27.36% → **56.14%**（+28.78 个百分点） | 46.48% → **67.35%**（+20.87 个百分点） |
| 完整链成功率 | 23.42% → **41.33%**（+17.91 个百分点） | 37.33% → **54.72%**（+17.38 个百分点） |
| 工具说明压缩率 | **29.65%** | **29.27%** |
| 有效调用率 | 95.50% → 92.00% | 94.67% → 92.45% |

信息缺口门控降低误调用，契约化工具卡提高工具选择与完整链成功率，共享协议将工具说明压缩约 29%。完整结果见[任务报告第 5 章](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#5-完成效果)。

## 提交内容

| 目录 | 内容 |
| --- | --- |
| [implementations/final](implementations/final/) | 最终实现，评测中记为 V4 |
| [implementations/baseline](implementations/baseline/) | 基线实现，结果目录中也记为 server_team |
| [evaluation](evaluation/) | test1k 数据、固定工具契约、运行器、采集与评分 |
| [scripts](scripts/) | 数据准备、资产初始化、单条测试、全量执行及离线验证入口 |
| [任务报告](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md) | 改造方法、数据构造、实验结果与指标口径 |

本仓库不包含模型密钥、本机配置、依赖目录和原始运行日志。外部业务源码包 `external-workspaces-ready.zip` 单独交付，下载入口待补充；当前 Git 仓库不含该包。未取得源码包时可阅读报告、检查数据并运行离线验证，真实 Case 执行仍需源码包。

## 运行评测

环境要求：Node.js 24.5+、npm、PowerShell 7 和 Git。所有命令从仓库根目录执行。

完整安装、模型配置与资产初始化步骤见 **[快速启动评测](scripts/QUICK-EVALUATION.zh-CN.md)**。顺序为：安装依赖 → `prepare` 生成本机配置 → 填写 `evaluation/.env` → `initialize` 导入资产 → 解压外部源码包 → 执行测试。

完成准备后，任选一个客户端先跑一条 Case：

```powershell
# Claude Code，默认 V4
./scripts/evaluate-test1k.ps1 -Smoke -Client claude-code

# Codex，默认 V4
./scripts/evaluate-test1k.ps1 -Smoke -Client codex
```

两条命令分别执行 `DVG-T04-T01-C001`。结果保存在 `runs/test1k/execution/quick-*/`；回执中的 `completed=1`、`failed=0` 只表示执行完成，工具调用及答案是否正确需查看评分与 HTTP 证据。真实执行需要可用的模型端点和额度。

全量运行两个客户端、两个变体，共 4,560 个执行槽位：

```powershell
./scripts/evaluate-test1k.ps1 -Mode execute
```

默认每个客户端并发 5，单 Case 超时 8 分钟。全量执行会产生模型调用费用。Quick 模式保留采集和评分，每次创建独立结果目录，不续跑上一次执行，也不提供严格源码指纹复现保证。

## 离线验证

文件预检只需 Node.js；回归验证需先安装评测依赖，均不调用真实模型，也不需要外部业务源码包：

```powershell
node scripts/check-submission.mjs
npm --prefix evaluation/MemoryProxy ci
./scripts/verify-reproduction.ps1
npm --prefix evaluation/MemoryProxy run typecheck:contracts
```

文件预检只检查文件及路径边界；契约类型检查仅覆盖固定工具契约。验证范围及历史测试限制见 [运行指南](scripts/README.md#本地验证)。
