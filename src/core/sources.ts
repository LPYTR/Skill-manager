import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { ManagerError } from './types.js';
import { canonical, manifest, safeChild, within } from './files.js';

export function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.hooksPath=', '-c', 'protocol.file.allow=never', ...args], {
      cwd, shell: false, windowsHide: true, timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_LFS_SKIP_SMUDGE: '1' },
    });
    let output = ''; let errors = '';
    child.stdout.on('data', chunk => { if (output.length < 1_000_000) output += chunk; });
    child.stderr.on('data', chunk => { if (errors.length < 16_000) errors += chunk; });
    child.on('error', error => reject(new ManagerError('DOWNLOAD_FAILED', error.message)));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new ManagerError('DOWNLOAD_FAILED', errors || `Git 退出码 ${code}`)));
  });
}
export function githubRepository(input: string) {
  let url: URL; try { url = new URL(input); } catch { throw new ManagerError('INVALID_SOURCE', '需要 GitHub HTTPS 仓库地址或本地路径'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) throw new ManagerError('INVALID_SOURCE', '联网导入仅接受公开 GitHub HTTPS 仓库地址');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || !parts.every(s => /^[\w.-]+$/.test(s))) throw new ManagerError('INVALID_SOURCE', '请使用仓库地址，通过 --ref 和 --subdir 指定分支及子目录');
  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
}
export async function fetchGithub(input: string, destination: string, ref?: string, run: typeof git = git) {
  const repository = githubRepository(input);
  if (ref && (ref.startsWith('-') || /[\s\0~^:?*\[\\]/.test(ref))) throw new ManagerError('INVALID_REF', '无效的 Git 引用');
  await fs.mkdir(destination, { recursive: true });
  await run(['init', '--quiet', destination]);
  await run(['remote', 'add', 'origin', `${repository}.git`], destination);
  await run(['fetch', '--quiet', '--depth=1', 'origin', ref || 'HEAD'], destination);
  await run(['-c', 'submodule.recurse=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], destination);
  return { repository, commit: await run(['rev-parse', 'HEAD'], destination) };
}
export async function extractZip(file: string, destination: string) {
  await fs.mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(new ManagerError('INVALID_ARCHIVE', error?.message || '无法打开 ZIP'));
      let total = 0; let count = 0; const seen = new Set<string>(); let done = false;
      const fail = (cause: unknown) => { if (!done) { done = true; zip.close(); reject(cause); } };
      zip.on('error', fail); zip.on('end', () => { if (!done) { done = true; resolve(); } });
      zip.on('entry', (entry: yauzl.Entry) => { void (async () => {
        const name = entry.fileName.replace(/\/$/, '');
        if (!name || name.split('/').some(part => !part || part === '.' || part === '..' || /[:\\\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new ManagerError('UNSAFE_ARCHIVE', 'ZIP 包含不安全路径', { path: entry.fileName });
        const key = name.toLowerCase(); if (seen.has(key)) throw new ManagerError('UNSAFE_ARCHIVE', 'ZIP 中有重复路径'); seen.add(key);
        if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) throw new ManagerError('UNSAFE_ARCHIVE', 'ZIP 不允许符号链接');
        if (++count > 20_000 || (total += entry.uncompressedSize) > 512 * 1024 * 1024) throw new ManagerError('ARCHIVE_TOO_LARGE', 'ZIP 超过 20,000 个文件或解压后超过 512 MiB');
        const output = await safeChild(destination, name);
        if (entry.fileName.endsWith('/')) await fs.mkdir(output, { recursive: true });
        else {
          await fs.mkdir(path.dirname(output), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (err, value) => err || !value ? rej(err) : res(value)));
          let written = 0;
          const limit = new Transform({ transform(chunk, _encoding, callback) { written += chunk.length; callback(written > entry.uncompressedSize ? new Error('ZIP 文件大小不匹配') : null, chunk); } });
          await pipeline(stream, limit, createWriteStream(output, { flags: 'wx' }));
          if (process.platform !== 'win32') await fs.chmod(output, (entry.externalFileAttributes >>> 16 & 0o777) || 0o644);
        }
        zip.readEntry();
      })().catch(fail); });
      zip.readEntry();
    });
  });
}
export async function writeZip(root: string, output: string, prefix: string) {
  const inventory = await manifest(root);
  if (within(await canonical(root), await canonical(output))) throw new ManagerError('INVALID_PATH', '导出文件不能写入 skill 包内');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const directory of inventory.directories) zip.addEmptyDirectory(`${prefix}/${directory}`);
  for (const entry of inventory.files) {
    const absolute = await safeChild(root, entry.path);
    zip.addFile(absolute, `${prefix}/${entry.path}`, { mode: (await fs.stat(absolute)).mode });
  }
  const completed = pipeline(zip.outputStream, createWriteStream(output, { flags: 'wx' })); zip.end(); await completed;
  return inventory;
}
