# 本轮错误修复记录

日期：2026-09-09。本文是本轮代码审查与修改的记录，不是评测结果或上线验收结论。

## 范围与状态

- 先将 `implementations/final/MemoryProxy/src/injection/tool-prompt` 的四处分叉文件恢复为参评副本内容，再补齐明确的功能缺失和语义错误。
- 后续修复同步到 `implementations/final/MemoryProxy` 与 `evaluation/MemoryProxy` 的对应文件；不表示两个完整源码树相同。
- `implementations/baseline` 作为对照保留，未将修复写回 baseline。
- 保留调用触发、加载门控、检索范围、能力缺省值等策略差异，不以“恢复 baseline 全部行为”为目标。
- 用户明确要求不运行测试后，本轮后续修复只做静态代码审查与差异格式检查。此前曾启动的测试有失败，不能作为当前修复的验证依据。没有针对当前最终状态的运行测试结论，也没有新的模型评测结果。
- 未执行提交、推送或部署。

## 一、baseline 也有的问题

### B-01：合法空附件下载成 JSON 信封（已修复）

**触发条件：** Core 成功返回 `code=0`、`data.content=""`。资源 schema 允许空字符串，例如合法的零字节文件。

**原行为：** 下载 bridge 用 `!parsed.data?.content` 判断失败，把空字符串与字段不存在混为一谈，直接返回 HTTP 200 的 JSON 信封。客户端保存的不是原始空文件。

**修复：** 改为 `typeof parsed.data?.content !== "string"`。空字符串进入正常字节解码路径，返回零字节响应；缺失或非字符串内容仍走原有异常响应分支。

**来源与位置：**

- baseline 原实现：[skill-bridge.ts](../../implementations/baseline/MemoryProxy/src/skill/skill-bridge.ts)，`files/download` 分支。
- 修复实现：[skill-bridge.ts](../../implementations/final/MemoryProxy/src/skill/skill-bridge.ts)，同名分支。
- 合法空内容依据：[skill-schemas.ts](../../implementations/final/MemoryCore/src/gateway/skill-schemas.ts)，`skillResourcePayloadSchema.content` 为 `z.string()`。

### B-02：附件读取说明误称加 `-o` 即返回原始字节（说明已纠正）

**baseline 原说明：** `skill_files_read` 的说明声称 curl 加 `-o` 后 proxy 会返回原始字节。实际上 `-o` 只改变客户端保存位置，不会改变服务器响应类型；该接口返回 JSON。

**当前状态：** V4 原先已增加独立的 `skill_files_download`。本轮进一步明确：`files_read` 返回 `data.content` 与 `data.encoding`，`-o` 保存的是 JSON；下载原始字节应使用 `files_download`。本轮不是新实现下载接口。

**位置：** baseline 的 [skill-tools-injector.ts](../../implementations/baseline/MemoryProxy/src/injection/injectors/skill-tools-injector.ts)；当前 [execution-hints.ts](../../implementations/final/MemoryProxy/src/injection/tool-prompt/execution-hints.ts)。

### B-03：Skill 版本冲突不能简单通过重新 view 恢复（未修复）

**触发条件：** 当前会话固定了旧 Skill 版本，其他会话更新了同一 Skill。

**问题：** bridge 会用固定版本覆盖按 ID 读取的 `version`、写入的 `expected_version`。重新按 ID view 仍可能读取旧版本，写入继续冲突。baseline 的“过期后重新 view 再写”说明不足以保证恢复。

**状态：** 本轮仅确认，未改变版本固定策略或实现刷新机制，不能计为已修复。需要后续明确如何显式刷新版本并重新核对修改内容。

**位置：** baseline 与 final 的 `skill/skill-bridge.ts`，`Version pinning` 分支。

### B-04：Memory 聚合搜索将上游失败伪装为空结果（已修复）

baseline 与 final 的聚合搜索都会跳过失败来源，最后无条件返回 HTTP 200、code=0。超时、非成功 HTTP、无效 JSON 或业务失败可能被解释成“没有记忆”。

本轮后续修复要求来源同时满足 HTTP 2xx、业务 code=0、对应结果字段为数组且元素为对象，才计为成功。所有来源失败返回 HTTP 502、code=50301；部分失败保留成功结果，增加 data.partial=true 与 data.failed_agents，并通过 message 和提示词说明覆盖不完整。全部成功时保留原有响应形状，合法空数组仍是成功的空结果。

