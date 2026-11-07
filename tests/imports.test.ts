import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setup, fixture } from './helpers.js';
import { manifest } from '../src/core/files.js';
import { Manager } from '../src/core/manager.js';

test('repository discovery excludes fixtures and selects the target platform instead of importing every copy', async t => {
  const { manager, root } = await setup(t); const repo = path.join(root, 'repo');
  await fixture(path.join(repo, '.agents', 'skills', 'example'), 'example', 'Codex distribution');
  await fixture(path.join(repo, '.claude', 'skills', 'example'), 'example', 'Claude distribution');
  await fixture(path.join(repo, 'tests', 'oracle', '.claude', 'skills', 'audit'), 'audit', 'fixture');
  const result = await manager.add(repo);
  assert.equal(result.failures.length, 0); assert.equal(result.imported.length, 1); assert.equal(manager.list().length, 1);
  assert.match(result.imported[0].skill.body, /Codex distribution/); assert.equal(result.installations[0].status, 'active');
  assert.ok(result.skipped?.some(item => item.path === 'tests'));
  assert.ok(result.skipped?.some(item => item.path === '.claude/skills/example'));
});

test('explicit fixture subdirectories require an explicit test-data option', async t => {
  const { manager, root } = await setup(t); const repo = path.join(root, 'repo'); await fixture(path.join(repo, 'tests', 'fixture-skill'), 'fixture-skill');
  await assert.rejects(manager.add(repo, { subdir: 'tests/fixture-skill' }), { code: 'TEST_FIXTURE' });
  const allowed = await manager.add(repo, { subdir: 'tests/fixture-skill', includeFixtures: true, install: false }); assert.equal(allowed.imported.length, 1);
});

test('a working distribution is retained when another tool-specific copy appears later', async t => {
  const { manager, root } = await setup(t); const repo = path.join(root, 'repo');
  await fixture(path.join(repo, '.agent', 'skills', 'example'), 'example', 'Existing working distribution');
  const first = await manager.add(repo);
  await fixture(path.join(repo, '.agents', 'skills', 'example'), 'example', 'Alternate distribution');
  const second = await manager.add(repo, { all: true });
  assert.equal(second.imported.length, 1); assert.equal(second.imported[0].skill.id, first.imported[0].skill.id); assert.equal(second.failures.length, 0);
  assert.equal(second.installations[0].id, first.installations[0].id); assert.equal(manager.list().length, 1);
});

test('a package retains its own nested tests and resources', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'skill'));
  await fs.mkdir(path.join(source, 'tests')); await fs.writeFile(path.join(source, 'tests', 'resource.txt'), 'needed resource');
  const result = await manager.add(source, { install: false }); assert.ok(result.imported[0].revision.manifest.files.some(file => file.path === 'tests/resource.txt'));
});

test('archiving is reversible, preserves annotations and prevents accidental reinstall', async t => {
  const { manager, root, userHome } = await setup(t); const added = await manager.add(await fixture(path.join(root, 'skill')));
  const id = added.imported[0].skill.id; const before = await manifest(added.imported[0].revision.path);
  await manager.update(id, { notes: '保留我的备注', tags: ['personal'], favorite: true });
  await assert.rejects(manager.archive(id, true), { code: 'ACTIVE_INSTALLATION' });
  await manager.uninstall(added.installations[0].id); await manager.archive(id, true, '测试夹具');
  assert.equal(manager.list().length, 0); assert.equal(manager.list('', 'archived')[0].id, id); assert.equal(manager.show(id).notes, '保留我的备注');
  assert.deepEqual(await manifest(added.imported[0].revision.path), before);
  await assert.rejects(manager.install(id), { code: 'ARCHIVED_SKILL' });
  const backup = path.join(root, 'archive-backup.json'); await manager.backup(backup);
  const restored = await Manager.open({ home: path.join(root, 'restored'), userHome });
  try { await restored.restore(backup); assert.equal(restored.show(id).archived, true); assert.equal(restored.show(id).archiveReason, '测试夹具'); } finally { restored.close(); }
  await manager.archive(id, false); assert.equal(manager.list()[0].id, id); assert.deepEqual(manager.show(id).tags, ['personal']);
});

test('a conflict blocks that item while an independent batch item completes safely', async t => {
  const { manager, root, userHome } = await setup(t); const repo = path.join(root, 'repo');
  await fixture(path.join(repo, 'one'), 'first'); await fixture(path.join(repo, 'two'), 'second');
  const occupied = await fixture(path.join(userHome, '.agents', 'skills', 'first'), 'first', 'Other files'); const original = await manifest(occupied);
  const result = await manager.add(repo, { all: true });
  assert.equal(result.imported.length, 2); assert.equal(result.failures.length, 1); assert.equal(result.failures[0].code, 'CONFLICT');
  assert.equal(result.installations.length, 1); assert.equal(manager.show(result.installations[0].skillId).name, 'second'); assert.deepEqual(await manifest(occupied), original);
});
