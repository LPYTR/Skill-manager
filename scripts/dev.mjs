import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = new Set();
let shuttingDown = false;

function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    shuttingDown = true;
    for (const other of children) other.kill(signal || 'SIGTERM');
    process.exit(code ?? (signal ? 1 : 0));
  });
  children.add(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run(process.execPath, [tsxCli, path.join(root, 'src', 'cli.ts'), 'ui', '--no-open']);
run(process.execPath, [viteBin, '--host', '127.0.0.1', '--open']);
