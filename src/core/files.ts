import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import type { Manifest } from './types.js';
import { ManagerError } from './types.js';
import { fixtureDirectory } from './imports.js';

export const pathKey = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
export function within(root: string, candidate: string) { const relative = path.relative(pathKey(root), pathKey(candidate)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
export async function exists(p: string) { try { await fs.lstat(p); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
export async function canonical(p: string): Promise<string> {
  try { return await fs.realpath(p); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(path.resolve(p));
    if (parent === path.resolve(p)) return path.resolve(p);
    return path.join(await canonical(parent), path.basename(p));
  }
}
export async function safeChild(root: string, relative: string) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new ManagerError('INVALID_PATH', '需要包内相对路径');
  const resolved = path.resolve(root, relative);
  if (!within(root, resolved) || !within(await canonical(root), await canonical(resolved))) throw new ManagerError('INVALID_PATH', '路径超出允许目录');
  return resolved;
}
export async function discover(root: string, options: { excludeFixtures?: boolean } = {}) {
  const found: string[] = []; const issues: { path: string; message: string }[] = []; const excluded: string[] = []; const visited = new Set<string>();
  async function walk(dir: string) {
    try {
      const real = pathKey(await fs.realpath(dir)); if (visited.has(real)) return; visited.add(real);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (entries.some(e => e.name.toLowerCase() === 'skill.md' && !e.isDirectory())) { found.push(dir); return; }
      for (const e of entries) {
        if (['.git', 'node_modules'].includes(e.name) || e.name.startsWith('.skill-manager-stage-') || e.name.startsWith('.skill-manager-old-')) continue;
        if (options.excludeFixtures && fixtureDirectory(e.name) && (e.isDirectory() || e.isSymbolicLink())) { excluded.push(path.join(dir, e.name)); continue; }
        if (e.isDirectory() || (e.isSymbolicLink() && (await fs.stat(path.join(dir, e.name))).isDirectory())) await walk(path.join(dir, e.name));
      }
    } catch (error) { issues.push({ path: dir, message: (error as Error).message }); }
  }
  await walk(root); return { found, issues, excluded };
}
export async function manifest(root: string): Promise<Manifest> {
  const files: Manifest['files'] = []; const directories: string[] = []; const base = await fs.realpath(root);
  async function walk(dir: string, parents: Set<string>) {
    const real = await fs.realpath(dir);
    if (!within(base, real)) throw new ManagerError('UNSAFE_LINK', '包内链接指向了包外文件', { path: dir });
    if (parents.has(pathKey(real))) throw new ManagerError('UNSAFE_LINK', '包内存在循环目录链接', { path: dir });
    const next = new Set(parents).add(pathKey(real));
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name); const relative = path.relative(root, absolute).split(path.sep).join('/');
      const realFile = await fs.realpath(absolute);
      if (!within(base, realFile)) throw new ManagerError('UNSAFE_LINK', '包内链接指向了包外文件', { path: absolute });
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) { directories.push(relative); await walk(absolute, next); }
      else if (stat.isFile()) { const buffer = await fs.readFile(absolute); files.push({ path: relative, hash: createHash('sha256').update(buffer).digest('hex'), size: buffer.length }); }
      else throw new ManagerError('UNSUPPORTED_FILE', '包中包含非常规文件', { path: absolute });
    }
  }
  await walk(root, new Set()); files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); directories.sort();
  return { files, directories, hash: createHash('sha256').update(JSON.stringify({ files, directories })).digest('hex') };
}
export async function copyPackage(source: string, destination: string, expected?: Manifest) {
  const inventory = expected ?? await manifest(source); await fs.mkdir(destination, { recursive: true });
  for (const dir of inventory.directories) await fs.mkdir(await safeChild(destination, dir), { recursive: true });
  for (const entry of inventory.files) {
    const input = await safeChild(source, entry.path); const output = await safeChild(destination, entry.path);
    await fs.mkdir(path.dirname(output), { recursive: true });
    try { await fs.copyFile(input, output); }
    catch (error) {
      // Windows package redirection may reject CopyFile metadata operations while
      // permitting ordinary file reads/writes. The manifest below verifies all bytes.
      if (!['EPERM', 'EXDEV'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      await fs.writeFile(output, await fs.readFile(input));
    }
    if (process.platform !== 'win32') await fs.chmod(output, (await fs.stat(input)).mode);
  }
  if ((await manifest(destination)).hash !== inventory.hash) throw new ManagerError('SOURCE_CHANGED', '复制时源文件发生变化，请重新扫描后重试');
  return inventory;
}
export async function publishPackage(source: string, destination: string, expected: Manifest, rename: typeof fs.rename = fs.rename) {
  try { await rename(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    // Redirected/virtualized Windows folders can reject a move even on the same drive.
    // Reserve a new library directory; it becomes visible in the index only after verification.
    await fs.mkdir(destination);
    try { await copyPackage(source, destination, expected); }
    catch (cause) {
      const parent = await canonical(path.dirname(destination)); const actual = await canonical(destination);
      if (within(parent, actual) && pathKey(parent) !== pathKey(actual)) await fs.rm(destination, { recursive: true, force: true });
      throw cause;
    }
  }
}
export async function readPackage(root: string, tolerant = false) {
  const entry = (await fs.readdir(root)).find(name => name.toLowerCase() === 'skill.md');
  if (!entry) throw new ManagerError('INVALID_SKILL', '目录中缺少 SKILL.md');
  const text = await fs.readFile(await safeChild(root, entry), 'utf8'); const issues: string[] = [];
  let metadata: Record<string, unknown> = {}; let body = text;
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (front) {
    const document = parseDocument(front[1], { uniqueKeys: true });
    if (document.errors.length) issues.push(`YAML 解析失败：${document.errors[0].message}`);
    else { const parsed = document.toJS({ maxAliasCount: 25 }); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed; else issues.push('元数据必须是对象'); }
    body = text.slice(front[0].length);
  } else issues.push('缺少 YAML 元数据');
  if (typeof metadata.name !== 'string' || !metadata.name.trim()) issues.push('缺少 name');
  if (typeof metadata.description !== 'string' || !metadata.description.trim()) issues.push('缺少 description');
  if (!tolerant && issues.length) throw new ManagerError('INVALID_SKILL', 'Skill 格式不完整', { issues });
  return { name: typeof metadata.name === 'string' ? metadata.name : path.basename(root), description: typeof metadata.description === 'string' ? metadata.description : '', metadata, body, issues };
}
export function folderName(name: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.endsWith('.')) throw new ManagerError('INVALID_NAME', '安装目录名称需要为 1–64 个英文字母、数字、点、横线或下划线');
  return name;
}
