<h1 align="center">Tool Prompt Benchmark</h1>

<p align="center">
  <a href="../../../../README.md">仓库首页</a> ·
  <a href="../../../README.md">评测工作区</a> ·
  <a href="../../../../scripts/README.md">运行指南</a>
</p>

---

这里是任务一的共用评测实现：用相同的任务输入、资产与 Gold，对比 `server_team` 和 `V4` 的工具调用行为，并保留可复算的原始证据。评测的是提示词的触发与选择能力，不是资产质量或编码答案质量。

## 运行链路

1. **固定输入。** 作者数据、Skill catalog、campaign plan 与 workspace manifest 共同确定本次运行条件。
2. **执行对照。** 双客户端运行器编排 baseline 与 V4，原生 runner 完成输入校验和逐 Case 执行。
3. **采集证据。** 记录输入、模型请求、工具尝试与响应，随后归一化证据并编译 Gold。
4. **配对评分。** 汇总指标、覆盖情况与缺失项，保留可追溯的原始记录。

客户端是 Codex CLI 与 Claude Code，模型分别由环境配置指定。结果按客户端分开，不把不同模型或不同输入的数据合并为同一对照。

<details>
<summary><strong>运行链路对应的源码入口</strong></summary>

| 模块 | 源码入口 |
| --- | --- |
| 双客户端与两阶段编排 | [run-final5-dual.ts](run-final5-dual.ts) · [dual-client-plan.ts](dual-client-plan.ts) |
| 数据加载与单阶段运行 | [final5-formal-datasource.ts](final5-formal-datasource.ts) · [run-final5-native-campaign.ts](run-final5-native-campaign.ts) |
| 工作区与资产身份 | [final5-workspace-manifest.ts](final5-workspace-manifest.ts) · [final5-runtime-bindings.ts](final5-runtime-bindings.ts) |
| HTTP 采集与证据投影 | [final5-http-capture.ts](final5-http-capture.ts) · [final5-evidence.ts](final5-evidence.ts) |
| Gold 与调用链评分 | [final5-gold-compiler.ts](final5-gold-compiler.ts) · [measurement-v2/scorer.ts](measurement-v2/scorer.ts) |
| 收集与指标报告 | [collect-final5-evidence.ts](collect-final5-evidence.ts) · [final5-metrics-report.ts](final5-metrics-report.ts) |
| 资产导入与读回 | [formal-assets/](formal-assets/) |

</details>

## 数据与输入

| 目录 | Team 数 | Case 数 | 用途 |
| --- | ---: | ---: | --- |
| [final5/test1k/](formal-dataset/final5/test1k/README.md) | 39 | 1,140 | 正式对照集 |

运行器检查数据摘要、`allCaseCount`、选中 Case 的唯一性与归属。每个客户端的运行槽位数是所选 Case 数乘以两种变体。

<details>
<summary><strong>每个 Team 的数据文件</strong></summary>

| 文件 | 作用 |
| --- | --- |
| `assets.json` | Memory 与 Skill 资产，包括 Skill 附件 |
| `cases.jsonl` | Query、已有上下文与任务工作区信息 |
| `gold.jsonl` | 是否调用、允许的调用序列与目标约束 |
| `team.json` | Team 元信息 |
| `evidence.jsonl` | 作者侧样本来源记录，不是模型执行轨迹 |

</details>

作者数据、Skill catalog、campaign plan 和 workspace manifest 必须来自同一组 test1k 输入。运行前生成独立输入快照；开始后不根据模型表现修改 Gold 或选择最佳尝试。Linux 正式入口为 [Linux 复现评测流程](../../../../linux-reproduction/linux复现评测流程.md)；Windows / PowerShell 入口为 [evaluate-test1k.ps1](../../../../scripts/evaluate-test1k.ps1)。

## 指标口径

所有主行为指标均基于双方证据完整的配对样本；[评分入口](final5-metrics-report.ts)显式选择 `full-episode`，覆盖整段任务中的工具尝试。

