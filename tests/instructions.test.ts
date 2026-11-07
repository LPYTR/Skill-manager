import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { installInstructions, instructionFiles } from '../src/instructions.js';
import { setup } from './helpers.js';

test('global installation rules preserve user preferences, back up originals and update idempotently', async t => {
  const { manager, userHome } = await setup(t);
  const codex = path.join(userHome, '.codex', 'AGENTS.md');
  const original = '# Personal preferences\n\nPlease write concise Chinese.\n';
  await fs.mkdir(path.dirname(codex), { recursive: true }); await fs.writeFile(codex, original);
  const first = await manager.write(() => installInstructions(manager, 'manager-entry'));
  assert.equal(first.length, 2); assert.equal(first[0].changed, true);
  assert.equal(await fs.readFile(first[0].backup!, 'utf8'), original);
  const text = await fs.readFile(codex, 'utf8'); assert.ok(text.startsWith(original));
  assert.match(text, /EVERY agent-skill installation/); assert.match(text, /manager-entry list --json/);
  const again = await manager.write(() => installInstructions(manager, 'manager-entry'));
  assert.ok(again.every(item => !item.changed)); assert.equal(await fs.readFile(codex, 'utf8'), text);
  await manager.write(() => installInstructions(manager, 'updated-entry'));
  const updated = await fs.readFile(codex, 'utf8'); assert.ok(updated.startsWith(original));
  assert.equal(updated.includes('manager-entry list'), false); assert.match(updated, /updated-entry list --json/);
  assert.equal(updated.match(/## Required local skill installation workflow/g)?.length, 1);
});

test('active Codex override receives the rule while the base guidance stays intact', async t => {
  const { manager, userHome } = await setup(t); const directory = path.join(userHome, '.codex'); await fs.mkdir(directory, { recursive: true });
  const base = path.join(directory, 'AGENTS.md'); const override = path.join(directory, 'AGENTS.override.md');
  await fs.writeFile(base, 'Base instructions'); await fs.writeFile(override, 'Active override instructions');
  assert.equal((await instructionFiles(manager))[0].path, override);
  await manager.write(() => installInstructions(manager, 'entry'));
  assert.equal(await fs.readFile(base, 'utf8'), 'Base instructions'); assert.match(await fs.readFile(override, 'utf8'), /^Active override instructions/);
});

test('incomplete policy blocks stop setup rather than overwriting unrelated guidance', async t => {
  const { manager, userHome } = await setup(t); const directory = path.join(userHome, '.codex'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'AGENTS.md'); const original = 'Keep this text\n<!-- skill-manager:installation-policy:start -->\nIncomplete'; await fs.writeFile(file, original);
  await assert.rejects(manager.write(() => installInstructions(manager, 'entry')), { code: 'POLICY_UPDATE_FAILED' });
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
