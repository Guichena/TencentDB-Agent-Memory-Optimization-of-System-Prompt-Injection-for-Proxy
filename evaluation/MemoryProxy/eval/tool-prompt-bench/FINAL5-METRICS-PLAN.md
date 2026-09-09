# Final5 报告指标与采集计划

整理日期：2026-09-08。状态：报告与实现草案，尚未冻结，尚无正式对比结果。

本文为当前 `server_team` 对 `V4` 的双客户端实验确定报告结构、计算口径和最小采集需求。原仓库只读，不修改原初稿；本文也不修改数据、Gold、提示词、评分器或运行门禁。

## 1. 依据与适用范围

主要依据：

- [原指标与实验记录规范](/D:/projects/TencentDB-Agent-Memory/MemoryProxy/eval/tool-prompt-bench/TASK1-METRICS-EXPERIMENT-RECORDING-GUIDE.md)，修订日期为 2026-09-05，重点采用第 3 至 8、14 至 21 节。
- [原正式评分与统计报告计划](/D:/projects/TencentDB-Agent-Memory/任务一_完成实施计划/06_D1_正式评分与统计报告.md)。
- [原实验报告与优化方案计划](/D:/projects/TencentDB-Agent-Memory/任务一_完成实施计划/12_J_实验报告与优化方案.md)。
- [原实施范围与最小记录规则](/D:/projects/TencentDB-Agent-Memory/任务一_完成实施计划/15_实施范围与最小记录规则.md)。
- [当前服务对照定义](SERVICE-VARIANTS.md)。

当前保存的旧 `measurement-v2/SELECTION-CONTRACT.json` 绑定的是另一轮数据和候选流程，不能直接覆盖原 Markdown 的指标定义。尤其不能把其中 `effectiveCallRate` 指向完整链的旧绑定当作本轮 ECR，也不能用 `conditionalTerminalAccuracy` 代替本轮 TSR_cond。

每个客户端及其固定模型分别比较 baseline 与 final。Codex 和 Claude 的结果分别列出；模型、协议、CLI 不同，不能把两个客户端的绝对差异归因于 V4，也不合并为一个总胜率。一次运行中的两客户端可以并发，但资源竞争必须记录，耗时和缓存结论不能忽略这一条件。

原文中 V0/legacy 的角色映射到本轮 `server_team`；原文中的旧 V0-C 门槛、旧样本数量、旧 provider 限制不直接迁移。两套服务快照如果存在非提示词差异，报告应称为“服务版本对比”。只有共用运行逻辑的提示词消融，才能单独证明提示词改动的因果效果。

## 2. 对预检的处理建议

可以去掉“源码必须出现特定字符串”这种接口形状检查，或把相应事实记录移到 runner。不能在没有替代验证的情况下，一并丢掉它们要确认的实验条件。

| 现有字段或检查 | 建议处理 | 必须实际确认的事情 |
|---|---|---|
| `evaluationCapabilities` | 不强制生产服务提供固定 JSON 字段 | 最小配对测试能执行所需输入和工具路径 |
| `codexHistory` | 可用共同输入适配替代服务声明 | 两个版本收到语义一致的历史与当前问题，没有一侧丢历史或错误提升为系统指令 |
| `codexFrozenSkills`、`claudeFrozenSkills` | 可用外部资产适配与实际注入核对替代 | 相同 Case 的可见列表、可搜索池、正文与附件一致；冻结的是资产输入，不是强求两版本提示词文本相同 |
| `experimentConfigFingerprint` | 可以由 runner 计算和保存一次 | 模型、上游、预算、并发和实际配置一致，续跑没有混入另一套设置 |
| `serverInstanceId`、`claudeUpstream` | 可以由进程句柄、启动参数和请求记录替代 | 请求发给了本次启动的正确服务和指定上游 |
| `experimentReadOnly` | 不要求固定 health 字段；保留状态控制 | 禁止样本间记忆写入串扰，或每次从同一快照独立恢复；后台抽取、反思和 Skill 写入不能悄悄改变后续样本 |
| 文件执行权限与沙箱 | 按用户要求不新增限制 | 两版本使用相同执行策略，任务可以正常读写各自工作区 |

