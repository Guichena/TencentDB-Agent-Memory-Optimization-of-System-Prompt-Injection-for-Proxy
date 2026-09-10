# Linux 复现

提醒：评测会自动执行代码，请勿在存有敏感数据的环境中运行。

按 [Linux 复现评测流程](linux复现评测流程.md) 从拉取仓库运行到查看结果。

流程：正式运行 → 补跑一次 → 重新 audit → 手动合并计分。剩余失败不阻止计算，报告会列出实际可评分数量。

- 前 250 条入口：[evaluate-250.sh](evaluate-250.sh)。
- 全量 1,140 条入口：[evaluate-full.sh](evaluate-full.sh)。
- 客户端：单选 `claude-code` 或 `codex`。
- 并发：`--concurrency 5`，允许 1 到 10。
- 版本：`--variant both` 先跑 baseline，再跑 V4；也可单选。
- 计分：未补跑时可用 `results.ts score` 计算单轮；补跑后必须重新 audit，再用 `score-audits` 合并，运行期间不自动计分。

共用现有 implementations、evaluation 和 workspaces 目录，不复制源码。V4 使用当前 implementations/final，运行前记录源码指纹。

使用 Bash 入口、bsdtar 解压和 curl 提示。

使用 Quick 协议，源码指纹用于追溯，不提供严格冻结保证。
