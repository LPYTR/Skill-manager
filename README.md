# Skill Manager

AI 驱动的本机 Skill 管理中心。平时让 AI 下载、登记、安装，偶尔打开本地网页查看。支持 Windows，使用 Node.js 24、TypeScript、SQLite、React。

网页仅用于查看和检索：侧边栏保留“所有技能”和“个人收藏”，列表展示中文用途；详情提供适用场景、准备材料和可复制的调用提示词，原始说明折叠显示。搜索同时匹配中文指南、名称、标签及原始正文。安装、来源管理、诊断和备份仍通过 CLI 交给 AI 完成。中文指南独立保存在 `web/guides.ts`，不改写第三方文件；后续未知技能会明确提示先读取原始说明，不猜测其用途。

## 开始使用

当前电脑已经完成构建和初始化。日常使用可以直接双击项目根目录的 `start.cmd`，或在任意 PowerShell 目录运行：

```powershell
& 'D:\Project\Skill-manager\start.cmd'
```

启动器会自动找到本机的 Node.js 24+（包含 Codex 自带运行时），不要求全局安装 `pnpm`，也不要求先切换目录。默认打开本地网页，关闭服务时在终端按 Ctrl+C。

当前电脑桌面还提供 `Skill Manager` 快捷方式：双击后在后台启动服务并打开网页，已运行时直接打开现有页面，不重复启动。启动失败会弹窗提示，日志位于系统临时目录的 `skill-manager-desktop-4317.*.log`。快捷方式使用项目内 `scripts/launch-desktop.vbs` 和 `scripts/launch-desktop.ps1`，移动项目后需要更新快捷方式。

排查启动环境或指定端口：

```powershell
& 'D:\Project\Skill-manager\start.cmd' -Check
& 'D:\Project\Skill-manager\start.cmd' -Port 4320 -NoOpen
```

从源码重新安装时需要 Node.js 24+、pnpm，以及用于下载 GitHub 仓库的 Git。项目提供本地开发入口，优先复用现有工具；不修改用户保存的 PATH：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\Project\Skill-manager\scripts\pnpm.ps1' install
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\Project\Skill-manager\scripts\pnpm.ps1' build
powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\Project\Skill-manager\scripts\pnpm.ps1' setup:local
```

如果已经安装全局 `pnpm`，也可以使用标准命令：

```powershell
Set-Location D:\Project\Skill-manager
pnpm install
pnpm build
pnpm setup:local
```

最后一步创建固定的命令行入口，安装 `skill-manager` 配套 skill 到 Codex 用户目录，并盘点本机已知 skill 目录。它还会给 Codex 全局 `AGENTS.md`（已有非空 `AGENTS.override.md` 时更新实际生效的 override）和 Claude Code 全局 `CLAUDE.md` 写入持久安装规则：每次安装或更新 skill 必须登记到 Manager，核验 ID 和实际安装位置后才能报告完成。现有个人指令保留，修改前的文件备份到 Manager 的 `backups/instructions`。

新建一个 Codex / Claude Code 会话加载规则后，可以直接说：

> 把这个仓库中的 xxx skill 下载并安装到 Skill Manager。
>
> 看看本机有哪些关于文档的 skill。
>
> 把这个 skill 也安装到我的 Claude Code 项目里。

配套 skill 会调用固定入口，不需要网页运行。移动本项目或更换 Node 安装位置后，重新执行 `pnpm setup:local` 更新入口。

`list`、`show` 和网页清单查询会自动扫描已配置目录，因此其他工具放入这些目录的 skill 也会补录为外部引用。此补录发生在查看时，不是后台常驻监控；未登记的任意磁盘目录不在扫描范围内。全局 AI 规则约束加载它的客户端，不能在操作系统层面拦截所有第三方程序。

批量导入默认排除 `tests`、`fixtures` 等测试目录。相同名称的多工具适配版会选择目标工具对应的一个；若该目标已安装同一来源的某个版本，则保留现有选择。响应的 `skipped` 会解释跳过原因，不把适配副本当作失败项。`PARTIAL_FAILURE` 只阻止失败条目，其他独立条目可以继续通过 Manager 完成，原文件不被覆盖。

误导入的夹具或不使用的分发版本可归档，文件、历史版本和个人备注都会保留；已安装条目必须先通过 Manager 卸载。网页的“已归档”中可以查看和恢复。Blender 等应用的扩展不属于 agent skill，使用对应应用的官方安装器。

打开网页：

```powershell
& 'D:\Project\Skill-manager\start.cmd'
```

默认只监听 `127.0.0.1:4317`，自动打开浏览器。在终端按 Ctrl+C 停止服务。网页采用 `apple-design` 的系统字体、分层材质和即时操作反馈，支持深色模式、窄窗口及减少动态效果偏好。

## 命令行

可以在项目中使用 `pnpm cli`，或从任意目录调用安装后返回的启动入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.skill-manager\data\bin\skill-manager.ps1" list --json
```

源码入口 `pnpm cli` 与编译入口 `node dist/cli.js` 支持相同命令：