公平性底线：相同 Case、Gold、代码基点、资产窗口、模型设置、公开执行预算和评分规则；独立会话与工作区；完整观察；不让模型获得 Gold。两边都打开写入仍可能产生不同的累计状态，所以“开关相同”不足以证明不存在串扰。

不建设签名平台、通用审计系统或重复收据。一份运行配置、逐请求与逐工具原始记录、一套离线复算结果即可。外部观测层应被动记录，不插入提示或改写工具结果；确有输入转换时两版本使用同一转换规则。

## 3. 报告要检验的预期

### 3.1 基础指标完整保留

指标选取只决定报告的展示重点，不缩减采集、计算或完整结果表。原规范已有的主指标、链与配对指标、机制诊断、成本和覆盖指标全部保留；本轮不另造用于凸显 V4 的加权总分。

基础主表固定包含 ECR、FCR_all、FCR_pair、TSR_all、TSR_cond、T_static；完整结果表还包含 BSA、Pair Exact、Complete/Strict、Overcall、Binding、目标命中及本文后续各节列出的项目。未实现、无样本、证据缺失分别标明，不因未被选为重点而省略实现需求，也不因退步而从表中移走。

### 3.2 从已有指标中选择展示重点

建议重点解释四组已有指标：FCR、TSR、Complete/Strict、T_static。它们分别对应少误调、选对工具、完整且精简的调用链、说明压缩。ECR 始终与 FCR 同表，TSR_all 与 TSR_cond 同表，Complete 与 Strict 同表，不将互相制约的指标拆开只讲一侧。

| 设计预期，尚非结果 | 正文优先展示 | 同时展示的退步风险 |
|---|---|---|
| 上下文已经足够时更少打扰工具 | FCR_all、FCR_pair、Natural Coding Intrusion、BSA | ECR 和 TSR_all，防止靠一律不调用取得低 FCR |
| 路由边界更清楚 | TSR_all、TSR_cond，家族与相邻工具混淆矩阵 | 漏调用、误选 Knowledge、malformed 意图 |
| 多步任务更完整、少跳步和多余调用 | Complete Chain、Strict Chain、Pair Exact | Binding、前驱违规、终点后冗余、目标命中 |
| 工具说明更精简 | T_static 及节省率，Token 构成 | 行为指标同时报告；不能仅凭 Token 降低声称非劣 |

上表中的 BSA、Pair Exact、混淆矩阵和参数绑定等用于解释重点指标变化，不替代基础主表。重点组及公式在正式运行前固定；结果出来后按实际证据说明哪些预期得到支持，未改善的重点项也照常报告。

不设人为加权总分，不按结果选择分母、最好的一次运行或最好看的客户端。允许强调有证据的局部进步；未测量、未实现、无对应样本和 provider 不提供字段，分别记录原因。

## 4. 集合与主指标公式

在同一个客户端、固定模型和数据计划内定义：

- `P`：CALL 样本集合。
- `N`：全部 NO_CALL 样本集合。
- `N_pair`：经验证的严格 Pair 的负端，不从 `no_call_basis` 猜配对关系。
- `Q`：经验证的正负 Pair 集合。
- `A_i`：完整观察窗口内，已绑定到 TDAI 执行器的尝试序列；`M_i = |A_i|`。
- `FirstCorrect_i`：首个 TDAI 的 family、tool、endpoint、method、operation 与 Gold 首步相符。
- `Complete_i`：正确完成冻结的合法链，包含参数、必要前驱和真实响应绑定；HTTP 接受单独报告。
- `L_i`：最短合法链长度；`K_i`：从 Gold 首步连续匹配的正确步骤数。

主对比使用两版本行为证据均完整的同 Case/Repeat 交集；Pair 比较要求两个版本的正负两端均可观察。另列全计划与单侧可观察结果，以及缺失界限。下面的分母均须标明所用集合，不能只输出百分比。

