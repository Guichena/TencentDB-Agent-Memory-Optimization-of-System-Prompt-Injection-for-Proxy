<h1 align="center">评测工作区</h1>

<p align="center">
  <a href="../README.md">仓库首页</a> ·
  <a href="../docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md">任务报告</a> ·
  <a href="MemoryProxy/eval/tool-prompt-bench/README.md">评测说明</a> ·
  <a href="../scripts/README.md">运行指南</a>
</p>

---

本目录为 `server_team` 与 `V4` 提供共用的评测环境。两份待测服务分别位于 `implementations/baseline/` 和 `implementations/final/`；这里的 MemoryProxy 工程承载运行器、采集器、评分器及其依赖，不是第三个对照变体。

## 从哪里开始

| 需要了解的内容 | 入口 |
| --- | --- |
| 任务一提交报告 | [任务报告](../docs/task1-report/TASK1-FINAL-REPORT.zh-CN.md) |
| 数据集、评分口径、检查命令 | [Tool Prompt Benchmark](MemoryProxy/eval/tool-prompt-bench/README.md) |
| 准备 test1k、配置客户端、运行单条或全量对照 | [快速启动评测](../scripts/QUICK-EVALUATION.zh-CN.md) |
| 双客户端编排 | [run-final5-dual.ts](MemoryProxy/eval/tool-prompt-bench/run-final5-dual.ts) |
| 原始证据收集与离线复算 | [collect-final5-evidence.ts](MemoryProxy/eval/tool-prompt-bench/collect-final5-evidence.ts) |
| 完整调用链评分 | [measurement-v2/scorer.ts](MemoryProxy/eval/tool-prompt-bench/measurement-v2/scorer.ts) |
| Proxy 产品本身 | [final 快照中的中文说明](../implementations/final/MemoryProxy/README_CN.md) |

## 安装与测试

在仓库根目录执行：

```powershell
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
./scripts/verify-reproduction.ps1
npm --prefix evaluation/MemoryProxy run typecheck:contracts
```

> [!NOTE]
> `npm --prefix evaluation/MemoryProxy test` 默认运行当前 Final5 评测回归。产品测试在 baseline/final 内执行；Gold 和评分读取 [固定契约](MemoryProxy/contracts/README.md)。`typecheck:contracts` 只检查契约类型，不代表全工程类型检查通过。旧说明中的 `eval:tool-prompt:*` 不是当前可用的 npm scripts。

模型、服务地址和凭据由本地 `evaluation/.env` 提供，配置字段见[脚本指南](../scripts/README.md)。不要提交这个文件，也不要把生成的运行目录当作作者数据修改。
