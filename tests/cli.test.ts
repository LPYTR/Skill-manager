import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, fixture } from './helpers.js';
const exec = promisify(execFile); const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
async function command(home: string, userHome: string, args: string[], cwd: string) {
  try { const result = await exec(process.execPath, [cli, '--home', home, '--user-home', userHome, ...args, '--json'], { cwd, windowsHide: true }); return { code: 0, result: JSON.parse(result.stdout), stderr: result.stderr }; }
  catch (error) { const e = error as Error & { code: number; stdout: string; stderr: string }; return { code: e.code, result: JSON.parse(e.stdout), stderr: e.stderr }; }
}
test('compiled CLI works from another directory, exposes JSON and reports partial installs', async t => {
  const { root, home, userHome } = await setup(t); const source = await fixture(path.join(root, 'source'));
  const added = await command(home, userHome, ['add', source], root); assert.equal(added.code, 0); assert.equal(added.result.ok, true);
  const id = added.result.data.imported[0].skill.id; const installation = added.result.data.installations[0];
  const edited = await command(home, userHome, ['edit', id, '--tags', '开发,writing', '--notes', 'CLI notes'], root); assert.equal(edited.result.ok, true);
  const list = await command(home, userHome, ['list', '--query', 'CLI notes'], root); assert.equal(list.result.data.length, 1);
  const dry = await command(home, userHome, ['uninstall', installation.id, '--dry-run'], root); assert.equal(dry.result.data.dryRun, true);
  await fs.appendFile(path.join(installation.path, 'SKILL.md'), '\nLocal modifications');
  const partial = await command(home, userHome, ['add', source], root); assert.equal(partial.code, 1); assert.equal(partial.result.error.code, 'PARTIAL_FAILURE'); assert.equal(partial.result.data.imported[0].reused, true);
  const invalid = await command(home, userHome, ['install', 'not-a-real-id'], root); assert.equal(invalid.result.error.code, 'NOT_FOUND');
});
test('real parallel CLI processes share locks and create a single installation', async t => {
  const { root, home, userHome, manager } = await setup(t); const source = await fixture(path.join(root, 'source'));
  const [a,b] = await Promise.all([command(home, userHome, ['add', source], root), command(home, userHome, ['add', source], root)]);
  assert.equal(a.code, 0); assert.equal(b.code, 0); assert.equal(a.result.data.installations[0].id, b.result.data.installations[0].id); assert.equal(manager.list().length, 1);
});
test('bootstrap is idempotent and its generated bridge works from arbitrary cwd', async t => {
  const { root, home, userHome, manager } = await setup(t);
  const first = await command(home, userHome, ['bootstrap'], root); assert.equal(first.code, 0);
  const second = await command(home, userHome, ['bootstrap'], root); assert.equal(second.code, 0); assert.equal(first.result.data.bridge, second.result.data.bridge);
  assert.equal(first.result.data.instructions.length, 2); assert.ok(second.result.data.instructions.every((item: {changed:boolean}) => !item.changed));
  assert.match(await fs.readFile(path.join(userHome, '.codex', 'AGENTS.md'), 'utf8'), /EVERY agent-skill installation/);
  const savedSource = manager.store.get('sources', manager.show(first.result.data.bridge).sourceId)!;
  await manager.write(async () => { manager.store.put('sources', { ...savedSource, key: 'directory:legacy-integration-location#' }); });
  const migrated = await command(home, userHome, ['bootstrap'], root);
  assert.equal(migrated.code, 0); assert.equal(migrated.result.data.bridge, first.result.data.bridge);
  assert.equal(manager.show(first.result.data.bridge).source.key, 'builtin:skill-manager');
  const installed = path.join(userHome, '.agents', 'skills', 'skill-manager', 'SKILL.md'); const text = await fs.readFile(installed, 'utf8'); assert.equal(text.includes('{{COMMAND}}'), false); assert.ok(text.includes(first.result.data.launcher));
  assert.equal(manager.list().filter(s => s.name === 'skill-manager').length, 1);
  if (process.platform === 'win32') {
    const powershell = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', first.result.data.launcher, 'list', '--json'], { cwd: root, windowsHide: true }); assert.equal(JSON.parse(powershell.stdout).data[0].name, 'skill-manager');
  } else { const result = await exec(first.result.data.launcher, ['list', '--json'], { cwd: root }); assert.equal(JSON.parse(result.stdout).data[0].name, 'skill-manager'); }
});
test('CLI list discovers a skill installed outside Manager without a manual scan', async t => {
  const { root, home, userHome } = await setup(t);
  const installed = await fixture(path.join(userHome, '.agents', 'skills', 'external-install'), 'external-install');
  const dryRun = await command(home, userHome, ['list', '--dry-run'], root); assert.equal(dryRun.result.data.length, 0);
  const listed = await command(home, userHome, ['list'], root); assert.equal(listed.code, 0); assert.equal(listed.result.data.length, 1);
  assert.equal(listed.result.data[0].source.path, installed); assert.equal(listed.result.data[0].kind, 'external');
  const id = listed.result.data[0].id; await fs.appendFile(path.join(installed, 'SKILL.md'), '\nAdded after indexing');
  const shown = await command(home, userHome, ['show', id], root); assert.match(shown.result.data.body, /Added after indexing/);
  const again = await command(home, userHome, ['list'], root); assert.equal(again.result.data.length, 1); assert.equal(again.result.data[0].id, id);
});
test('PowerShell setup and generated launcher handle Chinese paths and shell metacharacters', { skip: process.platform !== 'win32' }, async t => {
  const { root } = await setup(t); const home = path.join(root, '初始化 数据'); const userHome = path.join(root, '工具 用户');
  const setupScript = fileURLToPath(new URL('../scripts/setup.ps1', import.meta.url));
  const result = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', setupScript, '-DataDirectory', home, '-ToolUserDirectory', userHome], { cwd: root, windowsHide: true });
  const installed = JSON.parse(result.stdout); assert.equal(installed.ok, true); assert.equal(installed.data.launcher, path.join(await fs.realpath(home), 'bin', 'skill-manager.ps1'));
  const source = await fixture(path.join(root, '研发&资料', '技能'), 'unicode-path');
  const added = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installed.data.launcher, 'add', source, '--json'], { cwd: root, windowsHide: true });
  const imported = JSON.parse(added.stdout); assert.equal(imported.ok, true); assert.equal(imported.data.imported[0].skill.name, 'unicode-path');
  assert.equal(imported.data.installations[0].path, path.join(userHome, '.agents', 'skills', 'unicode-path'));
});