| 指标 | 计算式 | 方向与含义 |
|---|---|---|
| ECR / Trigger Recall | `sum(1[M_i > 0], i in P) / |P|` | 高；错家族也算触发，不等于完整链成功 |
| FCR_all_no_call | `sum(1[M_i > 0], i in N) / |N|` | 低；全部不该调用样本的误调用率 |
| FCR_pair | `sum(1[M_i > 0], i in N_pair) / |N_pair|` | 低；受控正负配对的误调用率 |
| TSR_all | `sum(FirstCorrect_i, i in P) / |P|` | 高；漏调用仍在分母 |
| TSR_cond | `sum(FirstCorrect_i, i in P) / sum(1[M_i > 0], i in P)` | 高；必须与 TSR_all 并列，不能用终点准确率替代 |
| BSA | `sum(PositiveTriggered AND NegativeNoCall, q in Q) / |Q|` | 高；只衡量正负调用边界 |
| Complete Chain | `sum(Complete_i, i in P) / |P|` | 高；完成合法调用合同链 |
| Strict Chain | `sum(Complete_i AND entire A_i exactly equals shortest Gold chain, i in P) / |P|` | 高；完整窗口内没有多余调用 |
| Pair Exact | `sum(PositiveComplete AND NegativeNoCall AND NegativeNoMalformedIntent, q in Q) / |Q|` | 高；沿用原 Markdown 的严格负端定义 |
| Natural Coding Intrusion | `sum(1[M_i > 0], i in N_coding) / |N_coding|` | 低；`N_coding` 为无 Pair 且 basis=natural_coding 的 NO_CALL |

所有比例保存整数分子、分母和 Case/Pair ID，零分母返回 `null/not_applicable`。Knowledge 没有正样本时不宣称正向效果，但实际发生的误选仍进入调用与混淆统计。

Pair Exact 需要同时捕获可识别但未绑定的 malformed TDAI 意图。只记录成功到达服务的 HTTP 请求不足以证明“没有 malformed”。缺这一观测时，原定义的 Pair Exact 标为待实现或不可观察；如提供 `PairExact_bound_only`，必须另名，不能冒充完整 Pair Exact。

工具选对与目标命中分开。正确的搜索返回其他资产，ECR/TSR 可以正确，而 Target Hit 为失败。目标判定依据稳定响应 ID、版本和资源路径；不能用请求里的目标 ID 或模型文字充当真实返回身份。

## 5. Token、成本和耗时

### 5.1 Token 主结果

本轮建议以每个 Case 首次任务请求中的实际静态工具说明为主采样单位；续轮请求另存，不把多轮重复发送量混成“模板长度”。这是需在运行前确认的新细化规则。

```text
T_static_i = encode(actual complete static tool-description text).length
T_dynamic_i = encode(actual complete dynamic asset text).length
T_prompt_i = encode(actual complete provider-visible system/developer text).length

StaticSaving = 1 - sum(T_static_final_i) / sum(T_static_baseline_i)
```

两侧使用相同 Case 集、能力条件、tokenizer 及版本；沿用原规范的 `o200k_base` 作统一文本计量，明确它不是不同模型的真实计费 tokenizer。实际计费消耗看 provider usage。baseline 总量为零时节省率为 `null`。

`T_static` 必须编码实际完整静态文本。各块独立编码之和不冒充整段精确 Token；完整 Prompt 也不等于静态与动态块 Token 的简单相加。保存文本边界、字符数、UTF-8 字节数和内容摘要，报告均值、P50、P95 及构成。不得为了显示压缩，只统计 final 的短卡而漏掉其余新增静态协议。

### 5.2 次级效率指标

- 全 episode 的输入、输出、普通输入、缓存读写和推理 Token，逐请求去重后求和；CLI usage 另记来源，不与同一请求的 provider usage 重复相加。
- `CacheReadRatio = sum(cache_read_input_tokens) / sum(provider_total_input_tokens)`，使用双方字段完整的同 Case 集，另报可观察覆盖率；写缓存与普通输入同理。
- 静态前缀字节一致性作为结构诊断，不能替代实际缓存命中率。冷暖条件和运行顺序未控制时，缓存差异仅作描述。
- 客户端执行耗时、工作区准备与清理耗时分开报告 P50/P95。首次 stdout 只叫 `first_output_ms`；TTFT 需另采 provider 首内容事件的单调时钟。
- 重试产生的真实成本单独累计，不能因不进入行为主评分而从实验总成本中删除。

没有实际价格表和对应模型版本时先报告 Token，不编造金额。行为质量相近也不能仅凭差异不显著宣称“已证明非劣”。

## 6. 机制指标与分层

以下项目使用同一份原始记录派生，保留在报告支持矩阵中：

