import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Manager } from '../src/core/manager.js';
import { locationFile, saveHome, savedHome } from '../src/core/location.js';
import { setup } from './helpers.js';

test('the saved physical data directory is reused across runtime contexts', async t => {
  const { manager, userHome, root } = await setup(t);
  await saveHome(manager.home, userHome);
  assert.equal(await savedHome(userHome), manager.home);
  const shared = await Manager.open({ userHome, localAppData: path.join(root, 'different-appdata') });
  try { assert.equal(shared.home, manager.home); } finally { shared.close(); }
  const explicit = await Manager.open({ home: path.join(root, 'explicit-home'), userHome });
  try { assert.notEqual(explicit.home, manager.home); } finally { explicit.close(); }
});

test('a missing configured database stops instead of creating a second empty catalog', async t => {
  const { userHome, root } = await setup(t);
  const file = locationFile(userHome); await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ version: 1, home: path.join(root, 'not-present') }));
  await assert.rejects(Manager.open({ userHome }), { code: 'LOCATION_MISSING' });
});

test('Manager private paths are rooted beside the physical database', async t => {
  const { manager } = await setup(t);
  assert.equal(manager.home, path.dirname(await fs.realpath(path.join(manager.home, 'manager.db'))));
});
test('fresh default storage stays in the shared user profile instead of redirected AppData', async t => {
  const { userHome } = await setup(t);
  const manager = await Manager.open({ userHome });
  try { assert.equal(manager.home, await fs.realpath(path.join(userHome, '.skill-manager', 'data'))); }
  finally { manager.close(); }
});