修改位置：final 与 evaluation 的 memory/memory-bridge.ts。baseline 保留原状。此修复未运行测试。

## 二、final 相对参评副本的分叉修复

| 编号 | 问题 | 本轮处理 |
|---|---|---|
| V-01 | 团队搜索命中后同时提示可用 `skill_view(name)`，与按当前 agent 名称查找的作用域不符 | 恢复为搜索结果使用 `data.items[].skill_id` 调用 `skill_view_by_id` |
| V-02 | final 额外删减 Memory 的 identity/preference/convention 提示，并在卡片中排除项目约定 | 撤销该次分叉，恢复参评版本；保留参评版本自身的缺口门控策略 |
| V-03 | 分叉后的 family-route 文本与校验器要求的 `Route:` 形式不一致 | 随回退恢复一致形式 |

涉及 `compiler.ts`、`execution-hints.ts`、`prompt-layout.ts`、`selection-fidelity.ts`。这里记录的是本轮开始时的差异，不表示这些问题在当前代码中仍存在。

## 三、提示词语义与操作说明补齐

| 编号 | 原问题 | 修复内容 | 位置 |
|---|---|---|---|
| S-01 | `TDAI memory = local MEMORY.md priority` 表达含糊 | 明确两者为同等来源，本地文件不覆盖 TDAI；原文不能直接认定为“优先级必然反了” | `tool-prompt/compiler.ts` |
| S-02 | Knowledge 将 `explore` 过窄描述为 filename | 调整为 query/files，保留符号搜索说明，补充 callers/callees/impact 的 symbol 语义 | `tool-prompt/compiler.ts` |
| S-03 | 缺少主要返回字段说明 | 补充 JSON 信封、Memory 的 `data.items[]` 与 `data.messages[]`、Skill 搜索 ID 路径 | `tool-prompt/prompt-layout.ts` |
| S-04 | 本轮早期错误地把所有 Knowledge 返回统一描述为 text/isError | 纠正为按工具区分：代码图查询为 text/isError，Wiki search 为 results，read_page 为 items | `tool-prompt/prompt-layout.ts` |
| S-05 | Skill 抽取缺少异步结果解释 | 说明归档并排队抽取；`archived` 不代表 Skill 已生成，`empty` 表示无可归档内容，不传 messages | `tool-prompt/execution-hints.ts` |
| S-06 | Knowledge 清单缓存遗漏资源维度 | 明确为每个资源每会话一次，不能把一个资源的 schema 当成其他资源的 schema | `tool-prompt/selection-fidelity.ts` |
| S-07 | 共享成功条件要求所有响应都有 JSON code，与下载原始字节矛盾 | 分开说明 JSON 与字节响应；下载失败仍可能返回 JSON 错误信封，不可直接当文件 | `tool-prompt/prompt-layout.ts` |
| S-08 | 场景读取卡片暴露 version，但实际 Core handler 只按 path 读取当前文件 | 移除卡片的可选 version，明确只读当前正文、不支持历史版本选择；未声称实现历史读取 | `tool-prompt/runtime-contract.ts`、`tool-prompt/execution-hints.ts` |

S-03 是说明缺口修复，不是修复 bridge 搜索结果解析。conversation search 读取 `data.messages[]` 的历史 bug 在本轮前已修好，不能重复计入本轮成果。

## 四、注入、校验和缓存修复