| 指标 | 口径摘要 |
|---|---|
| Family / Sibling Confusion | 首个已绑定动作的家族或固定相邻工具组错误；保存混淆矩阵及其分母 |
| Step Coverage | `sum(K_i) / sum(L_i)`，不能替代完整链成功 |
| Binding Slot / Case Accuracy | 正确参数来源槽占全部要求槽的比例；全部槽正确的 Case 占需要绑定 Case 的比例；未执行所需步骤不能计为正确 |
| Prerequisite Violation | 跳过强制前驱的 Case，占要求强制前驱的 CALL |
| Post-terminal Rate | 合法完整终点后仍调用的 Case，占到达该终点的 CALL |
| Overcall | 冻结评分规则识别的错误路径或冗余调用；保留冗余位置，不能只用 M_i 大于 L_i 判定 |
| ToolSPL | 完整链成功时为 `L_i / max(L_i, M_i)`，否则为零；在 CALL 上求均值 |
| Target Hit / Target-aware Chain | 使用稳定响应身份，在可观察目标身份的 CALL 上统计；另报目标证据覆盖率 |
| Malformed / Runtime Accepted | 可识别未绑定意图与 HTTP 接受分开，均不替代 ECR/FCR |
| Capability Hallucination | 与实际能力集合核对；包含可识别未绑定意图，不把普通本地工具算成幻觉 |
| Coverage | 计划、实际运行、证据完整的 Case/Pair/契约/链型数量，不作为模型效果 |

默认分层：Memory/Skill、Memory 层级、Skill listed/searchable/resource、链长、Pair/非 Pair、NO_CALL basis、来源、Team。没有对应样本的层标为不适用，不补造样本或将别的层合并进去。菜单位置偏差需独立消融，主实验没有运行则标 `not_run`。

## 7. 完整观察和最小采集

两版本统一运行到模型自然结束或相同公开预算。执行器不读取 Gold 决定何时停止；本地工具、首次 TDAI、错误工具、合法终点均不是提前停止点。当前 Final5 已选择自然完成，暂不额外引入旧规范中计划的六次调用上限；超时等预算在 Dev 校准后确认并记录。若以后增加次数上限，需对所有 Case 使用同一公开规则。

到达预算而在途调用已收尾、证据完整时，标 `censored`，可以报告固定预算行为；请求半途被杀或结束证据缺失时记为未知。漏调用、选错、拒绝不因结果差而排除或重试。

建议每个 attempt 保留以下少量文件，复用现有 raw JSONL，不再另造多套同内容收据：

| 文件或现有等价产物 | 最少记录 |
|---|---|
| 一份 experiment 配置 | 数据清单、服务源码版本、模型/CLI/上游、预算/并发/顺序、资产与能力配置、指标版本 |
| attempt 元数据 | case/client/variant/repeat/attempt/session、工作区基点、开始结束、终止原因、censored、错误分类 |
| CLI 原始事件与 stderr | 完整调用意图、参数、输出和真实结束事件；用于发现未到达 HTTP 层的错误意图 |
| provider 请求与完成记录 | request ID、关联 Case/attempt、实际输入及注入块边界、响应状态、原始 usage、时钟 |
| tool begin/completion 记录 | correlation ID、进入顺序、绑定状态、family/tool/endpoint/method/operation、参数、响应/稳定身份、状态码和时间 |
| metric-support | 分别记录 behavior/token/cache/target/intent 是否可计算及缺失原因 |

事件中不保存鉴权密钥。原始输入和工具响应留在实验目录中；供评分器使用的 Gold 和派生分数不写回模型工作区。运行后离线加入 Gold，产生逐 Case/Pair 分数和汇总。

## 8. 统计与报告版式

采用原初稿的记录规则：主 repeats=1，不选 best-of-N；需要重试时保留全部 attempt，选最早证据合格的一次，且只重试基础设施问题。当前代码即使记录多次 attempt，也需要核对实际挑选策略和失败分类。

每个客户端分别给 baseline、final、差值。比例差统一 `final - baseline`，用百分点表示；FCR 等负向指标要标明下降为好。Token 节省率单独用百分比，避免混淆。

