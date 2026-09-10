<h1 align="center">TencentDB Agent Memory</h1>

<p align="center"><strong>任务一提交 · Proxy 系统提示词注入优化</strong></p>
<p align="center">改造方法 · 数据集 · 实验</p>

<p align="center">
  <a href="docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md">任务报告</a> ·
  <a href="#改造方法">改造方法</a> ·
  <a href="#数据集">数据集</a> ·
  <a href="#实验">实验</a> ·
  <a href="#运行评测">运行评测</a> ·
  <a href="linux-reproduction/linux复现评测流程.md">Linux 复现评测</a>
</p>

---

本提交完成 MemoryProxy 工具说明注入优化。针对 Memory、Skill二类工具，在应调用时发起真实 TDAI HTTP，在上下文充分或普通编码任务中保持不调用，并压缩完整工具说明。工作包括注入改造、test1k 构造，以及 Codex CLI 与 Claude Code CLI 上的 baseline / final 对照实验。

| 优化目标 | Final 的实现方式 | 验证方式 |
| --- | --- | --- |
| **应调会调** | 回答依赖当前上下文中缺失的用户事实、历史约定或团队工作流时，要求先检索对应 Memory 或加载 Skill。L2 索引、摘要和 Skill 名称只用于定位，不能替代所需正文。 | 在应调用样本上检查是否发起绑定到执行器的真实 TDAI HTTP 请求；口头提及工具、本地文件搜索或只生成命令不计为调用。 |
| **不该调则不调** | 将当前对话、L3 和已有工具结果纳入判断；必要事实或操作说明已经充分时停止检索。仅有关键词重合、同主题 Skill 或不依赖团队约定的普通编码任务，不触发工具调用。 | 用同一 Query 构造“缺少正文”和“上下文已给正文”的正负 Pair，并加入同主题干扰与普通编码负例，统计负样本误调用率。 |
| **选对工具并接上参数** | 先按信息缺口选择 Memory、Skill 或 Knowledge，再按工具卡的触发条件、避免条件和相邻工具对照选择具体操作；后续参数从前一步响应中取得，明确 Skill 标识、附件路径和版本的来源。 | 检查首工具选择是否正确，以及实际调用序列是否完成 Gold 要求的工具链；分别报告首工具正确率与完整链成功率。 |
| **缩短说明且保留执行信息** | 合并三个工具家族重复的 HTTP 协议、响应解析和错误规则；工具卡保留用途、端点、参数及结果衔接。根据已启用能力筛选工具，将稳定说明与会话绑定、运行时资产分开组织。 | 从实际发送的首个任务请求中提取注入文本，按统一 tokenizer 比较 baseline 与 final 的工具说明长度；不把整个请求的输入 Token 降幅当作说明压缩率。 |

这些规则通过系统提示词约束 Agent 的决策，不保证每次调用都正确。下方实验报告实际误调用、工具选择和完整链结果，而非仅检查提示词中是否出现对应规则。

## 改造方法

baseline 将「询问历史 / Skill 部分相关」写为强制检索或加载，并在 Memory、Skill、Knowledge 中各自重复 HTTP 协议。final 在注入层完成如下改造：

### 1. 先判断缺什么，再决定是否调用

全局规则统一规定 `must-call`、`no-call` 和 `family-route`。Memory 补用户身份、偏好、历史决策与项目约定；Skill 补明确要求使用或完成任务必需的团队工作流；Knowledge 用于匹配的跨文件结构、关系与设计信息，需要精确的当前代码时仍读取本地源码。

例如，询问某项历史命名约定时，如果当前输入只有记忆索引而没有约定正文，就应检索；如果正文已经出现在当前上下文中，同一问题不应再次检索。Skill 的标题与编码任务主题相近，也不足以成为加载理由。

### 2. 将重复协议收为一份，保留各工具的差异

共享区集中描述 HTTP 调用格式、身份绑定、成功响应、错误处理与停止条件。工具卡说明具体用途、请求方法、端点、参数和结果形状，并通过 `when`、`avoid`、`contrast` 区分容易混淆的操作。这样既减少重复文本，也避免为了压缩而删掉真正执行所需的信息。

