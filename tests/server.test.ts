import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { manifest } from '../src/core/files.js';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/server.js';
import { setup, fixture } from './helpers.js';

test('HTTP requires a local host, same-origin requests and a session token', async t => {
  const { manager } = await setup(t); const app = await buildServer(manager);
  try {
    const invalidHost = await app.inject({ url: '/api/session', headers: { host: 'attacker.example' } }); assert.equal(invalidHost.statusCode, 403);
    const crossOrigin = await app.inject({ url: '/api/session', headers: { host: 'localhost', origin: 'https://attacker.example' } }); assert.equal(crossOrigin.statusCode, 403);
    const noToken = await app.inject({ url: '/api/skills', headers: { host: 'localhost' } }); assert.equal(noToken.json().error.code, 'SESSION_REQUIRED');
    const session = await app.inject({ url: '/api/session', headers: { host: 'localhost' } }); const token = session.json().data.token;
    assert.equal(token.length, 64); assert.equal(session.headers['access-control-allow-origin'], undefined);
    const response = await app.inject({ url: '/api/skills', headers: { host: 'localhost', 'x-skill-manager-token': token } }); assert.equal(response.statusCode, 200); assert.equal(response.json().ok, true);
  } finally { await app.close(); }
});
test('HTTP and CLI core share installation, metadata and traversal rules', async t => {
  const { manager, root } = await setup(t); const added = await manager.add(await fixture(path.join(root, 'incoming')), { install: false }); const id = added.imported[0].skill.id;
  const app = await buildServer(manager);
  try {
    const session = await app.inject({ url: '/api/session', headers: { host: 'localhost' } });
    const headers = { host: 'localhost', 'x-skill-manager-token': session.json().data.token, origin: 'http://localhost' };
    const install = await app.inject({ method: 'POST', url: '/api/install', headers, payload: { id } }); assert.equal(install.statusCode, 200); assert.equal(install.json().data.owned, true);
    const installationId = install.json().data.id; assert.equal(manager.show(id).installations[0].id, installationId);
    await app.inject({ method: 'PATCH', url: `/api/skills/${id}`, headers, payload: { notes: '来自网页的备注', tags: ['网页'], favorite: true } });
    assert.equal(manager.list('来自网页')[0].id, id);
    const badFields = await app.inject({ method: 'PATCH', url: `/api/skills/${id}`, headers, payload: { sourceId: 'bad' } }); assert.equal(badFields.json().error.code, 'INVALID_INPUT');
    const traversal = await app.inject({ url: `/api/skills/${id}/file?path=..%2Fmanager.db`, headers }); assert.equal(traversal.json().error.code, 'INVALID_PATH');
    const response = await app.inject({ method: 'DELETE', url: `/api/installations/${installationId}`, headers }); assert.equal(response.json().ok, true); assert.equal(manager.show(id).installations[0].status, 'removed');
  } finally { await app.close(); }
});
test('production UI serves its assets with CSP and API errors stay JSON', async t => {
  const { manager } = await setup(t); const app = await buildServer(manager, { webRoot: fileURLToPath(new URL('../dist/web', import.meta.url)) });
  try {
    const page = await app.inject({ url: '/', headers: { host: 'localhost' } }); assert.equal(page.statusCode, 200); assert.match(page.body, /Skill Manager/); assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    const asset = /src="([^"]+\.js)"/.exec(page.body)![1]; const javascript = await app.inject({ url: asset, headers: { host: 'localhost' } }); assert.equal(javascript.statusCode, 200); assert.match(String(javascript.headers['content-type']), /javascript/);
    const token = (await app.inject({ url: '/api/session', headers: { host: 'localhost' } })).json().data.token;
    const missing = await app.inject({ url: '/api/does-not-exist', headers: { host: 'localhost', 'x-skill-manager-token': token } }); assert.equal(missing.statusCode, 404); assert.equal(missing.json().ok, false);
  } finally { await app.close(); }
});
test('viewing inventory automatically registers outside installations and refreshes their content', async t => {
  const { manager, userHome } = await setup(t);
  const source = await fixture(path.join(userHome, '.claude', 'skills', 'outside-install'), 'outside-install');
  const before = await manifest(source); assert.equal(manager.list().length, 0);
  const app = await buildServer(manager);
  try {
    const token = (await app.inject({ url: '/api/session', headers: { host: 'localhost' } })).json().data.token;
    const headers = { host: 'localhost', 'x-skill-manager-token': token };
    const response = await app.inject({ url: '/api/skills', headers }); const skill = response.json().data[0];
    assert.equal(skill.name, 'outside-install'); assert.equal(skill.kind, 'external'); assert.deepEqual(await manifest(source), before);
    await fs.appendFile(path.join(source, 'SKILL.md'), '\nA later update');
    const detail = await app.inject({ url: `/api/skills/${skill.id}`, headers }); assert.match(detail.json().data.body, /A later update/);
    const concurrent = await Promise.all([app.inject({ url: '/api/skills', headers }), app.inject({ url: '/api/skills', headers })]);
    for (const read of concurrent) { assert.equal(read.statusCode, 200); assert.equal(read.json().data.length, 1); }
  } finally { await app.close(); }
});