```powershell
pnpm cli scan --json
pnpm cli scan --root 'D:\Downloads\skills' --project 'D:\Project\my-app' --json
pnpm cli list --query '文档' --json
pnpm cli show SKILL_ID --json

# 默认：完整入库并安装到 Codex 用户级目录。
pnpm cli add https://github.com/OWNER/REPO --subdir skills/NAME --ref main --json
pnpm cli add 'D:\Downloads\skill.zip' --json
pnpm cli add 'D:\Downloads\some-skill' --no-install --json

# 多 skill 来源必须选定子目录，或显式添加全部。
pnpm cli add 'D:\Downloads\collection' --all --no-install --json

pnpm cli targets list --json
pnpm cli targets add '项目 · Claude' --id my-project --tool claude --project 'D:\Project\my-app' --json
pnpm cli targets add '其他工具' --path 'D:\Tools\skills' --json
pnpm cli install SKILL_ID --target my-project --json
pnpm cli install SKILL_ID --revision REVISION_ID --json
pnpm cli uninstall INSTALLATION_ID --dry-run --json
pnpm cli uninstall INSTALLATION_ID --json

pnpm cli edit SKILL_ID --tags '开发,写作' --notes '适用场景' --favorite --json
pnpm cli relink SKILL_ID 'D:\Downloads\new-location' --json
pnpm cli forget SKILL_ID --json
pnpm cli archive SKILL_ID --reason '不使用的适配版本' --json
pnpm cli list --filter archived --json
pnpm cli unarchive SKILL_ID --json
pnpm cli doctor --json

pnpm cli backup --out 'D:\Backups\skills-metadata.json' --json
pnpm cli export SKILL_ID --out 'D:\Backups\skill.zip' --json
pnpm cli --home 'D:\RecoveredManager' restore 'D:\Backups\skills-metadata.json' --json

pnpm cli ui --port 0 --no-open --json
```

`--json` 输出单个 `{ ok, data?, error? }` 对象。失败返回非零退出码；入库成功但安装失败会返回 `PARTIAL_FAILURE`，其中 `data.imported` 是已经保存的内容，`data.failures` 是安装失败原因。变更命令支持 `--dry-run`；远程添加的预览不进行下载，无法提前验证仓库内容。初次打开数据目录会创建空数据库和默认目录配置。

## 数据与文件边界

- 默认数据目录为 `~/.skill-manager/data`，可通过 `SKILL_MANAGER_HOME` 或 `--home` 更改。使用用户目录可避免 Windows 商店应用对 AppData 的重定向；旧的 AppData 数据不会被自动删除。
- 初始化会把数据库实际所在目录记录在 `~/.skill-manager/location.json`，让 Codex 与普通终端共用同一份数据，避免 Windows 应用目录重定向产生不同视图。路径检查仍以实际目录为准。配置指向的数据库丢失时会报错，不会悄悄创建另一份空清单。
- `scan` 引用原位置；`add` 保存新包到 `library/<skill-id>/<content-hash>`。资源、脚本、空目录和未知 YAML 元数据均保留，Git 内部元数据除外。
- Codex 默认安装到 `~/.agents/skills`；Claude Code 为 `~/.claude/skills`（支持 `CLAUDE_CONFIG_DIR`）。兼容盘点 `$CODEX_HOME/skills`、系统 skill 与两个工具的插件缓存。
- 插件缓存显示“状态未确认”，不会仅凭缓存断言已安装或启用。系统和插件附带内容只读。未登记的其他工具可添加扫描目录／自定义目标。
- Manager 只卸载自己创建的副本。目标已有相同内容时可以登记关联，但外部目录仍保持只读，不取得卸载权限。
- 同名不同来源保留独立 ID。同名目录中存在其他内容或安装副本已被修改时停止覆盖，返回冲突；没有绕过检查的 force 选项。
- 替换和卸载保留旧副本。目标内临时目录保证跨磁盘目标也能进行原子重命名，完成后旧副本归档至 `backups`。中断操作在下一次写操作或 `doctor` 时恢复，冲突保留现场。
- SQLite WAL 与跨进程目录锁协调 CLI 和网页操作。锁心跳在异常退出后过期；目录繁忙会返回 `BUSY`。
- `backup` 是元数据备份，不包含原文件。恢复要求空的数据目录，恢复的安装记录只读；新目录里不存在的收藏包会报告缺失，需重新导入。使用 `export` 单独保存完整包。
- 下载只支持公开 GitHub HTTPS 仓库根地址，分支／目录用独立参数指定；其他网站的包可由 AI 下载后以本地文件导入。ZIP 拒绝目录穿越和符号链接，最多 20,000 个条目、解压后 512 MiB。
- 导入／安装不执行包内脚本。网页只允许本机同源会话，Markdown 不执行 HTML，不加载远程图片。

## 开发与验证

```powershell
pnpm typecheck
pnpm test       # 先构建，再执行隔离的核心、CLI、Git 与 HTTP 集成测试
pnpm cli ui --no-open  # 后端
pnpm dev       # 另一终端，前端开发服务将 /api 代理至 4317
```

`src/core` 提供共享业务核心；CLI 和 HTTP 服务均调用它。网页在 `web`，AI 配套 skill 在 `skills/skill-manager`。测试只使用临时数据目录和伪用户目录；Git 下载测试使用本地仓库，不访问网络。

首版为单人本地工具。没有常驻服务、自动升级、MCP、云同步或桌面安装包；只有下载需要联网。API 不用于远程托管。
