import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { Store, TABLES } from './db.js';
import { parseBackup } from './backup.js';
import { savedHome } from './location.js';
import { isFixturePath, selectVariants } from './imports.js';
import { canonical, copyPackage, discover, exists, folderName, manifest, pathKey, publishPackage, readPackage, safeChild, within } from './files.js';
import { extractZip, fetchGithub, githubRepository, writeZip } from './sources.js';
import { ManagerError, failure, now } from './types.js';
import type { AddOptions, AddResult, Installation, Kind, ManagerOptions, Operation, Revision, ScanRoot, Skill, Source, Target, Tool } from './types.js';

export class Manager {
  readonly store: Store;
  readonly home: string;
  readonly userHome: string;
  private inventoryRefresh?: ReturnType<Manager['scan']>;
  private constructor(home: string, readonly options: ManagerOptions, store?: Store) {
    this.home = home; this.userHome = options.userHome || os.homedir();
    this.store = store || new Store(path.join(home, 'manager.db'));
    const codexHome = options.codexHome || (options.userHome ? path.join(this.userHome, '.codex') : process.env.CODEX_HOME || path.join(this.userHome, '.codex'));
    const claudeHome = options.claudeHome || (options.userHome ? path.join(this.userHome, '.claude') : process.env.CLAUDE_CONFIG_DIR || path.join(this.userHome, '.claude'));
    const targets: Target[] = [
      { id: 'codex-user', name: 'Codex · 用户', tool: 'codex', scope: 'user', path: path.join(this.userHome, '.agents', 'skills') },
      { id: 'claude-user', name: 'Claude Code · 用户', tool: 'claude', scope: 'user', path: path.join(claudeHome, 'skills') },
    ];
    for (const target of targets) { this.store.seed('targets', target); this.store.seed('roots', { id: target.id, name: target.name, path: target.path, kind: 'external', targetId: target.id }); }
    for (const root of [
      { id: 'codex-legacy', name: 'Codex · 旧版目录及系统', path: path.join(codexHome, 'skills'), kind: 'external' as const },
      { id: 'codex-plugins', name: 'Codex · 插件缓存', path: path.join(codexHome, 'plugins', 'cache'), kind: 'plugin' as const },
      { id: 'claude-plugins', name: 'Claude Code · 插件缓存', path: path.join(claudeHome, 'plugins', 'cache'), kind: 'plugin' as const },
    ]) this.store.seed('roots', root);
  }
  static async open(options: ManagerOptions = {}) {
    // User-profile storage is shared with ordinary terminals; packaged Windows apps
    // may redirect AppData into a separate protected package directory.
    const fallback = options.localAppData ? path.join(options.localAppData, 'SkillManager') : path.join(options.userHome || os.homedir(), '.skill-manager', 'data');
    const home = path.resolve(options.home || process.env.SKILL_MANAGER_HOME || await savedHome(options.userHome) || fallback);
    await fs.mkdir(home, { recursive: true });
    let store = new Store(path.join(home, 'manager.db'));
    try {
      // MSIX can redirect individual AppData files while realpath(parent) stays unchanged.
      // Bind private paths to the actual database parent instead of relaxing path guards.
      const physicalHome = path.dirname(await fs.realpath(path.join(home, 'manager.db')));
      if (pathKey(physicalHome) !== pathKey(home)) { store.close(); store = new Store(path.join(physicalHome, 'manager.db')); }
      for (const directory of ['library', 'staging', 'backups']) await fs.mkdir(path.join(physicalHome, directory), { recursive: true });
      return new Manager(physicalHome, options, store);
    } catch (error) { store.close(); throw error; }
  }
  close() { this.store.close(); }
  async write<T>(action: () => Promise<T>): Promise<T> {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.home, { realpath: true, stale: 30_000, update: 5_000, retries: { retries: 40, minTimeout: 100, maxTimeout: 500 } });
      await this.recover(); return await action();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new ManagerError('BUSY', '另一个 Manager 操作尚未完成，请稍后重试');
      throw error;
    } finally { if (release) await release(); }
  }
  list(query = '', filter?: string) {
    const installations = this.store.all('installations').filter(i => i.status !== 'removed');
    const text = query.toLocaleLowerCase();
    return this.store.all('skills').filter(skill => {
      if (filter === 'archived' ? !skill.archived : skill.archived) return false;
      if (filter === 'favorite' && !skill.favorite) return false;
      if (filter === 'installed' && !installations.some(i => i.skillId === skill.id) && !['external', 'system'].includes(skill.kind)) return false;
      if (filter === 'issues' && skill.status === 'ready' && !skill.issues.length && !installations.some(i => i.skillId === skill.id && i.status !== 'active')) return false;
      if (['managed', 'external', 'system', 'plugin'].includes(filter || '') && skill.kind !== filter) return false;
      return !text || [skill.name, skill.description, skill.body, skill.notes, ...skill.tags].some(s => s.toLocaleLowerCase().includes(text));
    }).map(skill => ({ ...skill, installations: installations.filter(i => i.skillId === skill.id), source: this.store.get('sources', skill.sourceId) })).sort((a,b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'zh-CN'));
  }
  show(id: string) {
    const skill = this.requireSkill(id);
    return { ...skill, source: this.store.get('sources', skill.sourceId)!, revisions: this.store.all('revisions').filter(r => r.skillId === id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), installations: this.store.all('installations').filter(i => i.skillId === id), targets: this.targets() };
  }
  requireSkill(id: string) { const skill = this.store.get('skills', id); if (!skill) throw new ManagerError('NOT_FOUND', '找不到该 skill', { id }); return skill; }
  targets() { return this.store.all('targets'); }
  roots() { return this.store.all('roots'); }
  refreshInventory() {
    // Concurrent UI reads share a scan; subsequent reads inspect current filesystem state.
    this.inventoryRefresh ||= this.scan().finally(() => { this.inventoryRefresh = undefined; });
    return this.inventoryRefresh;
  }
  async addTarget(input: { name: string; path?: string; tool?: Tool; project?: string; id?: string }, dryRun = false) {
    if (!input.name.trim()) throw new ManagerError('INVALID_TARGET', '目标名称不能为空');
    const tool = input.tool || 'custom';
    if (!input.path && !input.project) throw new ManagerError('INVALID_TARGET', '需要 --path 或 --project');
    if (input.path && input.project) throw new ManagerError('INVALID_TARGET', '--path 与 --project 不能同时指定');
    if (input.project && tool === 'custom') throw new ManagerError('INVALID_TARGET', '项目预设需要指定 codex 或 claude');
    const target: Target = { id: input.id || randomUUID(), name: input.name, tool, scope: input.project ? 'project' : 'custom', path: path.resolve(input.path || path.join(input.project!, tool === 'codex' ? '.agents' : '.claude', 'skills')) };
    if (!/^[a-zA-Z0-9_-]+$/.test(target.id)) throw new ManagerError('INVALID_TARGET', '目标 ID 只能包含字母、数字、横线和下划线');
    await this.checkTarget(target);
    const action = async () => {
      if (this.store.get('targets', target.id)) throw new ManagerError('CONFLICT', '目标 ID 已存在');
      for (const existing of this.targets()) if (pathKey(await canonical(existing.path)) === pathKey(await canonical(target.path))) throw new ManagerError('CONFLICT', '该目录已登记', existing);
      if (!dryRun) this.store.transaction(() => { this.store.put('targets', target); this.store.put('roots', { id: target.id, name: target.name, path: target.path, targetId: target.id, kind: 'external' }); });
      return { target, dryRun };
    };
    return dryRun ? action() : this.write(action);
  }
  async scan(options: { root?: string; project?: string; dryRun?: boolean } = {}) {
    const run = async () => {
      const roots = this.roots();
      if (options.root) roots.push({ id: `custom-${Buffer.from(pathKey(options.root)).toString('base64url')}`, name: path.basename(options.root), path: path.resolve(options.root), kind: 'external' });
      if (options.project) for (const tool of ['codex', 'claude'] as const) {
        const root: ScanRoot = { id: `${tool}-project-${Buffer.from(pathKey(options.project)).toString('base64url')}`, name: `${tool} · ${path.basename(options.project)}`, path: path.join(path.resolve(options.project), tool === 'codex' ? '.agents' : '.claude', 'skills'), kind: 'external' };
        roots.push(root);
        if (!options.dryRun) this.store.seed('targets', { id: root.id, name: root.name, path: root.path, tool, scope: 'project' });
        root.targetId = root.id;
      }
      const results: { path: string; id?: string; name?: string; status: string }[] = []; const warnings: { path: string; message: string }[] = [];
      const seen = new Set<string>(); const indexed = new Set<string>();
      for (const root of roots) {
        if (!options.dryRun) this.store.seed('roots', root);
        if (!await exists(root.path)) { if (options.root && pathKey(root.path) === pathKey(options.root)) warnings.push({ path: root.path, message: '指定的扫描目录不存在' }); continue; }
        const discovery = await discover(root.path); warnings.push(...discovery.issues);
        for (const directory of discovery.found) {
          const real = await canonical(directory); const key = `discovery:${pathKey(real)}`;
          if (seen.has(key)) continue; seen.add(key);
          const installed = this.store.all('installations').find(i => pathKey(i.path) === pathKey(directory) && i.status !== 'removed');
          if (installed) { results.push({ path: directory, id: installed.skillId, status: 'installation' }); continue; }
          try {
            const info = await readPackage(directory, true); let inventory;
            try { inventory = await manifest(directory); } catch (error) { info.issues.push(failure(error).message); inventory = { files: [], directories: [], hash: '' }; }
            let source = this.store.all('sources').find(s => s.key === key);
            const existing = source && this.store.get('skills', source.skillId);
            const id = existing?.id || randomUUID(); const sourceId = source?.id || randomUUID();
            const kind: Kind = directory.split(path.sep).includes('.system') ? 'system' : root.kind;
            let revision = this.store.all('revisions').find(r => r.skillId === id && r.hash === inventory.hash);
            revision = { ...revision, id: revision?.id || randomUUID(), skillId: id, hash: inventory.hash, path: directory, manifest: inventory, available: !!inventory.hash, createdAt: revision?.createdAt || now() };
            const skill: Skill = { ...existing, id, sourceId, name: info.name, description: info.description, body: info.body, metadata: info.metadata, issues: info.issues, tags: existing?.tags || [], favorite: existing?.favorite || false, notes: existing?.notes || '', kind, status: info.issues.length ? 'invalid' : kind === 'plugin' ? 'unverified' : 'ready', currentRevisionId: revision.id, createdAt: existing?.createdAt || now(), updatedAt: now() };
            source = { id: sourceId, skillId: id, key, type: 'discovery', location: directory, path: directory, rootId: root.id, managed: false };
            indexed.add(source.id);
            if (!options.dryRun) this.store.transaction(() => {
              for (const old of this.store.all('revisions').filter(r => r.skillId === id && r.id !== revision.id)) this.store.put('revisions', { ...old, available: false });
              this.store.put('sources', source!); this.store.put('revisions', revision); this.store.put('skills', skill);
            });
            results.push({ path: directory, id, name: skill.name, status: skill.status });
          } catch (error) { warnings.push({ path: directory, message: failure(error).message }); }
        }
      }
      if (!options.dryRun) {
        for (const source of this.store.all('sources').filter(s => !s.managed && !indexed.has(s.id))) {
          const skill = this.requireSkill(source.skillId);
          try {
            const present = await exists(source.path); const status = present ? 'unreadable' : 'missing';
            this.store.put('skills', { ...skill, status, issues: [present ? '无法读取或识别源目录，请重新扫描或关联位置' : '源目录已丢失，可重新关联'], updatedAt: now() });
          } catch (error) { this.store.put('skills', { ...skill, status: 'unreadable', issues: [failure(error).message], updatedAt: now() }); }
        }
        await this.inspectInstallations(true);
      }
      return { found: results.length, skills: results, warnings, dryRun: !!options.dryRun };
    };
    return options.dryRun ? run() : this.write(run);
  }
  async update(id: string, input: { tags?: string[]; favorite?: boolean; notes?: string }, dryRun = false) {
    const action = async () => {
      const skill = this.requireSkill(id); const updated = { ...skill, ...input, tags: input.tags ? [...new Set(input.tags.map(t => t.trim()).filter(Boolean))] : skill.tags, updatedAt: now() };
      if (!dryRun) this.store.put('skills', updated); return updated;
    }; return dryRun ? action() : this.write(action);
  }
  async archive(id: string, archived = true, reason = '', dryRun = false) {
    const action = async () => {
      const skill = this.requireSkill(id);
      if (archived && this.store.all('installations').some(item => item.skillId === id && item.status !== 'removed')) throw new ManagerError('ACTIVE_INSTALLATION', '请先通过 Manager 卸载对应安装，再归档记录；归档不会删除原文件或个人备注');
      const result = { ...skill, archived, archiveReason: archived ? reason.trim() || '手动归档' : undefined, updatedAt: now() };
      if (!dryRun) this.store.put('skills', result);
      return result;
    }; return dryRun ? action() : this.write(action);
  }
  async forget(id: string, dryRun = false) {
    const action = async () => {
      const skill = this.requireSkill(id);
      if (skill.kind === 'managed') throw new ManagerError('MANAGED_SKILL', '受管理的收藏不能通过移除外部索引删除');
      if (this.store.all('installations').some(i => i.skillId === id && i.status !== 'removed')) throw new ManagerError('CONFLICT', '该 skill 仍有关联安装');
      if (!dryRun) this.store.transaction(() => { this.store.delete('skills', id); this.store.delete('sources', skill.sourceId); for (const r of this.store.all('revisions').filter(r => r.skillId === id)) this.store.delete('revisions', r.id); });
      return { id, removedIndex: !dryRun, originalFilesPreserved: true, dryRun };
    }; return dryRun ? action() : this.write(action);
  }
  async relink(id: string, directory: string, dryRun = false) {
    const action = async () => {
      const skill = this.requireSkill(id); const source = this.store.get('sources', skill.sourceId)!;
      if (skill.kind !== 'external') throw new ManagerError('READ_ONLY', '只有外部 skill 可以重新关联源目录');
      const real = await canonical(directory); const key = `discovery:${pathKey(real)}`;
      if (this.store.all('sources').some(s => s.id !== source.id && s.key === key)) throw new ManagerError('CONFLICT', '新路径已关联其他记录');
      const info = await readPackage(real, true); const inventory = await manifest(real);
      const revision: Revision = { id: randomUUID(), skillId: id, path: real, manifest: inventory, hash: inventory.hash, available: true, createdAt: now() };
      const updated = { ...skill, ...info, currentRevisionId: revision.id, status: info.issues.length ? 'invalid' as const : 'ready' as const, updatedAt: now() };
      if (!dryRun) this.store.transaction(() => {
        for (const old of this.store.all('revisions').filter(r => r.skillId === id)) this.store.put('revisions', { ...old, available: false });
        this.store.put('sources', { ...source, path: real, location: real, key }); this.store.put('revisions', revision); this.store.put('skills', updated);
        this.store.seed('roots', { id: `relink-${id}`, name: info.name, path: real, kind: 'external' });
      });
      return { skill: updated, dryRun };
    }; return dryRun ? action() : this.write(action);
  }
  async add(input: string, options: AddOptions = {}): Promise<AddResult> {
    if (options.subdir && isFixturePath(options.subdir) && !options.includeFixtures) throw new ManagerError('TEST_FIXTURE', '所选路径位于测试夹具目录，默认不作为正式 skill 安装', { path: options.subdir });
    if (options.dryRun) {
      const isRemote = /^https?:/i.test(input); if (isRemote) githubRepository(input);
      const target = this.store.get('targets', options.target || 'codex-user');
      if (!target && options.install !== false) throw new ManagerError('NOT_FOUND', '安装目标不存在');
      return { imported: [], installations: [], failures: [], dryRun: true, plan: { source: input, ref: options.ref, subdir: options.subdir, install: options.install !== false, target, downloadsPerformed: false } };
    }
    return this.write(async () => {
      const staging = path.join(this.home, 'staging', randomUUID()); await fs.mkdir(staging);
      try {
        let directory: string; let location: string; let commit: string | undefined; let type: Source['type'];
        if (/^https?:/i.test(input)) {
          directory = path.join(staging, 'checkout'); const fetched = await (this.options.githubFetcher || fetchGithub)(input, directory, options.ref);
          location = fetched.repository; commit = fetched.commit; type = 'github';
        } else {
          location = await canonical(path.resolve(input)); const stat = await fs.stat(location);
          if (stat.isDirectory()) { directory = location; type = 'directory'; }
          else if (path.extname(location).toLowerCase() === '.zip') { directory = path.join(staging, 'extracted'); type = 'zip'; await extractZip(location, directory); }
          else throw new ManagerError('INVALID_SOURCE', '仅支持文件夹、ZIP 或 GitHub 仓库');
        }
        const sourceBase = directory;
        if (options.subdir) directory = await safeChild(directory, options.subdir);
        const discovery = await discover(directory, { excludeFixtures: !options.includeFixtures });
        if (discovery.issues.length) throw new ManagerError('SOURCE_UNREADABLE', '部分来源目录不可读取', discovery.issues);
        if (!discovery.found.length) throw new ManagerError('NO_SKILLS', '来源中未发现正式 SKILL.md；测试目录默认被排除', { excluded: discovery.excluded });
        const prepared = await Promise.all(discovery.found.map(async directory => ({ directory, relative: path.relative(sourceBase, directory).split(path.sep).join('/'), info: await readPackage(directory), inventory: await manifest(directory) })));
        const target = this.store.get('targets', options.target || 'codex-user');
        const active = new Map<string,string>();
        for (const item of this.list().filter(item => item.kind === 'managed' && item.source?.type === type && item.source.location === location && item.installations.some(installation => installation.targetId === (options.target || 'codex-user') && installation.status === 'active'))) active.set(item.name.toLowerCase(), item.source!.subdir || '');
        const selection = selectVariants(prepared, target?.tool || 'custom', active);
        if (selection.selected.length > 1 && !options.all) throw new ManagerError('SELECTION_REQUIRED', '来源包含多个独立 skill，请指定 --subdir 或使用 --all', { candidates: selection.selected.map(item => item.relative), skipped: selection.skipped });
        const result: AddResult = { imported: [], installations: [], failures: [], skipped: [...discovery.excluded.map(p => ({ path: path.relative(sourceBase, p).split(path.sep).join('/'), reason: '测试或夹具目录，默认排除' })), ...selection.skipped] };
        for (const item of selection.selected) {
          const relative = path.relative(sourceBase, item.directory).split(path.sep).join('/');
          const key = options.identity || `${type}:${type === 'github' ? location : pathKey(location)}#${relative}`;
          const oldSource = this.store.all('sources').find(s => s.key === key); const oldSkill = oldSource && this.store.get('skills', oldSource.skillId);
          const id = oldSkill?.id || randomUUID(); const sourceId = oldSource?.id || randomUUID();
          const oldRevision = this.store.all('revisions').find(r => r.skillId === id && r.hash === item.inventory.hash);
          const final = path.join(this.home, 'library', id, item.inventory.hash);
          const revision: Revision = { id: oldRevision?.id || randomUUID(), skillId: id, path: final, manifest: item.inventory, hash: item.inventory.hash, available: true, commit: oldRevision?.commit || commit, createdAt: oldRevision?.createdAt || now() };
          if (!await exists(final)) {
            const packageStage = path.join(staging, `package-${id}`); await copyPackage(item.directory, packageStage, item.inventory);
            await fs.mkdir(path.dirname(final), { recursive: true }); await publishPackage(packageStage, final, item.inventory);
          } else if ((await manifest(final)).hash !== revision.hash) throw new ManagerError('LIBRARY_MODIFIED', '收藏库文件已被修改，请先检查并备份', { path: final });
          const skill: Skill = { id, sourceId, name: item.info.name, description: item.info.description, body: item.info.body, metadata: item.info.metadata, tags: oldSkill?.tags || [], favorite: oldSkill?.favorite || false, notes: oldSkill?.notes || '', archived: oldSkill?.archived, archiveReason: oldSkill?.archiveReason, kind: 'managed', status: 'ready', issues: [], currentRevisionId: revision.id, createdAt: oldSkill?.createdAt || now(), updatedAt: now() };
          const source: Source = { id: sourceId, skillId: id, key, type, location, subdir: relative || undefined, ref: options.ref, commit, path: final, managed: true };
          this.store.transaction(() => { this.store.put('skills', skill); this.store.put('sources', source); this.store.put('revisions', revision); });
          result.imported.push({ skill, revision, reused: !!oldRevision });
          if (options.install !== false) {
            try { result.installations.push(await this.installInternal(id, options.target || 'codex-user')); }
            catch (error) { const issue = failure(error); result.failures.push({ skillId: id, code: issue.code, message: issue.message }); }
          }
        }
        return result;
      } finally { await this.removePrivate(path.join(this.home, 'staging'), staging); }
    });
  }
  private async checkTarget(target: Target) {
    const real = await canonical(target.path); const home = await canonical(this.home);
    if (within(real, home) || within(home, real)) throw new ManagerError('INVALID_TARGET', '安装目标不能与 Manager 数据目录重叠');
    if (path.parse(real).root === real || pathKey(real) === pathKey(await canonical(this.userHome))) throw new ManagerError('INVALID_TARGET', '不能把磁盘根目录或用户主目录设为安装目标');
  }
  private async installPlan(id: string, targetId: string, revisionId?: string) {
    const skill = this.requireSkill(id);
    if (skill.archived) throw new ManagerError('ARCHIVED_SKILL', '该记录已归档，请先确认来源并通过 unarchive 恢复后再安装', { reason: skill.archiveReason });
    if (['system', 'plugin'].includes(skill.kind)) throw new ManagerError('READ_ONLY', '系统和插件附带的 skill 仅供查看');
    const target = this.store.get('targets', targetId); if (!target) throw new ManagerError('NOT_FOUND', '安装目标不存在');
    await this.checkTarget(target);
    const revision = this.store.get('revisions', revisionId || skill.currentRevisionId);
    if (!revision || revision.skillId !== id || !revision.available || !await exists(revision.path)) throw new ManagerError('REVISION_UNAVAILABLE', '该版本的完整文件不可用，请重新导入或关联来源');
    if ((await manifest(revision.path)).hash !== revision.hash) throw new ManagerError('SOURCE_CHANGED', '源文件与索引不一致，请先重新扫描');
    const info = await readPackage(revision.path); const name = folderName(info.name);
    const destination = path.join(target.path, name); const realSource = await canonical(revision.path); const realDestination = await canonical(destination);
    if (within(realSource, realDestination) || within(realDestination, realSource)) throw new ManagerError('INVALID_TARGET', '源目录和安装目录不能重叠');
    const pending = this.store.all('operations').find(o => o.phase === 'needs-attention' && pathKey(o.destination) === pathKey(destination));
    if (pending) throw new ManagerError('RECOVERY_REQUIRED', '该目录有需要处理的未完成操作，请运行 doctor', pending);
    const before = this.store.all('installations').find(i => pathKey(i.path) === pathKey(destination) && i.status !== 'removed');
    const present = await exists(destination); let same = false;
    if (present) {
      if ((await fs.lstat(destination)).isSymbolicLink()) throw new ManagerError('CONFLICT', '目标是现有链接，不能覆盖', { path: destination });
      const actual = await manifest(destination); same = actual.hash === revision.hash;
      if (before && actual.hash !== before.manifest.hash) throw new ManagerError('LOCAL_MODIFICATIONS', '安装副本被手动修改，已保留原文件', { path: destination });
      if (!same && (!before || !before.owned || before.skillId !== id)) throw new ManagerError('CONFLICT', '目标目录已有其他内容，已保留原文件', { path: destination });
    }
    return { skill, target, revision, destination, before, same, present };
  }
  async install(id: string, target = 'codex-user', options: { revision?: string; dryRun?: boolean } = {}) {
    if (options.dryRun) { const plan = await this.installPlan(id, target, options.revision); return { dryRun: true, path: plan.destination, revision: plan.revision.id, same: plan.same }; }
    return this.write(() => this.installInternal(id, target, options.revision));
  }
  private async installInternal(id: string, targetId: string, revisionId?: string): Promise<Installation> {
    const plan = await this.installPlan(id, targetId, revisionId); const timestamp = now();
    const after: Installation = { id: plan.before?.id || randomUUID(), skillId: id, revisionId: plan.revision.id, targetId, path: plan.destination, manifest: plan.revision.manifest, owned: plan.same ? plan.before?.owned || false : true, status: 'active', installedAt: plan.before?.installedAt || timestamp, updatedAt: timestamp };
    if (plan.same) { this.store.put('installations', after); return after; }
    await fs.mkdir(plan.target.path, { recursive: true });
    const opId = randomUUID(); const stage = path.join(plan.target.path, `.skill-manager-stage-${opId}`);
    const operation: Operation = { id: opId, kind: 'install', phase: 'prepared', destination: plan.destination, stage, backup: path.join(plan.target.path, `.skill-manager-old-${opId}`), before: plan.before, after, createdAt: timestamp };
    try {
      await copyPackage(plan.revision.path, stage, plan.revision.manifest);
      this.store.put('operations', operation);
      // Recheck immediately before replacing; the lock serializes all Manager writers.
      if (plan.present && (await manifest(plan.destination)).hash !== plan.before!.manifest.hash) throw new ManagerError('LOCAL_MODIFICATIONS', '安装目录在操作中发生变化');
      if (!plan.present && await exists(plan.destination)) throw new ManagerError('CONFLICT', '安装目录在操作中已被其他程序创建');
      if (plan.present) await fs.rename(plan.destination, operation.backup);
      await fs.rename(stage, plan.destination);
      this.store.transaction(() => { this.store.put('installations', after); this.store.put('operations', { ...operation, phase: 'committed' }); });
      await this.archiveBackup({ ...operation, phase: 'committed' });
      return after;
    } catch (error) {
      if (this.store.get('operations', opId)?.phase === 'prepared') await this.recoverOperation(operation);
      if (await exists(stage)) await this.removePrivate(plan.target.path, stage);
      throw error;
    }
  }
  async uninstall(id: string, dryRun = false) {
    const action = async () => {
      const before = this.store.get('installations', id); if (!before) throw new ManagerError('NOT_FOUND', '没有该安装记录');
      if (!before.owned) throw new ManagerError('READ_ONLY', '该目录是外部安装，Manager 不拥有卸载权限');
      if (before.status === 'removed') return { id, removed: true, alreadyRemoved: true, dryRun };
      const target = this.store.get('targets', before.targetId); if (!target || !within(target.path, before.path) || pathKey(target.path) === pathKey(before.path)) throw new ManagerError('INVALID_TARGET', '安装路径不在登记目标内');
      await this.checkTarget(target);
      if (await exists(before.path)) {
        if ((await fs.lstat(before.path)).isSymbolicLink() || (await manifest(before.path)).hash !== before.manifest.hash) throw new ManagerError('LOCAL_MODIFICATIONS', '安装副本被手动修改，已保留原文件');
      }
      if (dryRun) return { id, path: before.path, dryRun: true };
      const opId = randomUUID(); const operation: Operation = { id: opId, kind: 'uninstall', phase: 'prepared', destination: before.path, backup: path.join(path.dirname(before.path), `.skill-manager-old-${opId}`), before, createdAt: now() };
      this.store.put('operations', operation);
      try {
        if (await exists(before.path)) await fs.rename(before.path, operation.backup);
        this.store.transaction(() => { this.store.put('installations', { ...before, status: 'removed', updatedAt: now() }); this.store.put('operations', { ...operation, phase: 'committed' }); });
        await this.archiveBackup({ ...operation, phase: 'committed' });
        return { id, removed: true, backup: path.join(this.home, 'backups', opId) };
      } catch (error) { if (this.store.get('operations', opId)?.phase === 'prepared') await this.recoverOperation(operation); throw error; }
    }; return dryRun ? action() : this.write(action);
  }
  private async removePrivate(root: string, target: string) {
    const actualRoot = await canonical(root); const actualTarget = await canonical(target);
    if (pathKey(actualRoot) === pathKey(actualTarget) || !within(actualRoot, actualTarget)) throw new ManagerError('INVALID_PATH', '拒绝移除允许目录之外的路径');
    await fs.rm(target, { recursive: true, force: true });
  }
  private async archiveBackup(operation: Operation) {
    if (!await exists(operation.backup) || within(path.join(this.home, 'backups'), operation.backup)) return;
    const archive = path.join(this.home, 'backups', operation.id);
    try {
      const expected = operation.before?.manifest;
      if (!expected || (await manifest(operation.backup)).hash !== expected.hash) return;
      if (!await exists(archive)) await copyPackage(operation.backup, archive, expected);
      if ((await manifest(archive)).hash === expected.hash) {
        await this.removePrivate(path.dirname(operation.destination), operation.backup);
        this.store.put('operations', { ...operation, backup: archive });
      }
    } catch { /* Keep the target-local backup intact; doctor retries this step. */ }
  }
  private async recoverOperation(operation: Operation) {
    const targetId = operation.after?.targetId || operation.before?.targetId; const target = targetId && this.store.get('targets', targetId);
    const expectedBackup = target && path.join(target.path, `.skill-manager-old-${operation.id}`);
    const expectedStage = target && path.join(target.path, `.skill-manager-stage-${operation.id}`);
    try {
      if (!target || !within(await canonical(target.path), await canonical(operation.destination)) || pathKey(operation.destination) === pathKey(target.path) || pathKey(operation.backup) !== pathKey(expectedBackup!) || (operation.stage && pathKey(operation.stage) !== pathKey(expectedStage!))) throw new ManagerError('INVALID_OPERATION', '恢复记录的路径不符合目标范围');
      if (await exists(operation.destination)) {
        const current = await manifest(operation.destination);
        if (operation.kind === 'install' && operation.after && operation.stage && !await exists(operation.stage) && current.hash === operation.after.manifest.hash && (!operation.before || await exists(operation.backup)) && !(await fs.lstat(operation.destination)).isSymbolicLink()) await this.removePrivate(target.path, operation.destination);
        else if (!operation.before || current.hash !== operation.before.manifest.hash) throw new ManagerError('RECOVERY_CONFLICT', '中断后的目录被其他程序修改，保留文件等待处理');
      }
      if (await exists(operation.backup)) {
        if (await exists(operation.destination)) throw new ManagerError('RECOVERY_CONFLICT', '原目录与备份同时存在，保留两份文件');
        if (!operation.before || (await manifest(operation.backup)).hash !== operation.before.manifest.hash) throw new ManagerError('RECOVERY_CONFLICT', '恢复备份与原清单不一致');
        await fs.rename(operation.backup, operation.destination);
      }
      if (operation.stage && await exists(operation.stage)) await this.removePrivate(target.path, operation.stage);
      this.store.put('operations', { ...operation, phase: 'rolled-back' });
    } catch (error) { this.store.put('operations', { ...operation, phase: 'needs-attention', error: failure(error).message }); }
  }
  private async recover() {
    for (const operation of this.store.all('operations')) {
      if (operation.phase === 'prepared') await this.recoverOperation(operation);
      if (operation.phase === 'committed') await this.archiveBackup(operation);
    }
  }
  private async inspectInstallations(save: boolean) {
    const issues: { installationId: string; path: string; status: string; message?: string }[] = [];
    for (const installation of this.store.all('installations').filter(i => i.status !== 'removed')) {
      let status: Installation['status'] = 'active'; let message: string | undefined;
      try { status = !await exists(installation.path) ? 'missing' : (await manifest(installation.path)).hash !== installation.manifest.hash ? 'modified' : 'active'; }
      catch (error) { status = 'unverified'; message = failure(error).message; }
      if (save) this.store.put('installations', { ...installation, status, updatedAt: now() });
      if (status !== 'active') issues.push({ installationId: installation.id, path: installation.path, status, message });
    }
    return issues;
  }
  async doctor(dryRun = false) {
    const action = async () => {
      const sourceIssues: { skillId: string; path: string; status: string; message?: string }[] = [];
      for (const skill of this.store.all('skills')) {
        const revision = this.store.get('revisions', skill.currentRevisionId);
        if (!revision) { sourceIssues.push({ skillId: skill.id, path: '', status: 'missing' }); continue; }
        try {
          let status: Skill['status'] = !await exists(revision.path) ? 'missing' : skill.kind === 'plugin' ? 'unverified' : skill.issues.length ? 'invalid' : 'ready';
          if (status === 'ready' && (await manifest(revision.path)).hash !== revision.hash) { status = 'invalid'; sourceIssues.push({ skillId: skill.id, path: revision.path, status: 'changed', message: '源文件发生变化，请运行 scan；收藏包变化请重新导入' }); }
          else if (status !== 'ready') sourceIssues.push({ skillId: skill.id, path: revision.path, status });
          if (!dryRun) this.store.put('skills', { ...skill, status, updatedAt: now() });
        } catch (error) { sourceIssues.push({ skillId: skill.id, path: revision.path, status: 'unreadable', message: failure(error).message }); if (!dryRun) this.store.put('skills', { ...skill, status: 'unreadable', updatedAt: now() }); }
      }
      return { sourceIssues, installationIssues: await this.inspectInstallations(!dryRun), operations: this.store.all('operations').filter(o => ['prepared', 'needs-attention'].includes(o.phase)), dryRun };
    }; return dryRun ? action() : this.write(action);
  }
  async readFile(id: string, relative: string, revisionId?: string) {
    const skill = this.requireSkill(id); const revision = this.store.get('revisions', revisionId || skill.currentRevisionId);
    if (!revision || revision.skillId !== id) throw new ManagerError('NOT_FOUND', '版本不存在');
    const entry = revision.manifest.files.find(f => f.path === relative); if (!entry) throw new ManagerError('INVALID_PATH', '文件不在该包清单中');
    if (entry.size > 2 * 1024 * 1024) throw new ManagerError('FILE_TOO_LARGE', '预览只支持 2 MiB 以内的文本文件');
    const data = await fs.readFile(await safeChild(revision.path, relative));
    if (data.includes(0)) throw new ManagerError('BINARY_FILE', '该文件为二进制资源，请导出后查看');
    return { path: relative, content: data.toString('utf8') };
  }
  async backup(output: string, dryRun = false) {
    const action = async () => {
      const data = this.store.transaction(() => Object.fromEntries(TABLES.filter(t => t !== 'operations').map(table => [table, this.store.all(table)])));
      const result = { format: 'skill-manager-metadata', version: 1, createdAt: now(), includesFiles: false, data };
      if (!dryRun) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' }); }
      return { path: path.resolve(output), includesFiles: false, skills: this.store.all('skills').length, warning: '元数据备份不包含原始文件；使用 export 另行导出完整包', dryRun };
    }; return dryRun ? action() : this.write(action);
  }
  async restore(input: string, dryRun = false) {
    const run = async () => {
      let contents: unknown;
      try { contents = JSON.parse(await fs.readFile(input, 'utf8')); } catch (error) { if (error instanceof SyntaxError) throw new ManagerError('INVALID_BACKUP', '备份不是有效 JSON'); throw error; }
      const parsed = parseBackup(contents);
      if (!parsed.ok) throw new ManagerError('INVALID_BACKUP', '备份格式或字段无效', parsed.issues);
      const backup = parsed.backup;
      if (this.store.all('skills').length || this.store.all('installations').length) throw new ManagerError('RESTORE_NOT_EMPTY', '恢复需要空的数据目录，请通过 --home 指定新的目录');
      for (const table of TABLES.filter(t => t !== 'operations')) {
        if (!Array.isArray(backup.data[table])) throw new ManagerError('INVALID_BACKUP', '备份缺少数据表');
        for (const item of backup.data[table]) if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id)) throw new ManagerError('INVALID_BACKUP', '备份中包含无效记录');
      }
      // Validate relationships before writing any row. Metadata never grants fresh ownership.
      const skills = backup.data.skills as Skill[]; const sources = backup.data.sources as Source[]; const revisions = backup.data.revisions as Revision[];
      for (const skill of skills) {
        if (typeof skill.name !== 'string' || typeof skill.description !== 'string' || typeof skill.body !== 'string' || typeof skill.notes !== 'string' || !Array.isArray(skill.tags) || !skill.tags.every(t => typeof t === 'string') || !Array.isArray(skill.issues) || !sources.some(s => s.id === skill.sourceId && s.skillId === skill.id) || !revisions.some(r => r.id === skill.currentRevisionId && r.skillId === skill.id)) throw new ManagerError('INVALID_BACKUP', 'Skill 记录或引用关系无效');
      }
      for (const revision of revisions) {
        if (revision.manifest.hash !== revision.hash) throw new ManagerError('INVALID_BACKUP', '版本清单无效');
        const skill = skills.find(s => s.id === revision.skillId); if (!skill) throw new ManagerError('INVALID_BACKUP', '版本没有对应 skill');
        if (skill.kind === 'managed') revision.path = path.join(this.home, 'library', skill.id, revision.hash);
        if (skill.kind === 'managed' && !revision.hash) throw new ManagerError('INVALID_BACKUP', '收藏包缺少内容哈希');
        revision.available = !!revision.hash && await exists(revision.path);
      }
      for (const source of sources) {
        if (typeof source.path !== 'string' || typeof source.key !== 'string' || typeof source.location !== 'string') throw new ManagerError('INVALID_BACKUP', '来源记录无效');
        const skill = skills.find(s => s.id === source.skillId); if (!skill) throw new ManagerError('INVALID_BACKUP', '来源没有对应 skill');
        if (source.managed) source.path = revisions.find(r => r.id === skill.currentRevisionId)!.path;
      }
      for (const table of ['targets', 'roots'] as const) for (const record of backup.data[table]) if (typeof record.path !== 'string' || typeof record.name !== 'string') throw new ManagerError('INVALID_BACKUP', '目标或扫描目录无效');
      for (const installation of backup.data.installations as Installation[]) {
        if (!skills.some(s => s.id === installation.skillId) || !revisions.some(r => r.id === installation.revisionId && r.skillId === installation.skillId) || !backup.data.targets.some(target => target.id === installation.targetId)) throw new ManagerError('INVALID_BACKUP', '安装记录引用无效');
        installation.owned = false; installation.status = installation.status === 'removed' ? 'removed' : 'unverified';
      }
      for (const skill of skills) if (!revisions.find(r => r.id === skill.currentRevisionId)?.available) { skill.status = 'missing'; skill.issues = ['元数据已恢复，原始文件需要重新关联或导入']; }
      if (!dryRun) this.store.transaction(() => {
        for (const table of TABLES.filter(t => t !== 'operations')) for (const record of backup.data[table]) {
          if ((table === 'targets' || table === 'roots') && this.store.get(table, record.id)) continue;
          this.store.put(table, record);
        }
      });
      return { restored: !dryRun, skills: skills.length, missing: skills.filter(s => s.status === 'missing').length, warning: '未复制原文件，恢复的安装记录只读；扫描验证后可查看状态', dryRun };
    }; return dryRun ? run() : this.write(run);
  }
  async export(id: string, output: string, dryRun = false) {
    const action = async () => {
      const skill = this.requireSkill(id); const revision = this.store.get('revisions', skill.currentRevisionId)!;
      if (!await exists(revision.path)) throw new ManagerError('SOURCE_MISSING', '原文件缺失，不能导出完整包', { missing: [revision.path] });
      if ((await manifest(revision.path)).hash !== revision.hash) throw new ManagerError('SOURCE_CHANGED', '文件已变化，请先重新扫描或导入');
      if (!dryRun) await writeZip(revision.path, path.resolve(output), folderName(skill.name));
      return { path: path.resolve(output), files: revision.manifest.files.length, missing: [], dryRun };
    }; return dryRun ? action() : this.write(action);
  }
}
