# 外部源码资产包

把 `release/external-workspaces-ready.zip` 解压到主项目根目录，得到 `workspaces/`，然后直接运行原来的评测命令。解压一次后就是可读的源码目录，不需要 Git、Python、再次解压或手动绑定路径。

```powershell
./scripts/run-final5-evaluation.ps1 -Config ./runs/my-run/evaluation.json -Mode execute -Quick -Variant V4 -Client codex
```

模型配置、评测资产和主项目依赖仍按原流程准备。入口自动识别 `workspaces/bundle.json` 的源码目录布局，为计划中的 Case 生成本机路径并传给评测器。配置的原有结果目录保持不变，生成的本机配置路径会打印出来。严格模式可沿用原命令加 `-Resume`；Quick 本身不支持 Resume。

默认读取主项目根目录的 `workspaces/`；源码解压到其他位置时可加 `-BundleRoot <目录>`。旧版内嵌 ZIP 包仍可通过 `-WorkspaceBundle` 使用，新包不需要这个参数。

## 包内内容

- `workspaces/sources/<owner>/<repo>/<sha>/`：直接可读的各版本源码。
- `workspaces/receipts/<owner>/<repo>/<sha>.json`：各版本的来源记录。
- `workspaces/bundle.json`：来源 URL、提交 SHA、原归档摘要、许可证与路径转换记录。
- `workspaces/workspace-manifest.portable.json`：完整作者集 Case 映射。
- `workspaces/workspace-manifest.test1k.portable.json`：test1k Case 映射。

作者集涉及 39 个仓库、301 个版本；test1k 使用其中 201 个版本。两份映射不含原机器绝对路径。评测配置仍须选择与数据集匹配的 manifest；入口保留全部 Case 记录，只为本次选中的 Case 绑定目录。

交付目标是读取源码，不要求构建外部项目。Git LFS 文件保留提交中的指针，第三方子模块记录路径和提交但不下载实体。为便于 Windows 普通解压，非法字符及路径段末尾的空格、句点替换为下划线，保留名称加下划线前缀；索引记录原路径与转换后的路径。符号链接保存为包含原链接目标的普通文本文件。归档遵守各仓库的 `git archive` 属性并保留归档内的许可证。

不要修改交付包中的源码目录；评测器会复制到独立的 Case 工作区。发布包附带整体 SHA-256，可用 `Get-FileHash -Algorithm SHA256` 核对下载完整性。入口核对来源记录与目录存在性，不会每次重新哈希整个源码树。

## 维护与打包

```powershell
node scripts/workspace-bundle.mjs export
node scripts/package-workspace-bundle.mjs
```

维护者需要 Git、Node.js 和 Python 3；使用者只需解压工具及主项目运行依赖。打包器先校验所有原始归档及 Case 覆盖，再将其内容流式写入单层 ZIP，排除本机缓存与运行凭据。输出为 `release/external-workspaces-ready.zip`、`.sha256` 和 `.json` 摘要，已有文件不会覆盖。

旧的 `external-workspaces.zip` 是内嵌 ZIP 布局，请交付带 `-ready` 的新包。
