import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Manager } from '../src/core/manager.js';
import { fetchGithub } from '../src/core/sources.js';
import { setup, fixture } from './helpers.js';
const exec = promisify(execFile);
test('GitHub import fetches a selected ref and subdirectory and records the resolved commit', async t => {
  const { root, userHome } = await setup(t); const repo = path.join(root, 'repository'); await fixture(path.join(repo, 'skills', 'demo'), 'git-demo');
  const run = async (args: string[], cwd?: string) => (await exec('git', ['-c', 'core.hooksPath=', ...args], { cwd, windowsHide: true })).stdout.trim();
  await run(['init', '--quiet', repo]); await run(['add', '.'], repo); await run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], repo); await run(['branch', '-M', 'main'], repo);
  const commit = await run(['rev-parse', 'HEAD'], repo); const calls: string[][] = [];
  const githubFetcher = (input: string, destination: string, ref?: string) => fetchGithub(input, destination, ref, async (args, cwd) => {
    calls.push(args);
    const replacement = args[0] === 'remote' ? ['remote', 'add', 'origin', pathToFileURL(repo).href] : args;
    return run(['-c', 'protocol.file.allow=always', ...replacement], cwd);
  });
  const manager = await Manager.open({ home: path.join(root, 'github-manager'), userHome, githubFetcher });
  try {
    const result = await manager.add('https://github.com/fixture/repository', { ref: 'main', subdir: 'skills/demo', install: false });
    assert.equal(result.imported[0].revision.commit, commit); assert.equal(result.imported[0].skill.name, 'git-demo');
    const source = manager.show(result.imported[0].skill.id).source; assert.equal(source.location, 'https://github.com/fixture/repository'); assert.equal(source.subdir, 'skills/demo');
    assert.ok(calls.some(args => args.includes('--depth=1') && args.includes('main')));
    assert.ok(calls.some(args => args.includes('checkout') && args.includes('--detach')));
  } finally { manager.close(); }
});