沿用原初稿的统计计划，尚未在本仓验证实现：比例给 Wilson 95% 描述区间；同 Case 比较保存改善/退步 discordant counts；主差值按 Team 同步重采样，seed=20260905、10000 次；repo/source 关联 cluster 作敏感性分析。共享相邻 Team 资产的依赖限制必须披露。小规模试跑只能说明路径与方向，不能证明小幅改善或非劣。

基础设施缺失另报计划分母下的保守范围：事件已知数 k、未知数 u、计划数 n，对应 `[k/n, (k+u)/n]`。这不是统计置信区间。缺 usage 只影响成本项，不自动丢弃完整行为；但缺输入或工具证据的行为不能当作“未调用”。

报告正文建议固定为：

1. 实验范围、服务版本、数据分布及覆盖，说明这是试跑还是正式留出评测。
2. 主对比表：ECR、FCR_all、FCR_pair、TSR_all、TSR_cond、T_static，同时给分母、差值、区间和缺失。
3. 整体行为：BSA、Pair Exact、Complete/Strict；按单步、多步和资源链拆开。
4. 错误解释：家族混淆、调用链漏斗、终点后冗余、目标命中及典型退步案例。
5. Token 构成和行为对 Token 散点；缓存与耗时在证据足够时补充。
6. 复算入口、不可测项和结论边界。

对应机器产物至少为 `case-scores.jsonl`、`pair-scores.jsonl`、`comparison.json`、`metric-support.json` 和 `report.md`；归档在 `runs/<experiment>/report/`，不覆盖原始执行证据。

## 9. 当前实现缺口与接入顺序

这是源码核对结果，不是已运行实验的统计结果：

- Final5 已保存原始 CLI 输出、生命周期、耗时及部分 usage；`paired.json` 仍为 `not-scored`。
- 当前服务快照缺少旧 runner 所要求的实验接口；可用最小外部适配替代，不应仅伪造 health 字段。
- provider 与执行器完整观测尚未接成当前服务对的评分输入；Claude 回执仍传 `proxyUsage: null`。
- `aggregate.triggerRecall` 对应本文 ECR；`firstActionSelectionAccuracy` 对应 TSR_all；TSR_cond 需从首动作事实另算，不能使用条件终点准确率。
- 当前 `measurement-v2/scorer.ts` 仍使用终点前缀计算 Strict/Overcall/ToolSPL；完整窗口规则必须先修正并回归，不能直接报告为本文同名指标。
- 正式对照集为 test1k：39 队、1,140 条。指标分母以该次运行实际选中样本为准。
- baseline 固定先跑、final 后跑的阶段顺序可能影响缓存与时间对比；需要控制顺序或只将这两类数据作描述，不能预先保证公平。

建议实施次序：确认本文主指标及数据版本；建立最小共同输入与被动观测适配；用合成轨迹验证公式；跑包含 CALL、NO_CALL 和多步链的固定小批配对；验证原始记录能离线复算；之后再扩大规模。

待运行前确定的项目：最终数据清单、公开预算、资源并发与阶段顺序、provider 字段支持、正式留出与开发集的边界、是否要检验非劣及其界值。没有事先界值时只报告差值与区间。

## 10. 最小公式回归样例

以下是合成输入的预期，绝不是实验成绩：

| 轨迹 | 必须得到的事实 |
|---|---|
| Memory CALL 却先调 Skill | ECR=true，TSR=false；不能把“有调用”写成选对 |
| CALL 完全不调用 | ECR=false，TSR_all 分子不增加，仍留在 CALL 分母 |
| NO_CALL 先本地 read、后调 TDAI | FCR=true，不能在本地 read 后提前截断 |
| search、view、extra | 若前两步合法，Complete=true，Strict=false，PostTerminal=true |
| 两步 Gold 只完成 search | Complete=false，Step Coverage=1/2；缺步骤不自动等于多余调用 |
| 直接 view、跳过必须的 search | 记录前驱违规，不能因终点工具正确判完整链 |
| 正端完整、负端无 HTTP 但有 malformed TDAI 意图 | BSA 可为 true；本文 Pair Exact=false |
| behavior 完整但 cache 字段缺失 | 行为照常计分，cache=null 且说明原因 |
| 一侧缺整段工具日志 | 该侧行为未知，报告配对覆盖与缺失界限，不填零调用 |
