import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { exists } from './files.js';
import { ManagerError } from './types.js';

export const locationFile = (userHome = os.homedir()) => path.join(userHome, '.skill-manager', 'location.json');
export async function savedHome(userHome?: string) {
  const file = locationFile(userHome);
  if (!await exists(file)) return undefined;
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new ManagerError('INVALID_LOCATION', 'Manager 数据目录配置无效，请检查 location.json', { path: file }); }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('home' in value) || typeof value.home !== 'string' || !path.isAbsolute(value.home)) throw new ManagerError('INVALID_LOCATION', 'Manager 数据目录配置无效', { path: file });
  if (!await exists(path.join(value.home, 'manager.db'))) throw new ManagerError('LOCATION_MISSING', '已配置的 Manager 数据库不存在，请恢复目录或用 --home 指定正确位置', { path: value.home });
  return value.home;
}
export async function saveHome(home: string, userHome?: string) {
  const file = locationFile(userHome); const next = JSON.stringify({ version: 1, home }, null, 2) + '\n';
  if (await exists(file) && await fs.readFile(file, 'utf8') === next) return file;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, next, { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  return file;
}
