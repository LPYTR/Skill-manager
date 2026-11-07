export type Kind = 'managed' | 'external' | 'system' | 'plugin';
export type Tool = 'codex' | 'claude' | 'custom';
export interface Skill { id: string; sourceId: string; name: string; description: string; body: string; metadata: Record<string, unknown>; tags: string[]; favorite: boolean; notes: string; kind: Kind; status: 'ready' | 'missing' | 'invalid' | 'unreadable' | 'unverified'; issues: string[]; currentRevisionId: string; createdAt: string; updatedAt: string; archived?: boolean; archiveReason?: string }
export interface Source { id: string; skillId: string; key: string; type: 'directory' | 'zip' | 'github' | 'discovery'; location: string; subdir?: string; ref?: string; commit?: string; rootId?: string; path: string; managed: boolean }
export interface FileEntry { path: string; hash: string; size: number }
export interface Manifest { files: FileEntry[]; directories: string[]; hash: string }
export interface Revision { id: string; skillId: string; hash: string; path: string; manifest: Manifest; available: boolean; commit?: string; createdAt: string }
export interface Target { id: string; name: string; tool: Tool; scope: 'user' | 'project' | 'custom'; path: string }
export interface ScanRoot { id: string; name: string; path: string; kind: Exclude<Kind, 'managed'>; targetId?: string }
export interface Installation { id: string; skillId: string; revisionId: string; targetId: string; path: string; manifest: Manifest; owned: boolean; status: 'active' | 'modified' | 'missing' | 'removed' | 'unverified'; installedAt: string; updatedAt: string }
export interface Operation { id: string; kind: 'install' | 'uninstall'; phase: 'prepared' | 'committed' | 'rolled-back' | 'needs-attention'; destination: string; stage?: string; backup: string; before?: Installation; after?: Installation; error?: string; createdAt: string }
export interface Tables { skills: Skill; sources: Source; revisions: Revision; targets: Target; roots: ScanRoot; installations: Installation; operations: Operation }
export type Table = keyof Tables;
export interface ManagerOptions { home?: string; userHome?: string; localAppData?: string; codexHome?: string; claudeHome?: string; githubFetcher?: (input: string, destination: string, ref?: string) => Promise<{ repository: string; commit: string }> }
export interface AddOptions { ref?: string; subdir?: string; all?: boolean; install?: boolean; target?: string; dryRun?: boolean; includeFixtures?: boolean; /** Internal stable identity for bundled integrations; not exposed by CLI/HTTP. */ identity?: string }
export interface AddResult { imported: { skill: Skill; revision: Revision; reused: boolean }[]; installations: Installation[]; failures: { skillId: string; code: string; message: string }[]; skipped?: import('./imports.js').SkippedImport[]; dryRun?: boolean; plan?: unknown }
export class ManagerError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = 'ManagerError'; }
}
export function failure(error: unknown) { return error instanceof ManagerError ? { code: error.code, message: error.message, details: error.details } : { code: 'IO_ERROR', message: error instanceof Error ? error.message : String(error) }; }
export const now = () => new Date().toISOString();
