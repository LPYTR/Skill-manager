import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.js';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function bareEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env, Path: path.join(systemRoot, 'System32'), SKILL_MANAGER_NODE: process.execPath };
  delete (env as NodeJS.ProcessEnv).PATH;
  delete (env as NodeJS.ProcessEnv).CODEX_MCP_NODE_PATH;
  return env;
}

test('Windows start.cmd works from src without global node or pnpm commands', { skip: process.platform !== 'win32' }, async () => {
  const result = await exec(path.join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', path.join(repo, 'start.cmd'), '-Check'], { cwd: path.join(repo, 'src'), env: bareEnvironment(), windowsHide: true });
  const status = JSON.parse(result.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.data.node, process.execPath);
  assert.equal(status.data.cli, path.join(repo, 'dist', 'cli.js'));
});

test('standalone startup serves the built UI in a terminal without pnpm', { skip: process.platform !== 'win32' }, async t => {
  const { root } = await setup(t);
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts', 'start.ps1'), '-NoOpen', '-Port', '0', '-DataDirectory', path.join(root, 'ui-data'), '-ToolUserDirectory', path.join(root, 'ui-user')], { cwd: path.join(repo, 'src'), env: bareEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let diagnostic = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { diagnostic += chunk; });
  try {
    const ready = await new Promise<{ ok: boolean; data: { url: string } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${diagnostic}`)), 15_000);
      let output = ''; child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        output += chunk;
        const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.endsWith('}'));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Startup exited (${code}): ${diagnostic}`)); });
    });
    assert.equal(ready.ok, true);
    const page = await fetch(ready.data.url); assert.equal(page.status, 200); assert.match(await page.text(), /Skill Manager/);
    const session = await fetch(`${ready.data.url}/api/session`); assert.equal((await session.json() as {ok:boolean}).ok, true);
  } finally {
    if (child.pid && child.exitCode === null) await exec(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    await closed;
  }
});