| 编号 | 触发条件与影响 | 修复内容 | 位置 |
|---|---|---|---|
| E-01 | 关闭 `injectL2L3` 后 profile guide 不输出，搜索合计三次上限随之消失 | 将上限移到 Memory 工具区，随工具输出；不改变上限数值 | `tool-prompt/compiler.ts` |
| E-02 | V4 在生产入口关闭两层提示词校验 | 启用校验，并在最终区域追加到请求之前完成检查 | `injection/index.ts`、`injection/pipeline.ts` |
| E-03 | 开启校验后，资产正文中的 Route、协议标题被算入结构计数 | 保留外层边界检查，将 Runtime assets 正文排除出协议与工具卡结构检查 | `tool-prompt/prompt-layout.ts` |
| E-04 | 修改提示词但缓存版本不变，老会话继续读取旧卡片，甚至与新校验规则冲突 | 更新 hook 缓存版本；当前为 `-direct-20260909-3` | `tool-prompt/profiles.ts` |
| E-05 | Knowledge 名称或摘要中的换行 `headers:` 被误提取为请求绑定 | 先分离 Knowledge 资源，再从生成的协议部分提取绑定 | `tool-prompt/prompt-layout.ts` |
| E-06 | 一个 Knowledge 资源 ID/URL 校验失败，导致整个资源组丢失 | 逐资源校验并警告、跳过异常项，正常项继续排序渲染；全无有效资源才返回空 | `injectors/knowledge-tools-injector.ts` |
| E-07 | 工具 hook 失败但资产列表成功，只有资产的区域被校验器要求补齐不存在的协议 | 根据实际工具区决定协议、门控、默认规则和绑定要求；仅资产状态仍校验外层与能力位图，有工具时保留完整检查 | `tool-prompt/prompt-layout.ts` |

baseline 没有 E-02 所指的 V4 编译/组装校验，因此启用它是新增防护，不是恢复 baseline 功能。E-03、E-07 是本轮启用校验后继续发现并修补的兼容边界。E-04 是本轮修改所需的缓存更新。

## 五、不计入修复成果的事项

- Codex 的 `x-conversation-id`、非首条 developer/system 注入、认证 gateway key 在 final 中原本已存在。此前把 evaluation 的差异误认为 final 缺失的判断已撤回；临时修改 evaluation 的 Codex 代码也已撤销。
- 未恢复 baseline 的“部分相关即必须加载 Skill”、缺省能力开启、原始锚点布局、重复 curl 示例等策略或表达形式。
- 未证明提示词修改会提高 ECR、TSR、Complete 等评测指标。文档中此前对此的预测不能替代实际评测。
- “与 baseline 没有任何其他问题”并非本轮结论；本记录只覆盖已定位、已修改或明确保留的问题。

## 六、交付与验证边界

代码修改主要位于 [final/MemoryProxy/src](../../implementations/final/MemoryProxy/src) 的注入模块和下载 bridge。当时曾同步至 evaluation 的产品副本；提交整理阶段已移除该副本，评测改为明确引用 final，Gold 和评分使用[独立固定契约](../../evaluation/MemoryProxy/contracts/README.md)。baseline 保留原状，便于继续对照。

相关修补执行过静态阅读、差异检查和 `git diff --check`；格式检查通过不等于运行行为验证。遵照用户要求，未为这些最终修改新增或运行测试。正式运行验证、模型评测和部署确认不在本轮已完成范围内。

## 七、后续全量差异审查：仅修改 final

本节记录用户要求“baseline 已有且正常、final 却缺失或退步”的专项检查。此阶段不修改 evaluation，也不回写 baseline。前面关于同步 evaluation 的描述仅指此前阶段。

### 本次已修复

| 编号 | baseline 正常行为与 final 退步 | 本次修改 |
|---|---|---|
| R-01 | baseline 初始化加载团队、Agent、任务时，对临时元数据错误最多尝试三次，最终失败也不写入已初始化状态；final 删除重试，并将失败会话持久化为 initialized + bypassed，后续跳过资产注入 | 在 final 恢复 `session/metadata-retry.ts`，CC/CB 两条初始化路径接入；失败保留未初始化状态，不覆盖已有 reset 标记。新请求可重新进入初始化；此前已经被置为 bypassed 的旧会话仍需重置 |
| R-02 | baseline health 响应只声明一次 toolPromptProfile，final 同一对象重复声明两次；这是 TypeScript 重复属性错误，影响 typecheck，不能据此声称 tsx 运行启动必然失败 | 删除 `MemoryProxy/src/server.ts` 中后一次同值声明，保留响应字段和值 |

R-01 位置：`implementations/final/MemoryProxy/src/session/claude-code/init.ts`、`session/codebuddy/init.ts`、`session/metadata-retry.ts`。重试 helper 与 baseline 对应文件的静态文本比较无差异。R-02 依据是同一对象的重复属性及 `package.json` 的 `typecheck: tsc --noEmit` 配置；本次没有运行类型检查。

### 后续 P2 修复（四项均已修改）

以下四项在统一审查时列为待修项，随后经用户授权完成代码修复。仍只做静态检查，不代表运行验证通过。