| 字段 | 含义 |
| --- | --- |
| `ECR` | 正例中触发工具调用尝试的比例 |
| `FCR_all` / `FCR_pair` | 全部负例、配对负例中的误调用比例 |
| `TSR_all` / `TSR_cond` | 首次动作选对工具的正例数，分别除以全部正例数、已触发调用的正例数 |
| `Complete` / `Strict` | 完整调用链成功、严格序列匹配 |
| `BSA` / `PairExact` | 正负配对的调用边界切换、配对精确成功 |
| `Overcall` | 正例中的过量调用情况 |

公式实现见 [task1-behavior-report.ts](measurement-v2/task1-behavior-report.ts)，置信区间和按 Team 聚类的配对统计见 [task1-statistics.ts](measurement-v2/task1-statistics.ts)。零分母或缺失观测返回 `null`，不是零分，也不是“没有误调用”。

### Token 计量

[final5-static-input.mjs](../../../../scripts/final5-static-input.mjs)从每个 Case 的首个任务请求中提取工具指令，以 `tiktoken/o200k_base` 对完整文本统一计数：

- `T_static` 包含共享协议、路由、卡片、列表说明和绑定后的地址与请求头，不包含 Skill 条目正文与会话身份块。
- `T_dynamic_listing` 单独计量 Skill 条目文本，不表示所有动态资产的总量。
- `T_prompt` 是 system/developer 文本，不包含原生工具 schema、用户消息或供应商包装。

脚本会检查非注入文本是否保留、两变体的动态列表是否一致；遇到未映射的运行时资产布局会拒绝计数。tokenizer 版本和文本边界写入账本。上述文本长度均不等同于供应商计费输入量。

[final5-provider-usage.ts](final5-provider-usage.ts)另行汇总供应商 usage。主口径只统计配对且行为证据完整样本中的成功任务请求，排除 CLI 标题流量和失败上游请求，失败尝试保留为诊断；不把 CLI 汇总再次叠加到供应商用量上。

### 证据边界

HTTP 采集看不到所有未形成请求的错误 CLI 调用意图，因此仅有 HTTP 证据时不能报告 `PairExact` 完整可用。未纳入 Proxy 采集的外部 Knowledge 请求也需要额外观测。目标身份、完整动态 token 账本和部分诊断指标仍有独立限制，以 `metric-support.json` 和汇总输出的缺失说明为准。

> [!IMPORTANT]
> 源码具备评分能力不等于正式实验已完成。真实结果需要同次运行的 `execution.json`、`attempt-capture.json`、`http-events.jsonl` 与输入摘要支持。

## 本地检查

在仓库根目录安装依赖并运行：

```powershell
npm --prefix evaluation/MemoryProxy ci
python evaluation/MemoryProxy/eval/tool-prompt-bench/formal-dataset/final5/test1k/validate_test1k.py
npm --prefix evaluation/MemoryProxy test -- `
  --config eval/tool-prompt-bench/measurement-v2/vitest.config.ts `
  final5-metrics-report final5-capture-pipeline final5-full-episode
```

这些是数据校验和本地采集、评分测试，不启动真实模型。评测工程默认 `npm test` 运行当前 Final5 回归；产品测试在 baseline/final 工程中执行。`eval:tool-prompt:*` 命令未在当前 `package.json` 中注册。

## 其他文件

[SERVICE-VARIANTS.md](SERVICE-VARIANTS.md)保留服务版本来源记录，[FINAL5-METRICS-PLAN.md](FINAL5-METRICS-PLAN.md)保留指标设计与计划，两者都不是当前运行成功的证明。实际执行以当前运行器、配置、源码指纹和回执为准。

`formal-runtime/`、旧 `formal-*` 启动器和部分 harness 仍服务于旧契约或测试。Final5 使用本页列出的入口，不把历史 V0 至 V3 产物或旧冻结数据当作本次 baseline，也不使用旧启动器代替双客户端运行器。
