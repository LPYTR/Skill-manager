import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import yazl from 'yazl';
import { Manager } from '../src/core/manager.js';
import { exists, manifest, copyPackage, publishPackage } from '../src/core/files.js';
import { githubRepository, extractZip } from '../src/core/sources.js';
import type { Operation } from '../src/core/types.js';
import { setup, fixture } from './helpers.js';

test('scan keeps originals, searches Chinese body/tags, and relinks a moved source', async t => {
  const { manager, root } = await setup(t); const original = await fixture(path.join(root, '下载', '技能'));
  const before = await manifest(original); const report = await manager.scan({ root: path.dirname(original) });
  assert.equal(report.found, 1); const skill = manager.list()[0]; assert.equal(skill.kind, 'external');
  assert.equal(manager.list('文档').length, 1); assert.deepEqual(await manifest(original), before);
  await manager.update(skill.id, { tags: ['开发', '开发'], notes: '我的笔记', favorite: true });
  assert.equal(manager.list('我的笔记')[0].id, skill.id); assert.deepEqual(manager.show(skill.id).tags, ['开发']);
  const moved = path.join(root, '新位置'); await fs.rename(original, moved); await manager.scan();
  assert.equal(manager.show(skill.id).status, 'missing');
  await manager.relink(skill.id, moved); assert.equal(manager.show(skill.id).status, 'ready');
  await manager.scan(); assert.equal(manager.show(skill.id).status, 'ready');
  await manager.forget(skill.id); assert.equal(manager.list().length, 0); assert.equal(await exists(moved), true);
});
test('add saves the entire package, installs into Codex, and is idempotent', async t => {
  const { manager, root, userHome } = await setup(t); const source = await fixture(path.join(root, 'download'));
  const result = await manager.add(source); assert.equal(result.failures.length, 0); assert.equal(result.imported.length, 1);
  const { skill, revision } = result.imported[0]; assert.equal(skill.metadata['custom-key'], 'preserved');
  assert.equal(revision.hash, (await manifest(source)).hash); assert.deepEqual(await manifest(revision.path), await manifest(source));
  assert.equal(result.installations[0].path, path.join(userHome, '.agents', 'skills', 'example-skill')); assert.equal(result.installations[0].owned, true);
  const second = await manager.add(source); assert.equal(second.imported[0].reused, true); assert.equal(second.installations[0].id, result.installations[0].id);
  assert.equal(manager.show(skill.id).revisions.length, 1); assert.equal(manager.list().length, 1); assert.equal(await exists(path.join(source, 'executed')), false);
});
test('multi-skill repositories require selection, then preserve separate identities for same names', async t => {
  const { manager, root } = await setup(t); const collection = path.join(root, 'collection');
  await fixture(path.join(collection, 'one')); await fixture(path.join(collection, 'two'));
  await assert.rejects(manager.add(collection), { code: 'SELECTION_REQUIRED' }); assert.equal(manager.list().length, 0);
  const result = await manager.add(collection, { all: true, install: false }); assert.equal(result.imported.length, 2);
  assert.notEqual(result.imported[0].skill.id, result.imported[1].skill.id); assert.equal(manager.list().length, 2);
  const picked = await manager.add(collection, { subdir: 'one', install: false }); assert.equal(picked.imported[0].reused, true);
});
test('invalid metadata produces no usable package or staged leftovers', async t => {
  const { manager, root, home } = await setup(t); const source = await fixture(path.join(root, 'bad'));
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: [oops\n---\n# Broken');
  await assert.rejects(manager.add(source), { code: 'INVALID_SKILL' }); assert.equal(manager.list().length, 0); assert.deepEqual(await fs.readdir(path.join(home, 'staging')), []);
  await manager.scan({ root: source }); assert.equal(manager.list()[0].status, 'invalid');
});
test('different unknown destination yields a partial result without overwriting files', async t => {
  const { manager, root, userHome } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const destination = await fixture(path.join(userHome, '.agents', 'skills', 'example-skill'), 'example-skill', 'Existing data'); const before = await manifest(destination);
  const result = await manager.add(source); assert.equal(result.imported.length, 1); assert.equal(result.failures[0].code, 'CONFLICT');
  assert.deepEqual(await manifest(destination), before); assert.equal(manager.store.all('installations').length, 0);
});
test('identical external installation succeeds but never acquires uninstall ownership', async t => {
  const { manager, root, userHome } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const destination = path.join(userHome, '.agents', 'skills', 'example-skill'); await copyPackage(source, destination);
  const result = await manager.add(source); assert.equal(result.failures.length, 0); assert.equal(result.installations[0].owned, false);
  await assert.rejects(manager.uninstall(result.installations[0].id), { code: 'READ_ONLY' }); assert.equal(await exists(destination), true);
});
test('local installation edits block replacement and uninstall, retaining both versions', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const original = await manager.add(source); const installed = original.installations[0];
  await fs.appendFile(path.join(installed.path, 'SKILL.md'), '\nMy local edits'); const modified = await manifest(installed.path);
  await assert.rejects(manager.uninstall(installed.id), { code: 'LOCAL_MODIFICATIONS' });
  await fs.appendFile(path.join(source, 'SKILL.md'), '\nUpstream version two'); const updated = await manager.add(source);
  assert.equal(updated.failures[0].code, 'LOCAL_MODIFICATIONS'); assert.deepEqual(await manifest(installed.path), modified);
  const diagnosis = await manager.doctor(); assert.equal(diagnosis.installationIssues[0].status, 'modified');
  assert.equal(manager.show(original.imported[0].skill.id).revisions.length, 2);
});
test('updates and uninstall archive old copies and preserve library/source', async t => {
  const { manager, root, home } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const original = await manager.add(source); const oldHash = original.installations[0].manifest.hash;
  await fs.appendFile(path.join(source, 'SKILL.md'), '\nVersion two'); const updated = await manager.add(source);
  assert.equal(updated.failures.length, 0); assert.notEqual(updated.installations[0].manifest.hash, oldHash);
  const archive = manager.store.all('operations').find(o => o.kind === 'install' && o.before)!;
  assert.equal((await manifest(archive.backup)).hash, oldHash); assert.equal(path.dirname(archive.backup), path.join(home, 'backups'));
  await manager.uninstall(updated.installations[0].id); assert.equal(await exists(updated.installations[0].path), false);
  assert.equal(await exists(updated.imported[0].revision.path), true); assert.equal(await exists(source), true);
});
test('dry runs do not import, download, register targets, or change installation files', async t => {
  const { manager, root, userHome } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const preview = await manager.add(source, { dryRun: true }); assert.equal(preview.dryRun, true); assert.equal(manager.list().length, 0);
  assert.equal(await exists(path.join(userHome, '.agents')), false);
  await manager.addTarget({ name: 'Test', path: path.join(root, 'target') }, true); assert.equal(manager.targets().length, 2);
  await manager.scan({ root: source, dryRun: true }); assert.equal(manager.list().length, 0); assert.equal(manager.roots().some(r => r.path === source), false);
  const imported = await manager.add(source, { install: false }); await manager.install(imported.imported[0].skill.id, 'codex-user', { dryRun: true }); assert.equal(await exists(path.join(userHome, '.agents')), false);
});
test('two independent Manager instances serialize the same add operation', async t => {
  const { manager, root, home, userHome } = await setup(t); const second = await Manager.open({ home, userHome });
  try {
    const source = await fixture(path.join(root, 'incoming'));
    const [a,b] = await Promise.all([manager.add(source), second.add(source)]);
    assert.equal(a.imported[0].skill.id, b.imported[0].skill.id); assert.equal(a.installations[0].id, b.installations[0].id); assert.equal(manager.store.all('operations').length, 1);
  } finally { second.close(); }
});
test('interrupted replacement rolls back to the previous copy', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const added = await manager.add(source); const before = added.installations[0];
  await fs.appendFile(path.join(source, 'SKILL.md'), '\nNext'); const next = await manager.add(source, { install: false }); const revision = next.imported[0].revision;
  const id = randomUUID(); const parent = path.dirname(before.path); const stage = path.join(parent, `.skill-manager-stage-${id}`); const backup = path.join(parent, `.skill-manager-old-${id}`);
  await copyPackage(revision.path, stage); await fs.rename(before.path, backup); await fs.rename(stage, before.path);
  const op: Operation = { id, kind: 'install', phase: 'prepared', destination: before.path, stage, backup, before, after: { ...before, revisionId: revision.id, manifest: revision.manifest }, createdAt: new Date().toISOString() };
  manager.store.put('operations', op); await manager.doctor();
  assert.equal((await manifest(before.path)).hash, before.manifest.hash); assert.equal(manager.store.get('operations', id)?.phase, 'rolled-back');
});
test('recovery preserves files edited after an interrupted install', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'incoming')); const added = await manager.add(source); const before = added.installations[0];
  const id = randomUUID(); const backup = path.join(path.dirname(before.path), `.skill-manager-old-${id}`);
  await copyPackage(before.path, backup); await fs.appendFile(path.join(before.path, 'SKILL.md'), '\nUnsaved work'); const edited = await manifest(before.path);
  manager.store.put('operations', { id, kind: 'install', phase: 'prepared', destination: before.path, backup, before, after: before, createdAt: new Date().toISOString() });
  const diagnosis = await manager.doctor(); assert.equal(diagnosis.operations[0].phase, 'needs-attention'); assert.equal((await manifest(before.path)).hash, edited.hash); assert.equal(await exists(backup), true);
});
test('file previews reject traversal, cross-skill revisions, and binary resources', async t => {
  const { manager, root } = await setup(t); const first = await manager.add(await fixture(path.join(root, 'first')), { install: false }); const second = await manager.add(await fixture(path.join(root, 'second'), 'second'), { install: false });
  const id = first.imported[0].skill.id;
  assert.match((await manager.readFile(id, 'SKILL.md')).content, /使用说明/);
  await assert.rejects(manager.readFile(id, '../manager.db'), { code: 'INVALID_PATH' });
  await assert.rejects(manager.readFile(id, 'SKILL.md', second.imported[0].revision.id), { code: 'NOT_FOUND' });
  await assert.rejects(manager.readFile(id, 'assets/binary.bin'), { code: 'BINARY_FILE' });
});
test('complete ZIP exports re-import with identical package bytes', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'incoming')); const first = await manager.add(source, { install: false });
  const zip = path.join(root, 'export.zip'); await manager.export(first.imported[0].skill.id, zip);
  const imported = await manager.add(zip, { install: false }); assert.equal(imported.imported[0].revision.hash, first.imported[0].revision.hash);
  await assert.rejects(manager.export(first.imported[0].skill.id, zip), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
});
test('malicious ZIP entry cannot escape the extraction directory', async t => {
  const { root } = await setup(t); const zip = new yazl.ZipFile(); zip.addBuffer(Buffer.from('evil'), 'safe.txt'); const output = path.join(root, 'bad.zip'); const done = pipeline(zip.outputStream, createWriteStream(output)); zip.end(); await done;
  const bytes = await fs.readFile(output); let index = 0; while ((index = bytes.indexOf(Buffer.from('safe.txt'), index)) !== -1) { bytes.write('../x.txt', index, 'utf8'); index += 8; } await fs.writeFile(output, bytes);
  await assert.rejects(extractZip(output, path.join(root, 'extract'))); assert.equal(await exists(path.join(root, 'x.txt')), false);
});
test('metadata restore retains notes, reports absent managed files, and never claims installation ownership', async t => {
  const { manager, root, userHome } = await setup(t); const added = await manager.add(await fixture(path.join(root, 'incoming'))); const id = added.imported[0].skill.id;
  await manager.update(id, { tags: ['writing'], notes: 'my notes', favorite: true }); const backup = path.join(root, 'backup.json'); await manager.backup(backup);
  const restored = await Manager.open({ home: path.join(root, 'restored'), userHome });
  try {
    const report = await restored.restore(backup); assert.equal(report.missing, 1); assert.equal(restored.show(id).notes, 'my notes'); assert.equal(restored.show(id).status, 'missing'); assert.equal(restored.show(id).installations[0].owned, false);
    await assert.rejects(restored.uninstall(added.installations[0].id), { code: 'READ_ONLY' });
    await assert.rejects(restored.restore(backup), { code: 'RESTORE_NOT_EMPTY' });
  } finally { restored.close(); }
});
test('project presets and custom targets install under their configured directory', async t => {
  const { manager, root } = await setup(t); const target = await manager.addTarget({ name: 'Project', tool: 'claude', project: path.join(root, 'project'), id: 'project' });
  assert.equal(target.target.path, path.join(root, 'project', '.claude', 'skills'));
  const result = await manager.add(await fixture(path.join(root, 'incoming')), { target: 'project' }); assert.equal(result.failures.length, 0); assert.equal(path.dirname(result.installations[0].path), target.target.path);
  await assert.rejects(manager.addTarget({ name: 'Unsafe', path: manager.home }), { code: 'INVALID_TARGET' });
});
test('scanner follows directory links without duplicating their physical source', async t => {
  const { manager, root, userHome } = await setup(t); const source = await fixture(path.join(root, 'original'));
  const skills = path.join(userHome, '.agents', 'skills'); await fs.mkdir(skills, { recursive: true });
  await fs.symlink(source, path.join(skills, 'one'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.symlink(source, path.join(skills, 'two'), process.platform === 'win32' ? 'junction' : 'dir');
  await manager.scan(); assert.equal(manager.list().length, 1); assert.equal(manager.list()[0].kind, 'external');
});
test('public GitHub parser rejects credentials, other hosts, and ambiguous tree URLs', () => {
  assert.equal(githubRepository('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
  for (const source of ['https://evil.test/repo', 'https://token@github.com/owner/repo', 'https://github.com/owner/repo/tree/main/skill']) assert.throws(() => githubRepository(source), { code: 'INVALID_SOURCE' });
});

test('recovery never removes an external directory created before package publication', async t => {
  const { manager, root } = await setup(t); const source = await fixture(path.join(root, 'incoming'));
  const added = await manager.add(source, { install: false }); const revision = added.imported[0].revision; const target = manager.targets().find(t => t.id === 'codex-user')!;
  const id = randomUUID(); const stage = path.join(target.path, `.skill-manager-stage-${id}`); const destination = path.join(target.path, 'example-skill');
  await copyPackage(revision.path, stage); await copyPackage(revision.path, destination);
  manager.store.put('operations', { id, kind: 'install', phase: 'prepared', destination, stage, backup: path.join(target.path, `.skill-manager-old-${id}`), after: { id: randomUUID(), skillId: added.imported[0].skill.id, revisionId: revision.id, targetId: target.id, path: destination, manifest: revision.manifest, owned: true, status: 'active', installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, createdAt: new Date().toISOString() });
  const diagnosis = await manager.doctor(); assert.equal(diagnosis.operations[0].phase, 'needs-attention'); assert.equal(await exists(destination), true); assert.equal(await exists(stage), true);
});
test('invalid backup references fail atomically without restoring any skills', async t => {
  const { manager, root, userHome } = await setup(t); await manager.add(await fixture(path.join(root, 'incoming')));
  const file = path.join(root, 'metadata.json'); await manager.backup(file); const broken = JSON.parse(await fs.readFile(file, 'utf8')); broken.data.installations[0].targetId = 'unknown-target'; await fs.writeFile(file, JSON.stringify(broken));
  const restored = await Manager.open({ home: path.join(root, 'restored'), userHome });
  try { await assert.rejects(restored.restore(file), { code: 'INVALID_BACKUP' }); assert.equal(restored.list().length, 0); assert.equal(restored.store.all('installations').length, 0); } finally { restored.close(); }
});
test('Windows file locks cannot cause an uninstall to lose the original', { skip: process.platform !== 'win32' }, async t => {
  const { manager, root } = await setup(t); const added = await manager.add(await fixture(path.join(root, 'incoming'))); const installation = added.installations[0]; const file = path.join(installation.path, 'SKILL.md');
  const script = `$f = [System.IO.File]::Open('${file.replaceAll("'", "''")}', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None); try { [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }`;
  const holder = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(holder, 'close');
  try {
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('File lock holder timed out')), 10_000); holder.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); holder.once('error', error => { clearTimeout(timeout); reject(error); }); });
    await assert.rejects(manager.uninstall(installation.id)); assert.equal(await exists(installation.path), true); assert.equal(manager.show(installation.skillId).installations[0].status, 'active');
  } finally { holder.stdin.end('\n'); await closed; }
  assert.equal((await manifest(installation.path)).hash, installation.manifest.hash);
});
test('custom targets on a different drive retain rollback and uninstall backups', { skip: process.platform !== 'win32' }, async t => {
  const { manager, root } = await setup(t); const projectScratch = path.resolve('.test-data'); await fs.mkdir(projectScratch, { recursive: true }); const targetRoot = await fs.mkdtemp(path.join(projectScratch, 'cross-drive-'));
  try {
    await manager.addTarget({ name: 'Cross drive', id: 'cross-drive', path: targetRoot }); const source = await fixture(path.join(root, 'incoming'));
    const original = await manager.add(source, { target: 'cross-drive' }); assert.equal(original.failures.length, 0);
    await fs.appendFile(path.join(source, 'SKILL.md'), '\nUpdated'); const updated = await manager.add(source, { target: 'cross-drive' }); assert.equal(updated.failures.length, 0);
    const removed = await manager.uninstall(updated.installations[0].id); assert.equal(removed.removed, true); assert.equal(await exists(original.imported[0].revision.path), true);
    assert.ok(manager.store.all('operations').filter(o => o.before).every(o => o.backup.startsWith(path.join(manager.home, 'backups'))));
  } finally { assert.equal(path.dirname(targetRoot), projectScratch); await fs.rm(targetRoot, { recursive: true, force: true }); }
});
test('library publication falls back to a verified copy when Windows rejects a directory move', async t => {
  const { root } = await setup(t); const source = await fixture(path.join(root, 'staging-package')); const expected = await manifest(source); const destination = path.join(root, 'published');
  const crossDevice = async () => { throw Object.assign(new Error('cross-device move'), { code: 'EXDEV' }); };
  await publishPackage(source, destination, expected, crossDevice); assert.equal((await manifest(destination)).hash, expected.hash); assert.equal(await exists(source), true);
  await assert.rejects(publishPackage(source, destination, expected, crossDevice), (error: NodeJS.ErrnoException) => error.code === 'EEXIST');
});
