import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { exists } from './core/files.js';
import { failure } from './core/types.js';
import type { Manager } from './core/manager.js';

const dry = z.boolean().optional();
export async function buildServer(manager: Manager, options: { webRoot?: string } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const token = randomBytes(32).toString('hex');
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return reply.code(403).send({ ok: false, error: { code: 'INVALID_HOST', message: '仅允许本机访问' } });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) return reply.code(403).send({ ok: false, error: { code: 'INVALID_ORIGIN', message: '拒绝跨站请求' } });
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.url.startsWith('/api/') && request.url.split('?')[0] !== '/api/session' && request.headers['x-skill-manager-token'] !== token) return reply.code(403).send({ ok: false, error: { code: 'SESSION_REQUIRED', message: '请从 Manager 网页建立本机会话' } });
  });
  app.setErrorHandler((error, _request, reply) => {
    const issue = error instanceof z.ZodError ? { code: 'INVALID_INPUT', message: '输入格式不正确', details: error.issues } : failure(error);
    reply.code(issue.code === 'NOT_FOUND' ? 404 : issue.code === 'IO_ERROR' ? 500 : 400).send({ ok: false, error: issue });
  });
  const result = (data: unknown) => ({ ok: true, data });
  app.get('/api/session', async () => result({ token }));
  app.get('/api/skills', async request => {
    const query = z.object({ q: z.string().optional(), filter: z.string().optional() }).parse(request.query);
    const inventory = await manager.refreshInventory();
    return { ...result(manager.list(query.q, query.filter)), warnings: inventory.warnings };
  });
  app.get('/api/skills/:id', async request => { await manager.refreshInventory(); return result(manager.show(z.object({ id: z.string() }).parse(request.params).id)); });
  app.get('/api/skills/:id/file', async request => {
    const params = z.object({ id: z.string() }).parse(request.params); const query = z.object({ path: z.string(), revision: z.string().optional() }).parse(request.query);
    return result(await manager.readFile(params.id, query.path, query.revision));
  });
  app.patch('/api/skills/:id', async request => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ tags: z.array(z.string().max(100)).max(100).optional(), favorite: z.boolean().optional(), notes: z.string().max(100_000).optional(), dryRun: dry }).strict().parse(request.body);
    const { dryRun, ...input } = body; return result(await manager.update(id, input, dryRun));
  });
  app.delete('/api/skills/:id', async request => result(await manager.forget(z.object({ id: z.string() }).parse(request.params).id)));
  app.post('/api/skills/:id/archive', async request => { const { id } = z.object({id:z.string()}).parse(request.params); const body = z.object({ archived:z.boolean(), reason:z.string().optional(), dryRun:dry }).strict().parse(request.body); return result(await manager.archive(id,body.archived,body.reason,body.dryRun)); });
  app.post('/api/scan', async request => result(await manager.scan(z.object({ root: z.string().optional(), project: z.string().optional(), dryRun: dry }).strict().parse(request.body || {}))));
  app.post('/api/add', async request => {
    const { source, ...options } = z.object({ source: z.string().min(1), ref: z.string().optional(), subdir: z.string().optional(), all: z.boolean().optional(), includeFixtures:z.boolean().optional(), target: z.string().optional(), install: z.boolean().optional(), dryRun: dry }).strict().parse(request.body);
    const data = await manager.add(source, options);
    return data.failures.length ? { ok: false, data, error: { code: 'PARTIAL_FAILURE', message: '已入库，部分安装失败', details: data.failures } } : result(data);
  });
  app.post('/api/install', async request => {
    const body = z.object({ id: z.string(), target: z.string().optional(), revision: z.string().optional(), dryRun: dry }).strict().parse(request.body);
    return result(await manager.install(body.id, body.target, body));
  });
  app.delete('/api/installations/:id', async request => {
    const params = z.object({ id: z.string() }).parse(request.params); const query = z.object({ dryRun: z.enum(['true', 'false']).optional() }).parse(request.query);
    return result(await manager.uninstall(params.id, query.dryRun === 'true'));
  });
  app.get('/api/targets', async () => result(manager.targets()));
  app.post('/api/targets', async request => {
    const { dryRun, ...body } = z.object({ name: z.string().min(1), path: z.string().optional(), project: z.string().optional(), tool: z.enum(['codex', 'claude', 'custom']).optional(), id: z.string().optional(), dryRun: dry }).strict().parse(request.body);
    return result(await manager.addTarget(body, dryRun));
  });
  app.get('/api/roots', async () => result(manager.roots()));
  app.get('/api/activity', async () => result(manager.store.all('operations').sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)));
  app.get('/api/info', async () => {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
    const command = process.platform === 'win32' ? `& ${quote(process.execPath)} ${quote(cli)} --home ${quote(manager.home)}` : `${quote(process.execPath)} ${quote(cli)} --home ${quote(manager.home)}`;
    return result({ home: manager.home, version: '0.1.0', command, defaultTarget: 'codex-user', metadataBackupsIncludeFiles: false });
  });
  app.post('/api/doctor', async request => result(await manager.doctor(z.object({ dryRun: dry }).strict().parse(request.body || {}).dryRun)));
  app.post('/api/relink', async request => { const body = z.object({ id: z.string(), path: z.string(), dryRun: dry }).strict().parse(request.body); return result(await manager.relink(body.id, body.path, body.dryRun)); });
  app.post('/api/backup', async request => { const body = z.object({ output: z.string().min(1), dryRun: dry }).strict().parse(request.body); return result(await manager.backup(body.output, body.dryRun)); });
  app.post('/api/restore', async request => { const body = z.object({ input: z.string().min(1), dryRun: dry }).strict().parse(request.body); return result(await manager.restore(body.input, body.dryRun)); });
  app.post('/api/export', async request => { const body = z.object({ id: z.string(), output: z.string().min(1), dryRun: dry }).strict().parse(request.body); return result(await manager.export(body.id, body.output, body.dryRun)); });
  // Both compiled CLI and `tsx src/cli.ts ui` use the same built webpage.
  const compiledWeb = fileURLToPath(new URL('./web/', import.meta.url));
  const webRoot = options.webRoot || (await exists(path.join(compiledWeb, 'index.html')) ? compiledWeb : fileURLToPath(new URL('../dist/web/', import.meta.url)));
  if (await exists(path.join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }) : reply.sendFile('index.html'));
  } else app.get('/', async (_request, reply) => reply.type('text/plain; charset=utf-8').send('请先运行 pnpm build 构建网页。'));
  return app;
}
