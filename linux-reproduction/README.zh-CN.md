# Linux 复现

按 [实验步骤](WALKTHROUGH.zh-CN.md) 从拉取仓库运行到查看结果。

- 数据：`first250` 为前 250 条；`full1140` 为全量 1,140 条。
- 客户端：单选 `claude-code` 或 `codex`。
- 并发：`--concurrency 5`，允许 1 到 10。
- 版本：`--variant both` 先跑 baseline，再跑 V4；也可单选。

共用现有 implementations、evaluation 和 workspaces 目录，不复制源码。V4 使用当前 implementations/final，运行前记录源码指纹。

Linux 使用 Bash 入口、bsdtar 解压和 curl 提示；Windows 原脚本保留。尚未进行 Linux 实机模型验证。
