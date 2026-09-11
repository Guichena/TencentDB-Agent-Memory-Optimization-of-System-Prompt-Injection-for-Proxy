# Linux 复现评测流程

推荐环境：Ubuntu 24.04、Bash、普通用户，Node.js 固定为 24.16.0。下面使用 nvm 在用户目录安装 Node，不需要 Python 虚拟环境或 Conda。以下命令在同一个终端按顺序执行。

提醒：评测会自动执行代码，请勿在存有敏感数据的环境中运行。

## 1. 拉取仓库、安装依赖

```bash
sudo apt-get update
sudo apt-get install -y git curl python3 python3-dev build-essential libarchive-tools golang-go iproute2
```

安装 Node 环境。已有 nvm 时跳过 git clone 这一行：

```bash
git clone --depth 1 --branch v0.40.3 https://github.com/nvm-sh/nvm.git "$HOME/.nvm"
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 24.16.0
nvm use 24.16.0
node --version  # 应输出 v24.16.0
npm --version
```

nvm 管理 Node 版本，项目依赖安装在各自的 node_modules 中，后续 npm 命令无需 sudo。新开终端时，重新执行 `export NVM_DIR="$HOME/.nvm"`、`source "$NVM_DIR/nvm.sh"` 和 `nvm use 24.16.0`。

拉取工程并安装所选客户端：

```bash
git clone https://github.com/Guichena/TencentDB-Agent-Memory-Optimization-of-System-Prompt-Injection-for-Proxy.git memoryproxy-eval
cd memoryproxy-eval

export CLIENT=claude-code   # 或 codex
bash linux-reproduction/setup.sh "$CLIENT"
```

已安装 Claude Code 或 Codex 且终端能找到时，直接复用；未安装时，脚本会自动安装所选程序。先完成下面的单条试跑，再开始正式实验；同一轮实验中不要更换程序版本。

## 2. 填写模型配置

编辑 `evaluation/.env`，填写所选客户端的 URL、API Key 和模型名。另一客户端的模型名保留非空，Key 不必填。

```bash
vi evaluation/.env
export NO_PROXY=127.0.0.1,localhost
export no_proxy="$NO_PROXY"
```

不要上传 .env。需要出站代理时另外设置 HTTP_PROXY、HTTPS_PROXY。

### Core 与 Proxy 端口

不修改时使用以下默认值：

| 服务 | 默认端口 | 配置位置 |
|---|---:|---|
| Core | 18427 | 首次 prepare 的 `--core-port` 参数 |
| Codex Proxy | 8096 | `evaluation/.env` 的 `TDAI_CODEX_PROXY_PORT` |
| Claude Code Proxy | 8097 | `evaluation/.env` 的 `TDAI_CLAUDE_PROXY_PORT` |

在当前终端设置 Core 端口，第 4 节 prepare 会使用它：

```bash
export CORE_PORT=18427  # 如被占用，可改为 18428
```

需要修改 Proxy 端口时，编辑 `evaluation/.env` 中这两行，例如：

```dotenv
TDAI_CODEX_PROXY_PORT=18096
TDAI_CLAUDE_PROXY_PORT=18097
```

三个端口应互不相同、处于 1024 到 65535 之间且未被占用。Core 不要使用 8096 或 8097，入口将它们保留给默认 Proxy。服务绑定本机 127.0.0.1，不需要向外开放端口。

端口按客户端划分，不按 baseline/V4 划分：单选一个客户端时，只启动 Core 和对应的一个 Proxy；baseline、V4 先后复用该 Proxy 端口。这些是本地服务端口，不是模型上游 URL。

**生效规则：**Core 端口在 prepare 时写入 `runs/$RUN/evaluation.json` 的 `coreUrl`，initialize、run 和 retry 都读取该配置。后续只改 CORE_PORT 变量，或给 run 加 `--core-port`，不会改变已有 RUN。已有 RUN 要换端口，先停止实验，再编辑该文件的 coreUrl；不要覆盖整个配置文件。

Proxy 在下一次启动时读取 .env；如果你手动设置过 evaluation.json 中的 `clients.codex.port` 或 `clients.claude-code.port`，这些字段优先于 .env。不要修改旧 quick 目录的 launch-config.json 来配置新实验。

检查端口占用可运行 `ss -ltnp`。doctor 当前探测默认端口；自定义端口须自行核对。端口或配置都不要在实验运行过程中修改。

## 3. 准备业务源码

选择一种评测形式，以下两组执行一组。

**前 250 条：**