响应规则区分“检索为空”和“检索失败”：部分 Memory 搜索结果不能证明不存在记忆，Knowledge 返回 `data.isError=true` 时即使外层 `code=0` 也不能当作成功；文件下载则按原始字节响应处理。

### 3. 从契约生成工具卡，明确多步调用的数据来源

编译器读取运行时工具契约，筛选当前已启用且可见的工具，生成提示词中间表示与工具卡。工具名称、方法和请求字段由契约提供，触发条件及相邻工具区别由决策规则补充。

Skill 附件流程明确为：先查看 Skill，再从该次响应取得 `data.skill_id`、`data.manifest[].path` 和 `data.version`，传给附件读取工具。只有任务需要原始文件字节时才下载，避免凭名称猜测标识、路径或版本。

### 4. 分开组织稳定说明与运行时内容

全局决策、共享协议和工具卡组成静态前缀；会话端点、身份绑定及运行时资产置于动态后缀。稳定规则不再与每次变化的会话内容交错，静态说明与资产文本也能分别计量。该布局不等同于保证供应商缓存命中，实际缓存用量仍以请求证据为准。

生成链为：运行时契约 → 提示词中间表示 → 工具卡 → 统一注入区。

实现位于 `implementations/final`，对照位于 `implementations/baseline`。详见[任务报告的代码优化与方法设计](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#1-代码优化与方法设计)。

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

数据路径：`evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/`。构造说明见[任务报告的数据来源与数据集构造](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#2-数据来源与数据集构造)与[附录 A](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#附录-a-关键代码依据)。

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

信息缺口门控降低误调用，契约化工具卡提高工具选择与完整链成功率，共享协议将工具说明压缩约 29%。完整结果见[任务报告的实验设定与结果](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md#3-实验设定与结果)。

## 提交内容

| 目录 | 内容 |
| --- | --- |
| [implementations/final](implementations/final/) | 最终实现，评测中记为 V4 |
| [implementations/baseline](implementations/baseline/) | 基线实现，结果目录中也记为 server_team |
| [evaluation](evaluation/) | test1k 数据、固定工具契约、运行器、采集与评分 |
| [scripts](scripts/) | 数据准备、资产初始化、单条测试、全量执行及离线验证入口 |
| [Linux 复现评测](linux-reproduction/linux复现评测流程.md) | 250 条 / 全量运行、补跑一次、手动合并计分 |
| [任务报告](docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md) | 改造方法、数据构造、实验结果与指标口径 |

本仓库不包含模型密钥、本机配置、依赖目录和原始运行日志。外部业务源码包 `external-workspaces-ready.zip` 单独交付，下载入口待补充；当前 Git 仓库不含该包。未取得源码包时可阅读报告、检查数据并运行离线验证，真实 Case 执行仍需源码包。

## 运行评测

### Linux 复现评测

导师从 Git 下载后，按 **[Linux 复现评测流程](linux-reproduction/linux复现评测流程.md)** 操作：安装配置 → 正式运行 → 补跑一次 → 重新审计 → 手动合并计分。

支持前 250 条和全量 1,140 条，单选 Claude Code 或 Codex、设置并发。补跑后仍有失败不阻止计分，不可评分的 Case 排除出指标分母，并在报告中保留缺失数量；无需继续补跑至清零。两版本对比使用双方可评分的同 Case 交集。

完成教程中的准备和初始化后，选择对应入口：

```bash
CLIENT=claude-code  # 或 codex
# 前 250 条
bash linux-reproduction/evaluate-250.sh run --client "$CLIENT" --run "linux-250-${CLIENT}-01" --concurrency 5
# 全量 1,140 条
bash linux-reproduction/evaluate-full.sh run --client "$CLIENT" --run "linux-full-${CLIENT}-01" --concurrency 5
```

`claude-code` 可替换为 `codex`。prepare、initialize 和 run 使用相同的 `--run` 名称；省略时使用各入口对应的默认名称。

### Windows 运行

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
