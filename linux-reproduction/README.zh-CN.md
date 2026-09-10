# Linux 复现

安全要求：Agent 使用 unrestricted / skip-permissions，HOME 隔离不等于安全沙箱。只在可丢弃 VM 或隔离容器中运行，不挂载 SSH 密钥、云凭据或 Docker socket。

按 [实验步骤](WALKTHROUGH.zh-CN.md) 从拉取仓库运行到查看结果。

- 数据：`first250` 为前 250 条；`full1140` 为全量 1,140 条。
- 客户端：单选 `claude-code` 或 `codex`。
- 并发：`--concurrency 5`，允许 1 到 10。
- 版本：`--variant both` 先跑 baseline，再跑 V4；也可单选。
- 计分：全部运行结束后手动执行 `results.ts score`，运行期间只保存证据和回执。

共用现有 implementations、evaluation 和 workspaces 目录，不复制源码。V4 使用当前 implementations/final，运行前记录源码指纹。

Linux 使用 Bash 入口、bsdtar 解压和 curl 提示；Windows 原脚本保留。尚未进行 Linux 实机模型验证。

沿用 Quick 执行协议，源码指纹是追溯记录，不等于严格 formal 冻结。Ubuntu CI 检查安装、离线测试和本地 Core 初始化，不使用真实模型密钥。