```bash
export DATASET=first250
export EVAL_SCRIPT=linux-reproduction/evaluate-250.sh
export RUN="linux-250-${CLIENT}-01"
```

**全量 1,140 条：**

```bash
export DATASET=full1140
export EVAL_SCRIPT=linux-reproduction/evaluate-full.sh
export RUN="linux-full-${CLIENT}-01"
```

已有完整 `workspaces/` 目录就直接复用。拿到 `external-workspaces-ready.zip` 时，**在仓库根目录 memoryproxy-eval 下解压**，不要解到 linux-reproduction 目录：

```bash
WORKSPACE_ZIP="/实际路径/external-workspaces-ready.zip"
bsdtar -xf "$WORKSPACE_ZIP" -C .
test -f workspaces/bundle.json
```

压缩包自带顶层 workspaces 目录，解压后应得到 `memoryproxy-eval/workspaces/bundle.json`，以及 sources、receipts 等内容；不要多套一层 workspaces。已有源码目录时跳过解压，避免覆盖。

没有源码包时，才按固定提交下载：

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
bash "$EVAL_SCRIPT" prepare --client "$CLIENT" --run "$RUN" --core-port "$CORE_PORT"
bash "$EVAL_SCRIPT" initialize --client "$CLIENT" --run "$RUN"
bash "$EVAL_SCRIPT" run --client "$CLIENT" --run "$RUN" --variant both --case DVG-T04-T01-C001 --concurrency 1
```

prepare 只用于新 RUN；已有 RUN 不要重复 prepare。Core 端口在这一步固定，后续命令不用再次传端口。确认 baseline 和 V4 都是 `completed=1、failed=0` 再继续。失败日志在 `runs/$RUN/setup-logs/` 和执行目录中。

## 5. 正式运行

根据第 3 步所选版本执行对应命令：

```bash
# 前 250 条
bash linux-reproduction/evaluate-250.sh run --client "$CLIENT" --run "$RUN" --variant both --concurrency 5

