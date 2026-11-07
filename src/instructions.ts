import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists } from './core/files.js';
import type { Manager } from './core/manager.js';
import { ManagerError, failure } from './core/types.js';

const START = '<!-- skill-manager:installation-policy:start -->';
const END = '<!-- skill-manager:installation-policy:end -->';
export interface InstructionFile { tool: 'codex' | 'claude'; path: string }
export interface InstructionUpdate extends InstructionFile { changed: boolean; backup?: string }

export async function instructionFiles(manager: Manager): Promise<InstructionFile[]> {
  const codexHome = manager.options.codexHome || (manager.options.userHome ? path.join(manager.userHome, '.codex') : process.env.CODEX_HOME || path.join(manager.userHome, '.codex'));
  const claudeHome = manager.options.claudeHome || (manager.options.userHome ? path.join(manager.userHome, '.claude') : process.env.CLAUDE_CONFIG_DIR || path.join(manager.userHome, '.claude'));
  const override = path.join(codexHome, 'AGENTS.override.md');
  const activeOverride = await exists(override) && !!(await fs.readFile(override, 'utf8')).trim();
  return [{ tool: 'codex', path: activeOverride ? override : path.join(codexHome, 'AGENTS.md') }, { tool: 'claude', path: path.join(claudeHome, 'CLAUDE.md') }];
}

function installationPolicy(command: string) {
  return `${START}
## Required local skill installation workflow

The user requires EVERY agent-skill installation or update on this computer to be registered in Skill Manager. Apply this rule even when the user only says "install this skill" and does not mention Manager. It covers user-level and project-level skills; ordinary application dependencies are outside its scope.

Use this absolute CLI entry from PowerShell (the webpage does not need to be running):

\`\`\`powershell
${command} list --json
\`\`\`

- For a new GitHub, local-folder, or ZIP skill, use this CLI's \`add SOURCE --json\`. This saves the complete package and defaults to installing it for Codex at user scope. Use \`--target TARGET_ID\` for another tool or project, or \`--no-install\` only when the user requests collection without deployment.
- For an existing Manager package, use \`install SKILL_ID --target TARGET_ID --json\`. Look up IDs with \`list\` and \`targets list\`; do not infer identity from a name.
- Before installing into a new project or custom directory, register its target using \`targets add NAME --tool codex|claude --project ABSOLUTE_PROJECT_PATH --json\`, or \`targets add NAME --path ABSOLUTE_SKILLS_DIRECTORY --json\`.
- Do not bypass Manager by copying standalone skills directly into a tool's skill directory or by using another installer as the final step. Other tools may download a source first; pass the resulting folder or ZIP to Manager for installation.
- If a required third-party installer has already deployed a skill, import its actual installed package with \`add ABSOLUTE_INSTALLED_SKILL_DIRECTORY --no-install --json\`, then \`scan --root ABSOLUTE_INSTALLED_SKILL_DIRECTORY --json\`. Register project/custom roots before finishing. System and plugin bundles stay in place and are inventoried read-only using \`scan\`; cached plugins are not proof of enablement.
- Before reporting success, run \`show SKILL_ID --json\` and verify the source/revision is recorded and the expected installation path is present and active. For third-party installs, also verify the actual path appears as an indexed source or an installation. Report the Manager ID and installed path.
- If registration, download, or installation fails, STOP that failed item and report it. Do not bypass its failure or claim that item succeeded. Independent items may continue through Manager; a shared Manager outage blocks all items that depend on it. \`PARTIAL_FAILURE\` describes per-item failures, not a ban on diagnosing them or completing unrelated installations. Preserve existing content on conflicts or local modifications.
- Repository test fixtures are not production skills. Do not request \`--include-fixtures\` unless the user explicitly wants test data. Tool-specific copies of one skill are alternative distributions, not separate skills that all need installing. Read the returned \`skipped\` list and keep the working distribution for the selected target.
- Application add-ons such as Blender extensions are not agent skills. Install them with their application's supported mechanism; do not fabricate \`SKILL.md\` to place them in the agent-skill catalog.

This workflow applies within the user's authorized task; it does not authorize unrelated downloads, file removal, or executing scripts in imported packages.
${END}`;
}

export async function installInstructions(manager: Manager, command: string) {
  const updated: InstructionUpdate[] = [];
  for (const target of await instructionFiles(manager)) {
    let temp: string | undefined;
    try {
      const present = await exists(target.path);
      const original = present ? await fs.readFile(target.path, 'utf8') : '';
      const start = original.indexOf(START); const end = original.indexOf(END);
      if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) throw new ManagerError('POLICY_CONFLICT', '现有安装规则区块不完整，请保留文件并检查', { path: target.path });
      const policy = installationPolicy(command);
      const next = start >= 0 ? original.slice(0, start) + policy + original.slice(end + END.length) : original + (original && !original.endsWith('\n') ? '\n\n' : original ? '\n' : '') + policy + '\n';
      if (next === original) { updated.push({ ...target, changed: false }); continue; }
      let backup: string | undefined;
      if (present) {
        backup = path.join(manager.home, 'backups', 'instructions', `${randomUUID()}.md`);
        await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.copyFile(target.path, backup);
      }
      await fs.mkdir(path.dirname(target.path), { recursive: true });
      temp = `${target.path}.skill-manager-${randomUUID()}.tmp`;
      await fs.writeFile(temp, next, { flag: 'wx', mode: present ? (await fs.stat(target.path)).mode : 0o600 });
      try { await fs.rename(temp, target.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error; await fs.copyFile(temp, target.path); }
      updated.push({ ...target, changed: true, backup });
    } catch (error) { throw new ManagerError('POLICY_UPDATE_FAILED', '持久安装规则未全部写入，不能宣称初始化完成', { path: target.path, updated, cause: failure(error) }); }
    finally { if (temp) await fs.unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  }
  return updated;
}
