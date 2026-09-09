# 提交整理记录（历史）

以下保留 2026-09-09 整理过程中的文件分类及阶段待办，不作为当前运行指南。当前交付包括 baseline/final、评测数据与脚本及最终报告；正式数据为 test1k。安装、配置、资产初始化、单条和全量运行已统一到 [快速启动评测](QUICK-EVALUATION.zh-CN.md)。外部源码包下载入口待补充，本次不上传；本地密钥、运行日志和依赖均由 Git 忽略。

## 顶层目录

| 路径 | 提交定位 | 当前处理 |
| --- | --- | --- |
| `implementations/baseline/` | 基线实现，对照实验必需 | 保留 |
| `implementations/final/` | 最终运行实现 | 保留已有修改；提示词问题另行处理 |
| `evaluation/MemoryProxy/` | 数据、固定契约、Gold 编译、运行器、采集器、评分器与测试 | 已移除 203 个产品源码文件及配套启动脚本、Docker 和旧 pnpm 文件；保留评测目录与配置模板 |
| `docs/task1-report/` | 报告、复现指南、附录 | 保留；阶段计划文档待核对 |
| `scripts/` | 提交操作入口和辅助脚本 | 按下表分类，暂不删改实现 |
| `runs/` | 实验输入快照、回执、证据、分析与重试记录 | 本地保留，Git 已忽略；发布结果需单独选择和整理 |
| `.runtime/` | 本机 CLI 状态、Core 数据库和连通测试产物 | 本地保留，补充 Git 忽略 |
| 各级 `node_modules/`、`dist/`、缓存、日志 | 安装或运行生成物 | Git 忽略 |
| `.env`、本地 evaluation 配置 | 本机配置 | Git 忽略；保留 example 文件 |

## scripts 文件逐项分类

| 文件 | 建议 | 依据或后续工作 |
| --- | --- | --- |
| `prepare-final5-test100.ps1` | 保留：数据准备入口 | 文档已使用；调用 catalog 同步、数据校验、输入快照与资产包生成 |
| `run-final5-evaluation.ps1` | 保留：评测入口 | preview/check/execute 三阶段及 Resume |
| `final5-evaluation.example.json` | 保留：配置模板 | 当前是作者集 4 Case 示例，不是 test100/test1k 全量配置 |
| `audit-final5-input.mjs` | 保留：离线核算 | 审计输入及供应商 usage；依赖汇总脚本的 distribution |
| `audit-final5-input.test.mjs` | 保留：测试 | 验证 usage 解析 |
| `final5-static-input.mjs` | 保留：静态 Token 计量 | 依赖 distribution；默认使用评测工程的固定 tokenizer 依赖 |
| `final5-static-input.test.mjs` | 保留：测试 | 验证静态输入提取 |
| `summarize-final5-complete.mjs` | 保留 | 同时提供公共统计函数；已去掉写死的 10 Case 和并发描述，显示实际配对数量 |
| `summarize-final5-complete.test.mjs` | 保留：测试 | 验证分布统计和报告路径 |
| `start-final5-core.mjs` | 保留，待补运行说明 | 启动独立运行目录的 Core 并初始化身份；需核实 Core 依赖可用性 |
| `start-final-memory-core.mjs` | 待核对使用方式 | 只设置环境变量，没有启动调用；可能作为预加载模块，不能直接判定无用 |
| `build-final5-runtime-bindings.mjs` | 保留，待修复通用性 | 从 Memory 恢复日志生成映射，但固定 39 Team，且直接写 verified；需补完整校验依据 |
| `create-final5-runtime-tasks.mjs` | 保留，待补说明 | 创建 Task 并读回确认身份，为 bindings 补 taskId |
| `run-dual-cli-smoke.mjs` | 保留，CLI 阶段再处理 | 文档有入口，检查 CLI 与现有 Proxy；当前含本机安装路径假设 |
| `create-baseline-retry-plans.mjs` | 候选移出提交入口 | 根目录已改为脚本相对路径；仍绑定具体日期的运行批次，暂保留当前实验恢复用途 |
| `create-v4-claude-retry-plan.mjs` | 候选移出提交入口 | 根目录已改为脚本相对路径；仍绑定具体 checkpoint，暂保留当前实验恢复用途 |
| `analyze-final5-results.mjs` | 已删除 | 无运行链路引用；固定日期、10 Case 及结论文字，不适合计算新实验结果 |
| `check-submission.mjs` / `.test.mjs` | 新增：独立文件预检 | 仅依赖 Node 内置模块；检测缺失文件、仓库外路径与符号链接，支持运行时文件严格检查 |
| `prepare-workspaces.mjs` / `.test.mjs` | 新增：外部仓库接入 | 导出仓库清单，验证实际 Git 提交后重新生成本机 manifest |
| `verify-reproduction.ps1` | 新增：统一回归入口 | 覆盖本次提交使用的 Final5 检查、采集、评分和脚本测试 |
| `FINAL5-TEST100.md` | 候选合并后删除 | 早期排障和“尚未实现”状态；先迁移仍适用的信息并更新引用 |
| `EXPERIMENT-RUNS.md` | 保留：运行隔离说明 | 运行目录、证据保留与 CLI Home 隔离机制 |
| `README.md` | 保留：操作索引 | 后续补齐资产恢复入口与正式集流程 |

## evaluation 中应保留的链路

这些是已识别的关键入口，并非对整个评测目录完成了无用代码判定。

| 环节 | 入口（相对 `evaluation/MemoryProxy/eval/tool-prompt-bench/`） |
| --- | --- |
| 数据及目录 | `formal-dataset/final5/`，含作者集、test100、test1k、catalog 和 manifest |
| 输入准备 | `prepare-final5-test100.ts`、`build-final5-selection-plan.ts`、`final5-campaign-builder.ts` |
| 资产恢复 | `formal-assets/final5-restore-bundle.ts`、`restore-final5-memories.ts`、`restore-final5-skills.ts` 及其依赖 |
| 执行与采集 | `run-final5-dual.ts`、`final5-real-executor.ts`、`final5-http-capture.ts` 及客户端运行器 |
| Gold 与评分 | `final5-gold-compiler.ts`、`measurement-v2/`、`final5-metrics-report.ts` |
| 离线复算 | `collect-final5-evidence.ts` |
| 恢复运行 | `build-final5-rerun-plan.ts`；与临时 retry 脚本选择规则不同，不能未经核对直接替换 |

## 早期阶段待办记录

- 已明确运行源码和 Gold 契约来源：运行 baseline/final，评分使用 `evaluation/MemoryProxy/contracts`；产品提示词问题另行处理。
- 当时完成副本删除后的评测、脚本及提示词回归。历史测试数量不代表当前范围，当前可执行检查统一使用 `verify-reproduction.ps1`，真实模型执行需另看运行回执和 HTTP 证据。
- 确定正式提交使用的数据集和实验批次，再补齐对应准备、导入、执行、复算命令。
- 核对 runtime bindings 的实际验证流程，不能把日志完成或 verified 字段视为全部就绪。
- 清理历史说明前，先确认其中仍需要的恢复与排障步骤已进入当前复现指南。
- 当时仅跟踪少量提示词文件，需要补齐源码、数据和文档。当前交付范围以仓库首页和 Git 文件列表为准，不沿用这一历史数量。
- 外目录依赖、MemoryCore 和 CLI 安装配置在最后一阶段集中处理；完成干净环境复现前，不宣称端到端可复现。
- Git 忽略只约束 Git 收录；手工压缩整个工作目录仍会带入 runs、runtime 和依赖，需要另行定义提交包内容。
