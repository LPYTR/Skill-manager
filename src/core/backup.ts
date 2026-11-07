import { z } from 'zod';
const id = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const relative = z.string().min(1).refine(value => !value.startsWith('/') && !/[\\:\0]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Expected a package-relative path');
const inventory = z.object({ hash: hash.or(z.literal('')), files: z.array(z.object({ path: relative, hash, size: z.number().int().nonnegative() })), directories: z.array(relative) });
const kind = z.enum(['managed', 'external', 'system', 'plugin']);
const schema = z.object({
  format: z.literal('skill-manager-metadata'), version: z.literal(1), createdAt: z.string(), includesFiles: z.literal(false),
  data: z.object({
    skills: z.array(z.object({ id, sourceId: id, name: z.string(), description: z.string(), body: z.string(), metadata: z.record(z.string(), z.unknown()), tags: z.array(z.string()), favorite: z.boolean(), notes: z.string(), kind, status: z.enum(['ready', 'missing', 'invalid', 'unreadable', 'unverified']), issues: z.array(z.string()), currentRevisionId: id, createdAt: z.string(), updatedAt: z.string(), archived:z.boolean().optional(), archiveReason:z.string().optional() })),
    sources: z.array(z.object({ id, skillId: id, key: z.string(), type: z.enum(['directory', 'zip', 'github', 'discovery']), location: z.string(), subdir: z.string().optional(), ref: z.string().optional(), commit: z.string().optional(), rootId: z.string().optional(), path: z.string().min(1), managed: z.boolean() })),
    revisions: z.array(z.object({ id, skillId: id, hash: hash.or(z.literal('')), path: z.string().min(1), manifest: inventory, available: z.boolean(), commit: z.string().optional(), createdAt: z.string() })),
    targets: z.array(z.object({ id, name: z.string(), tool: z.enum(['codex', 'claude', 'custom']), scope: z.enum(['user', 'project', 'custom']), path: z.string().min(1) })),
    roots: z.array(z.object({ id, name: z.string(), path: z.string().min(1), kind: z.enum(['external', 'system', 'plugin']), targetId: z.string().optional() })),
    installations: z.array(z.object({ id, skillId: id, revisionId: id, targetId: id, path: z.string().min(1), manifest: inventory, owned: z.boolean(), status: z.enum(['active', 'modified', 'missing', 'removed', 'unverified']), installedAt: z.string(), updatedAt: z.string() })),
  }),
});
export function parseBackup(value: unknown) {
  const result = schema.safeParse(value); if (!result.success) return { ok: false as const, issues: result.error.issues.slice(0, 5) };
  for (const rows of Object.values(result.data.data)) if (new Set(rows.map(row => row.id)).size !== rows.length) return { ok: false as const, issues: ['备份中有重复 ID'] };
  return { ok: true as const, backup: result.data };
}
