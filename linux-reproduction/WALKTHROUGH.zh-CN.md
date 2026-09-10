# Linux 实验步骤

环境：Ubuntu、普通用户、Node.js 24.5+（24.x）。复用现有源码，以下命令在同一个终端按顺序执行。

Agent 会绕过权限审批。请使用可丢弃 VM 或隔离容器，不挂 SSH/云凭据和 Docker socket；单独 HOME 不是操作系统沙箱。

## 1. 拉取仓库、安装依赖

```bash
sudo apt-get update
sudo apt-get install -y git curl python3 build-essential libarchive-tools golang-go
git clone https://github.com/Guichena/TencentDB-Agent-Memory-Optimization-of-System-Prompt-Injection-for-Proxy.git memoryproxy-eval
cd memoryproxy-eval
node --version  # 需提前安装 Node.js 24.5+，不要使用 sudo npm

CLIENT=claude-code   # 或 codex
DATASET=first250     # 或 full1140，全量 1,140 条
RUN="linux-${DATASET}-${CLIENT}-01"
bash linux-reproduction/setup.sh "$CLIENT"
```

克隆版本需包含 linux-reproduction 目录。使用专用测试机器，不挂载私人凭据。

## 2. 填写模型配置

编辑 `evaluation/.env`，填写所选客户端的 URL、API Key 和模型名。另一客户端的模型名保留非空，Key 不必填。

```bash
vi evaluation/.env
export NO_PROXY=127.0.0.1,localhost
export no_proxy="$NO_PROXY"
```

不要上传 .env。需要出站代理时另外设置 HTTP_PROXY、HTTPS_PROXY。

## 3. 准备业务源码

已有完整 workspaces 目录就直接复用；没有则按固定提交下载：

```bash
node linux-reproduction/fetch-workspaces.mjs "$DATASET"
```

若公开仓库不可访问，使用原有业务源码包，不要换成最新分支。预热 Go，避免项目启动时卡在下载：

```bash
GOTOOLCHAIN=go1.26.0 go version
GOTOOLCHAIN=go1.26.1 go version
```

## 4. 初始化并试跑一条

```bash
bash linux-reproduction/run.sh prepare --dataset "$DATASET" --client "$CLIENT" --run "$RUN"
bash linux-reproduction/run.sh initialize --dataset "$DATASET" --client "$CLIENT" --run "$RUN"
bash linux-reproduction/run.sh run --dataset "$DATASET" --client "$CLIENT" --run "$RUN" --variant both --case DVG-T04-T01-C001 --concurrency 1
```

确认 baseline 和 V4 都是 `completed=1、failed=0` 再继续。失败日志在 `runs/$RUN/setup-logs/` 和执行目录中。

## 5. 正式运行

```bash
bash linux-reproduction/run.sh run --dataset "$DATASET" --client "$CLIENT" --run "$RUN" --variant both --concurrency 5
```

先跑 baseline，再跑 V4，每阶段 5 并发，单条超时 8 分钟。建议在 tmux 中执行，避免 SSH 断开；运行期间不要改源码或配置。

## 6. 查看结果

将下面路径替换为控制台打印的正式运行目录：

```bash
QUICK="runs/$RUN/execution/quick-实际UUID"
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/results.ts status "$QUICK" "$CLIENT"
```

全部运行结束后，手动计分：

```bash
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/results.ts score "$QUICK" "$CLIENT"
```

命令会打印报告目录。打开其中的 report.md 查看指标，comparison.json 查看覆盖数，case-scores.jsonl 查看逐条得分。运行期间不自动计分。

只运行了一个版本时，在计分命令末尾加 `--variant baseline` 或 `--variant V4`，生成该版本报告，不生成两版本差值。

启动受残留锁阻挡时，先运行 `bash linux-reproduction/run.sh doctor`。检查指定执行目录可追加 `runs/.../quick-UUID`；确认后加 `--clear-stale`，只清除同机已重启或整个进程组已结束的锁。旧格式锁、仍有子进程、端口占用或状态不明时拒绝清理。

## 注意

- 每次运行生成新目录，不自动续跑；试跑与正式结果分开保存。
- 正常完成且证据完整的记录，以及持续活动满 8 分钟、证据足够的超时记录，按实际工具行为计分。低分不重跑。
- 临近超时固定为最后真实活动距结束不超过 180 秒；HTTP 200、心跳和重连不算。旧日志用文件时间时会标注，迁移日志需保留时间戳。
- 超时证据不足标为 `unscorable_timeout`。缺文件/损坏等采集故障进入补跑；仅有未闭合请求、无法确认缺失原因的先列入人工复核，不猜分也不自动重跑。
- 换客户端或数据集时换一个 RUN，重新初始化；源码无需复制。
- Linux 离线检查已通过，实机模型试跑尚未验证。
- 仍使用 Quick 协议，不能称为严格 formal 复现。CI 不包含真实上游调用；公开源码包发布和真实 Linux 模型试跑需另行完成。

## 扫描、补跑、合并

全部停止后，扫描同一 RUN 内各轮记录，生成补跑清单：

```bash
bash linux-reproduction/run.sh audit "$RUN" "$CLIENT" baseline
```

把输出的 audit 路径填入下面命令，只补跑清单中的 Case：

```bash
bash linux-reproduction/run.sh retry --dataset "$DATASET" --client "$CLIENT" --run "$RUN" --retry-plan "runs/实际路径/retry.json" --concurrency 5
```

补跑后重新 audit，旧清单不可重复使用。V4 同理，把 audit 最后的 baseline 改为 V4。`needsReview` 不为零时先核查日志。

拿到两边最新 audit 路径后，手动合并计分：

```bash
bash linux-reproduction/run.sh score-audits "baseline的retry.json路径" "V4的retry.json路径"
```

同一 Case 选择最早可评分 attempt，保留来源，不覆盖原日志。不同模型、上游或 runner 条件的记录拒绝自动混合。补跑后仍有缺失时，报告保持缺失，不当成完整全量结果。
