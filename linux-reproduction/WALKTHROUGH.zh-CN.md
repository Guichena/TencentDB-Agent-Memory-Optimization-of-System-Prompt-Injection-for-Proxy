# Linux 实验步骤

环境：Ubuntu、普通用户、Node.js 24.5+（24.x）。复用现有源码，以下命令在同一个终端按顺序执行。

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

新增文件尚未推送，克隆版本需包含 linux-reproduction 目录。使用专用测试机器，不挂载私人凭据。

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
cat "$QUICK/$CLIENT/report/report.md"
```

两阶段结束后自动计分。comparison.json 保存分母和覆盖数，case-scores.jsonl 保存逐条得分。需要重新计分时执行：

```bash
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/results.ts score "$QUICK" "$CLIENT"
```

## 注意

- 每次运行生成新目录，不自动续跑；试跑与正式结果分开保存。
- 失败不会自动补跑或合并。补跑可加 `--case ID --variant baseline` 或 `--variant V4`，但不会更新原报告。
- 标准评分仅纳入 completed；有缺失时不能称为完整结果。行为低分不能作为重跑理由。
- 换客户端或数据集时换一个 RUN，重新初始化；源码无需复制。
- Linux 离线检查已通过，实机模型试跑尚未验证。
