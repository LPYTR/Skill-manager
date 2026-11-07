import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TestContext } from 'node:test';
import { Manager } from '../src/core/manager.js';
import { within } from '../src/core/files.js';
export async function setup(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-manager-test-'));
  const home = path.join(root, 'manager'); const userHome = path.join(root, 'user');
  const manager = await Manager.open({ home, userHome });
  t.after(async () => { manager.close(); if (!within(os.tmpdir(), root) || !path.basename(root).startsWith('skill-manager-test-')) throw new Error('Unsafe test cleanup'); await fs.rm(root, { recursive: true, force: true }); });
  return { root, home: manager.home, userHome, manager };
}
export async function fixture(root: string, name = 'example-skill', content = '用于开发和文档整理。') {
  await fs.mkdir(path.join(root, 'assets', 'empty'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'SKILL.md'), `---\nname: ${name}\ndescription: A useful skill\ncustom-key: preserved\n---\n# 使用说明\n${content}\n`);
  await fs.writeFile(path.join(root, 'scripts', 'example.js'), "throw new Error('Import must never execute me');\n");
  await fs.writeFile(path.join(root, 'assets', 'binary.bin'), Buffer.from([0,1,2,255]));
  return root;
}