# 或全量 1,140 条
bash linux-reproduction/evaluate-full.sh run --client "$CLIENT" --run "$RUN" --variant both --concurrency 5
```

先跑 baseline，再跑 V4，每阶段 5 并发，单条超时 8 分钟。两条命令只选与第 3 步一致的一条，沿用初始化时的 RUN。建议在 tmux 中执行，避免 SSH 断开；新开终端须先按文末恢复变量。运行期间不要改源码或配置。

## 6. 检查运行是否完成、有无错误

先找到控制台输出的正式运行目录，替换下面的 quick-实际UUID。这里查看执行状态，不计算分数：

```bash
QUICK="runs/$RUN/execution/quick-实际UUID"
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/results.ts status "$QUICK" "$CLIENT"
```

输出中，server_team 表示 baseline。分别检查两边：

| 字段 | 含义 | 接下来做什么 |
|---|---|---|
| finished=false | 尚未取得该阶段最终回执 | 等待运行结束；若进程已退出，检查日志 |
| completed | 正常结束的 Case 数 | 不代表工具行为一定正确 |
| failed | 超时或其他执行错误的 Case 数 | 到第 7 节分类，不能直接认定全部需要补跑 |
| failedCaseIds | 执行失败的 Case ID | 用于定位对应记录 |

有错误时，可先查日志位置：

```bash
find "runs/$RUN/setup-logs" "$QUICK/$CLIENT" -type f -name '*stderr*'
```

用 `tail -n 80 日志路径` 查看末尾报错。认证失败先检查 .env，连接失败先检查上游地址和网络，初始化失败先检查对应工具链。不要打印或上传 API Key。

## 7. 判断是否需要补跑，只补跑一次

补跑是为了补救网络、认证、初始化或采集故障，避免把这些故障当成模型答错。**不是为了提高分数，也不是所有 failed 都重跑。**

| 情况 | 处理 |
|---|---|
| 正常完成、证据完整，即使行为得分低 | 保留，不补跑 |
| 持续真实交互满 8 分钟，临近结束仍有活动，日志足以评分 | 保留超时结果，不补跑 |
| 认证、429/503、断连、初始化卡住或关键采集文件缺失 | 列入清单，修复原因后补跑一次 |
| 超时日志不足，且无法确认缺失原因 | 列为待复核；无法判定时保留缺失，不猜分 |

临近结束固定为最后真实模型或工具活动距结束不超过 180 秒。HTTP 200、重连和心跳不算真实活动。

两阶段都停止后，运行分类检查。audit 只生成清单，不调用模型，也不计算最终指标：

```bash
bash linux-reproduction/run.sh audit "$RUN" "$CLIENT" baseline
bash linux-reproduction/run.sh audit "$RUN" "$CLIENT" V4
```

每条命令输出：

- `selected`：已有可评分记录的 Case 数，不需要补跑。
- `retry`：建议补跑的 Case 数。两边都是 0 时，跳过补跑。
- `needsReview`：日志或来源信息不足、需要复核的 Case 数，不会自动补跑。
- `audit`：本次生成的 retry.json 路径。

把两次输出的 audit 路径分别保存下来：

```bash
export BASE_AUDIT="baseline输出的retry.json路径"
export V4_AUDIT="V4输出的retry.json路径"
```

要查看具体哪些 Case 需要补跑、原因是什么，可以执行：

```bash
node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(a.rows.filter(r=>r.retryRequired||r.reviewRequired),null,2));' "$BASE_AUDIT"
node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(a.rows.filter(r=>r.retryRequired||r.reviewRequired),null,2));' "$V4_AUDIT"
```

如果 `retry > 0`，执行对应补跑；空清单会自动跳过。不要修改 retry.json：

```bash
bash "$EVAL_SCRIPT" retry --client "$CLIENT" --run "$RUN" --retry-plan "$BASE_AUDIT" --concurrency 5
bash "$EVAL_SCRIPT" retry --client "$CLIENT" --run "$RUN" --retry-plan "$V4_AUDIT" --concurrency 5
```

补跑结束后，重新检查两边，把新输出的 audit 路径重新赋给 BASE_AUDIT 和 V4_AUDIT：

```bash
bash linux-reproduction/run.sh audit "$RUN" "$CLIENT" baseline
bash linux-reproduction/run.sh audit "$RUN" "$CLIENT" V4
```

**只补跑一轮。即使还有 retry 或 needsReview，也直接进入最终计算，不必继续补跑。** 无法评分的 Case 会保留为缺失，不进入指标分母。没有补跑时，直接沿用第一次生成的两个 audit 路径。

## 8. 最后统一计算一次

无论有没有补跑，最终用同一对最新 audit 计算行为指标和工具说明 Token。若补跑过，确保两个变量指向补跑后最新的 audit。

```bash
bash linux-reproduction/run.sh score-audits "$BASE_AUDIT" "$V4_AUDIT"
bash linux-reproduction/run.sh measure-static "$BASE_AUDIT" "$V4_AUDIT"
```

`score-audits` 打印结果目录 `runs/$RUN/reports/merged-.../`：

| 文件 | 查看内容 |
|---|---|
| comparison.json | 两版本行为指标、差值和实际配对可评分数量 |
| case-scores.jsonl | 每条 Case 的行为评分 |
| selection-provenance.json | 每条 Case 选用了哪次记录，以及剩余失败、待复核项 |

### 行为指标

`comparison.json` 里是英文代码名，与 [最终实验结果](../docs/task1-report/最终实验结果.zh-CN.md) 的中文名对应。只统计绑定到执行器的 TDAI HTTP：失败或选错家族仍算发出；Bash、Read、Grep 不算。记 P = 应调用且证据完整，N = 不应调用且证据完整，T = P 中实际发出过 TDAI 的子集。

| 代码名 | 中文名 | 公式 | 代表什么 | 方向 |
|---|---|---|---|:---:|
| `ECR` | 正例请求发出率 | T / P | 该调的案子有没有去调。不是正确率 | ↑ |
| `FCR` / `FCR_all` | 误调用率 | N 中发过 TDAI 的比例 | 不该调时有没有伸手 | ↓ |
| `TSR_all` | 正例首步命中率 | 首次 TDAI = Gold 首步 / P | 漏调也算未命中 | ↑ |
| `TSR_cond` | 发出后首步命中率 | 同上分子 / T | 已经发出时第一步是否选对 | ↑ |
| `Complete` | TDAI 必要链完成率 | Gold 步骤走完且绑定正确 / P | 选对工具并接上参数，不是编程完成 | ↑ |
| `Strict` | TDAI 无多余请求完成率 | 必要链完成且没有多发 / P | 只做必要步骤 | ↑ |
| `Overcall` | 正例多余发出率 | 正例里发过 Gold 以外 TDAI 的比例 | 该调时有没有多检索 | ↓ |

JSON 里还有 `FCR_pair`（只统计 Pair 负端）、`BSA`（Pair 边界切换）、`PairExact`（Pair 精确匹配），本任务主表不单列。`eligibleCaseCount` 是进入分母的有效 Case 数。同一集合下：正例首步命中率 = 正例请求发出率 × 发出后首步命中率。

### Token 指标

`measure-static` 打印结果目录 `runs/$RUN/reports/static-.../`。Token 以 `static-input.json` 为准，不要用 `comparison.json` 里的 `providerUsage`，也不要看 `metric-support.json` 里仍为未接入的 `T_static`。

| 文件 | 查看内容 |
|---|---|
| static-input.json | 工具说明长度、工具说明压缩率、未能抽出的 Case |

| 代码名 | 中文名 | 在 JSON 中的位置 | 代表什么 | 方向 |
|---|---|---|---|:---:|
| `T_static` | 工具说明长度 | `variants.*.T_static` 的 `mean` / `p50` / `p95` | 首次任务请求中完整工具说明的 `o200k_base` Token。不是账单总输入 | ↓ |
| `staticSavingPercent` | 工具说明压缩率 | 根字段 `staticSavingPercent` | `1 − ΣV4 / Σbaseline`，同一 Case 上 V4 比 baseline 短多少 | ↑ |
| `T_dynamic_listing` | Skill 条目长度 | `variants.*.T_dynamic_listing` | 目录里 Skill 条目正文的 Token，不计入工具说明 | — |
| `T_prompt` | 整段系统说明长度 | `variants.*.T_prompt` | 抽出后的完整系统侧文本，含工具说明与动态资产 | ↓ |
| `paired` | Token 对照条数 | `coverage.paired` | 两边都能抽出且 Skill 条目文本一致的 Case 数 | — |
| `missing` | 未能计量 | `coverage.missingBaseline` / `missingFinal` | 抽不出的 Case，不记为零，也不进压缩率分母 | — |

工具说明 Token 与行为计分使用同一批记录。每个 Case 只取第一次任务请求，跳过 CLI 写标题请求；用评测工程安装的 `tiktoken` / `o200k_base` 编码一次。`T_static` 计入共享协议、路由、卡片、列表外壳和绑定后的地址与请求头；不计入 Skill 条目正文、会话身份块、用户消息和供应商包装。工具说明压缩率只用 `paired` 那些 Case。Token 对照分母不必与行为指标相同。

同一 Case 只使用最早可评分记录，避免重复计算；首次失败、补跑成功时使用补跑记录。两版本对比只使用双方均可评分的 Case，因此应同时报告计划条数和实际配对条数，不把缺失当成零分。

不要在前面单独计算某个 quick 目录再当作最终结果，否则会遗漏其他目录的补跑记录。

## 注意

- 每次运行生成新目录，不自动续跑。audit 会读取同一 RUN 下的试跑、正式运行和补跑。
- 换客户端或数据集时换一个 RUN，重新初始化；源码无需复制。
- 新日志记录真实活动时间；旧日志使用文件时间时会标注，迁移时需保留时间戳。
- 不同模型、上游或 runner 条件的记录拒绝自动混合。
- 使用 Quick 协议，源码指纹用于追溯，不提供严格冻结保证。
- 若残留锁阻挡操作，运行 `bash linux-reproduction/run.sh doctor` 检查。确认进程已停止后才考虑 `--clear-stale`；状态不明的锁不要直接删除。

## 新开终端或 SSH 重连

先回到仓库根目录，恢复 Node 和变量；不会重新初始化或重新运行实验：

```bash
cd /实际路径/memoryproxy-eval
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 24.16.0
export CLIENT=claude-code   # 必须与原实验一致，也可为 codex
export DATASET=first250    # 必须与原实验一致，也可为 full1140
export CORE_PORT=18427     # 如首次 prepare 改过端口，填原值；已有 RUN 以 coreUrl 配置为准
case "$DATASET" in
  first250) export EVAL_SCRIPT=linux-reproduction/evaluate-250.sh; export RUN="linux-250-${CLIENT}-01" ;;
  full1140) export EVAL_SCRIPT=linux-reproduction/evaluate-full.sh; export RUN="linux-full-${CLIENT}-01" ;;
esac
export NO_PROXY=127.0.0.1,localhost
export no_proxy="$NO_PROXY"
```

如果原来使用了自定义 RUN 名称，改回那个名称；如使用出站代理，也恢复原 HTTP_PROXY/HTTPS_PROXY。查询状态时重新设置 QUICK；最终计算前，按第 7 节重新设置 BASE_AUDIT、V4_AUDIT，指向两边最新 audit 路径，再执行 `score-audits` 和 `measure-static`。
