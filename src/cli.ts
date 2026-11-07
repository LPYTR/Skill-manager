#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Manager } from './core/manager.js';
import { failure, ManagerError } from './core/types.js';
import type { Tool } from './core/types.js';
import { exists } from './core/files.js';
import { buildServer } from './server.js';
import { installInstructions, instructionFiles } from './instructions.js';
import { saveHome } from './core/location.js';

const program = new Command().name('skill-manager').description('AI 驱动的本机 Skill 管理中心').version('0.1.0')
  .option('--json', '输出机器可读 JSON').option('--dry-run', '预览操作，不改动 skill 文件或索引')
  .option('--home <directory>', '覆盖 Manager 数据目录').option('--user-home <directory>', '覆盖工具用户目录（用于隔离运行）');
program.exitOverride();
type Options = { json?: boolean; dryRun?: boolean; home?: string; userHome?: string } & Record<string, unknown>;
function options(command: Command): Options { return command.optsWithGlobals(); }
function print(data: unknown, json = false) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
async function run(command: Command, action: (manager: Manager, opts: Options) => Promise<unknown> | unknown) {
  const opts = options(command); const manager = await Manager.open({ home: opts.home, userHome: opts.userHome });
  try {
    const data = await action(manager, opts);
    if (data && typeof data === 'object' && 'failures' in data && Array.isArray(data.failures) && data.failures.length) {
      process.stdout.write(`${JSON.stringify({ ok: false, data, error: { code: 'PARTIAL_FAILURE', message: '已入库，部分安装失败', details: data.failures } }, null, opts.json ? undefined : 2)}\n`); process.exitCode = 1;
    } else print(data, opts.json);
  } finally { manager.close(); }
}
program.command('scan').description('盘点本机 skill，可登记额外扫描目录和项目').option('--root <directory>').option('--project <directory>').action((opts, command) => run(command, (m,o) => m.scan({ root: opts.root, project: opts.project, dryRun: o.dryRun })));
program.command('list').description('自动盘点并搜索 skill').option('-q, --query <text>').option('--filter <filter>', 'managed/external/system/plugin/installed/favorite/issues/archived').action((opts, command) => run(command, async (m,o) => { if (!o.dryRun) await m.refreshInventory(); return m.list(opts.query, opts.filter); }));
program.command('show <id>').description('自动盘点并查看完整记录').action((id, _opts, command) => run(command, async (m,o) => { if (!o.dryRun) await m.refreshInventory(); return m.show(id); }));
program.command('add <source>').description('入库，默认安装至 Codex 用户目录').option('--ref <ref>').option('--subdir <directory>').option('--all').option('--include-fixtures', '仅在明确需要测试数据时使用').option('--no-install').option('--target <id>').action((source, opts, command) => run(command, (m,o) => m.add(source, { ...opts, dryRun: o.dryRun })));
program.command('install <id>').description('安装已登记 skill').option('--target <id>', '目标 ID', 'codex-user').option('--revision <id>').action((id, opts, command) => run(command, (m,o) => m.install(id, opts.target, { revision: opts.revision, dryRun: o.dryRun })));
program.command('uninstall <installation-id>').description('卸载一处受管理的安装，保留收藏包和恢复备份').action((id, _opts, command) => run(command, (m,o) => m.uninstall(id, o.dryRun)));
program.command('edit <id>').description('修改标签、备注或收藏').option('--tags <comma-separated>').option('--notes <text>').option('--favorite').option('--no-favorite').action((id, opts, command) => run(command, (m,o) => m.update(id, { ...(opts.tags !== undefined ? { tags: opts.tags.split(',') } : {}), ...(opts.notes !== undefined ? { notes: opts.notes } : {}), ...(opts.favorite !== undefined ? { favorite: opts.favorite } : {}) }, o.dryRun)));
program.command('forget <id>').description('移除外部索引，保留原文件').action((id, _opts, command) => run(command, (m,o) => m.forget(id, o.dryRun)));
program.command('archive <id>').description('归档无安装的记录，保留文件、版本和个人备注').option('--reason <text>').action((id, opts, command) => run(command, (m,o) => m.archive(id, true, opts.reason, o.dryRun)));
program.command('unarchive <id>').description('恢复已归档记录').action((id, _opts, command) => run(command, (m,o) => m.archive(id, false, '', o.dryRun)));
program.command('relink <id> <directory>').description('重新关联移动后的外部 skill').action((id, dir, _opts, command) => run(command, (m,o) => m.relink(id, dir, o.dryRun)));
const targets = program.command('targets').description('管理安装目标');
targets.command('list').action((_opts, command) => run(command, m => m.targets()));
targets.command('add <name>').option('--id <id>').option('--tool <tool>', 'codex/claude/custom', 'custom').option('--path <directory>').option('--project <directory>').action((name, opts, command) => run(command, (m,o) => {
  if (!['codex', 'claude', 'custom'].includes(opts.tool)) throw new ManagerError('INVALID_TARGET', '--tool 需要 codex、claude 或 custom');
  return m.addTarget({ name, id: opts.id, tool: opts.tool as Tool, path: opts.path, project: opts.project }, o.dryRun);
}));
program.command('roots').description('查看扫描目录').action((_opts, command) => run(command, m => m.roots()));
program.command('doctor').description('检查文件状态并恢复中断操作').action((_opts, command) => run(command, (m,o) => m.doctor(o.dryRun)));
program.command('backup').requiredOption('--out <file>', '元数据 JSON 输出位置').action((opts, command) => run(command, (m,o) => m.backup(path.resolve(opts.out), o.dryRun)));
program.command('restore <file>').description('将元数据恢复到空的 Manager 数据目录').action((file, _opts, command) => run(command, (m,o) => m.restore(file, o.dryRun)));
program.command('export <id>').requiredOption('--out <file>', '完整文件包 ZIP 输出位置').action((id, opts, command) => run(command, (m,o) => m.export(id, opts.out, o.dryRun)));
program.command('bootstrap').description('安装固定入口、配套 skill 和持久安装规则').action((_opts, command) => run(command, async (manager, opts) => {
  const repo = fileURLToPath(new URL('../', import.meta.url)); const cli = path.join(repo, 'dist', 'cli.js');
  if (!await exists(cli)) throw new ManagerError('BUILD_REQUIRED', '请先运行 pnpm build');
  const launcher = path.join(manager.home, 'bin', process.platform === 'win32' ? 'skill-manager.ps1' : 'skill-manager');
  if (opts.dryRun) return { launcher, target: manager.targets().find(t => t.id === 'codex-user'), instructions: await instructionFiles(manager), dryRun: true };
  const extra = ['--home', manager.home, ...(opts.userHome ? ['--user-home', opts.userHome] : [])];
  const quoteSh = (v: string) => `'${v.replaceAll("'", "'\\''")}'`;
  const quotePs = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const signature = 'Skill Manager launcher';
  const content = process.platform === 'win32' ? `\uFEFF# ${signature}\r\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\r\n$skillManagerBaseArguments = @(${[cli, ...extra].map(quotePs).join(', ')})\r\n& ${quotePs(process.execPath)} @skillManagerBaseArguments @args\r\nexit $LASTEXITCODE\r\n` : `#!/bin/sh\n# ${signature}\nexec ${[process.execPath, cli, ...extra].map(quoteSh).join(' ')} "$@"\n`;
  await manager.write(async () => {
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    if (await exists(launcher) && !(await fs.readFile(launcher, 'utf8')).includes(signature)) throw new ManagerError('CONFLICT', '固定入口位置已存在其他文件');
    await fs.writeFile(launcher, content, { mode: 0o755 });
  });
  const source = path.join(manager.home, 'integrations', 'skill-manager');
  const invocation = process.platform === 'win32' ? `& powershell -NoProfile -ExecutionPolicy Bypass -File ${quotePs(launcher)}` : quoteSh(launcher);
  await manager.write(async () => {
    await fs.mkdir(source, { recursive: true });
    const template = await fs.readFile(path.join(repo, 'skills', 'skill-manager', 'SKILL.md'), 'utf8');
    await fs.writeFile(path.join(source, 'SKILL.md'), template.replaceAll('{{COMMAND}}', invocation));
    // Keep the bundled integration's identity when its data directory moves.
    if (!manager.store.all('sources').some(item => item.key === 'builtin:skill-manager')) {
      const legacy = manager.list().filter(item => item.kind === 'managed' && item.name === 'skill-manager' && item.source?.type === 'directory' && item.source.location.endsWith(path.join('integrations', 'skill-manager')) && item.body.includes('The skill authorizes no unrelated downloads'));
      const owned = legacy.filter(item => item.installations.some(installation => installation.owned && installation.status !== 'removed'));
      const existing = owned.length === 1 ? owned[0] : legacy.length === 1 ? legacy[0] : undefined;
      if (existing?.source) manager.store.put('sources', { ...existing.source, key: 'builtin:skill-manager' });
      else if (legacy.length > 1) throw new ManagerError('CONFLICT', '存在多份配套 skill 记录，需要先确认当前使用的那份');
    }
  });
  const added = await manager.add(source, { identity: 'builtin:skill-manager' });
  if (added.failures.length) throw new ManagerError('PARTIAL_FAILURE', '固定入口已创建，配套 skill 安装失败', { launcher, result: added });
  const instructions = await manager.write(() => installInstructions(manager, invocation));
  const location = await manager.write(() => saveHome(manager.home, manager.userHome));
  const inventory = await manager.scan();
  return { launcher, bridge: added.imported[0]?.skill.id, installations: added.installations, instructions, location, home: manager.home, found: inventory.found, note: '新建 Codex / Claude Code 会话以加载持久安装规则；如果移动本项目，请重新运行 setup:local' };
}));
program.command('ui').description('按需启动本地管理网页').option('--port <number>', '端口，0 表示自动选择', '4317').option('--no-open', '不自动打开浏览器').action(async (opts, command) => {
  const global = options(command); const port = Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ManagerError('INVALID_PORT', '端口需要为 0–65535');
  if (global.dryRun) { print({ host: '127.0.0.1', port, dryRun: true }, global.json); return; }
  const manager = await Manager.open({ home: global.home, userHome: global.userHome });
  try {
    const app = await buildServer(manager); const url = await app.listen({ host: '127.0.0.1', port });
    print({ url, home: manager.home }, global.json);
    if (opts.open) {
      const child = process.platform === 'win32' ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' }) : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.on('error', error => process.stderr.write(`无法打开浏览器：${error.message}\n`)); child.unref();
    }
    let stopping = false;
    const shutdown = async () => { if (stopping) return; stopping = true; await app.close(); manager.close(); };
    process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown());
  } catch (error) { manager.close(); throw error; }
});
try { await program.parseAsync(process.argv); }
catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const issue = error instanceof CommanderError ? { code: 'INVALID_ARGUMENTS', message: error.message } : failure(error);
    const json = process.argv.includes('--json'); (json ? process.stdout : process.stderr).write(`${JSON.stringify({ ok: false, error: issue }, null, json ? undefined : 2)}\n`); process.exitCode = 1;
  }
}
