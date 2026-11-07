import type { Tool } from './types.js';

const fixtureDirectories = new Set(['test', 'tests', '__tests__', 'fixture', 'fixtures', '__fixtures__', 'testdata', 'test-data', 'test-fixtures']);
export const isFixturePath = (relative: string) => relative.replaceAll('\\', '/').split('/').some(part => fixtureDirectories.has(part.toLowerCase()));
export const fixtureDirectory = (name: string) => fixtureDirectories.has(name.toLowerCase());
const variant = (relative: string) => /^(?:\.[\w-]+|[\w-]+-plugin|plugin)\/skills\/[^/]+$/.test(relative) || /^skills\/[^/]+$/.test(relative);
function score(relative: string, tool: Tool) {
  if (tool === 'codex' && relative.startsWith('.agents/skills/')) return 100;
  if (tool === 'claude' && relative.startsWith('.claude/skills/')) return 100;
  if (relative.startsWith('skills/')) return 80;
  if (relative.startsWith('plugin/skills/')) return 70;
  if (relative.startsWith('.agent/skills/')) return 60;
  return 0;
}
export interface SkippedImport { path: string; name?: string; reason: string; selected?: string }
export function selectVariants<T extends { relative: string; info: { name: string } }>(candidates: T[], tool: Tool, installed: Map<string, string>) {
  const groups = new Map<string, T[]>(); const selected = new Set<T>(); const skipped: SkippedImport[] = [];
  for (const item of candidates) { const name = item.info.name.toLowerCase(); const group = groups.get(name) || []; group.push(item); groups.set(name, group); }
  for (const [name, group] of groups) {
    const existing = group.find(item => item.relative === installed.get(name));
    const ranked = [...group].sort((a,b) => score(b.relative, tool) - score(a.relative, tool));
    const preferred = group.length > 1 && group.every(item => variant(item.relative)) && score(ranked[0].relative, tool) > 0 && score(ranked[0].relative, tool) > score(ranked[1].relative, tool) ? ranked[0] : undefined;
    const choice = existing || preferred;
    if (!choice) { for (const item of group) selected.add(item); continue; }
    selected.add(choice);
    for (const item of group) if (item !== choice) skipped.push({ path: item.relative, name: item.info.name, selected: choice.relative, reason: existing ? '同名的其他分发版本；保留当前目标已安装的来源' : '同名的其他工具适配版本；已选择当前目标对应的版本' });
  }
  return { selected: candidates.filter(item => selected.has(item)), skipped };
}