| 编号 | 优先级 | 原问题与具体触发 | 已实施修复 |
|---|---|---|---|
| R-03 | P2 | `MemoryProxy/src/config.ts` 对 YAML 中显式设置的 localhost/127.0.0.1 gateway 强制改为 Proxy 监听端口，导致本地 TLS gateway/隧道失效 | 配置解析仅 trim 地址，不再自动对齐监听端口；YAML 与 CLI 显式地址均保留原端口。显式端口对齐 helper 保留，但不由生产配置解析隐式调用 |
| R-04 | P2 | Core 添加成员不再创建默认 Agent，接替操作只在 Panel；TS/Python SDK 直连 Core 的路径缺失该能力 | Core 恢复 baseline 的查重及 best-effort 默认 Agent 创建。新增可选 `create_default_agent`，省略按 true；Panel 发往 Core 时显式传 false，继续自行执行模板/缺省创建，避免双建。该控制字段在调用存储前剥离，不持久化为成员属性 |
| R-05 | P2 | `.env` 裸写及 `awk -v` 转义破坏含 `$`、反斜杠等字符的合法配置 | 写回前用 Bash `printf %q` 序列化，通过 awk 的 ENVIRON 原样传递，替换与追加两条路径都使用相同编码；匹配现有 Bash source 读取方式，不改变交互流程 |
| R-06 | P2 | OpenAI `/models` 404 后直接探测 Anthropic，误拒绝仅支持 OpenAI 对话接口的上游 | `/models` 404/405 后先发 OpenAI `/chat/completions` 最小请求；对话端点也为 404/405 才保留原 Anthropic 兼容回退。`verify.sh` 复用相同回退 helper，保留失败状态；模型名先作 JSON 转义，控制字符拒绝入参 |

R-04 的 Core schema、服务层与 Panel 调用方需要一并发布；本次未执行发布。SDK 原有请求省略新字段即可恢复默认创建，无需调整调用方式。自动创建仍沿用 baseline 的 best-effort 行为，不保证在存储故障下创建成功，也不回填此前缺失的默认 Agent。R-06 的新增探测仅在用户运行部署检查时发生，本次没有发起任何 LLM 请求。

### 审查覆盖与限制

| 范围 | 本次静态覆盖 |
|---|---|
| MemoryProxy 注入 | 全部注入源码差异，包括五个资产/工具 hook、compiler/IR/卡片/执行提示/共享协议、能力裁剪、缓存身份、prewarm、pipeline、上下文与适配器；逐项对照原始批评文档 |
| MemoryProxy 运行链路 | 已有生产源码的全部非注入差异，包括主要 handler、初始化/恢复、身份、桥接、配置、存储和缓存、命令入口；新增模块核对入口及与原有能力的衔接 |
| MemoryCore | 21 个源码差异文件，以及配置、构建文件、插件和脚本；跟进 SDK 与 Panel 的跨模块调用契约 |
| MemoryKnowledge / SDK | Knowledge 四个变更源文件、SDK 三个变更源文件及其实际 Core 契约；既有默认 Agent 路径另作跨模块核查 |
| MemoryPanel | 后端差异、前端路由/登录/团队管理/资产页的 hooks/API/共享组件迁移；样式与新增指南核对能力入口，未做视觉验证 |
| 部署与根目录 | deploy 六个差异文件、安装与配置入口、根文档迁移清单和 CI 目录相等性 |

本次“全量”指按 baseline/final 的源码与配置差异清单完成检查，不表示逐行审计两个仓库所有相同代码。依赖目录、生成产物和生成文档不作逐行审计；baseline 不存在的新增任务生成等模块以入口和兼容性筛查为主。未运行测试、类型检查、构建、服务、部署脚本或模型评测，也未提交、推送或部署。

已排除的候选包括：L2a 恢复不预热（pipeline 的 cache-miss execute/self-heal 路径仍在）；Knowledge 缓存未带 userKey（实际可见性过滤依据 agent 与 asset，不能据字段名认定越权）；Panel 网络失败必然造成未处理 rejection（现有 HTTP adapter 已转换为错误信封）。调用门控、缺省能力、检索范围、模板迁移本身等策略未回退。B-03 的版本固定冲突仍是 baseline 也有的已记录问题，不重复列为此次新增回归。
