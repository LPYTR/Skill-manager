import { DatabaseSync } from 'node:sqlite';
import type { Table, Tables } from './types.js';
import { ManagerError } from './types.js';
export const TABLES: Table[] = ['skills', 'sources', 'revisions', 'targets', 'roots', 'installations', 'operations'];
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version as number;
    if (version > 1) { this.db.close(); throw new ManagerError('UNSUPPORTED_SCHEMA', '数据库来自更新版本，请升级 Manager 后重试'); }
    for (const name of TABLES) this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`);
    this.db.exec('PRAGMA user_version = 1;');
  }
  all<K extends Table>(table: K): Tables[K][] { return this.db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(row.data as string)); }
  get<K extends Table>(table: K, id: string): Tables[K] | undefined { const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id); return row ? JSON.parse(row.data as string) : undefined; }
  put<K extends Table>(table: K, value: Tables[K]) { this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, JSON.stringify(value)); return value; }
  seed<K extends Table>(table: K, value: Tables[K]) { this.db.prepare(`INSERT OR IGNORE INTO ${table}(id,data) VALUES(?,?)`).run(value.id, JSON.stringify(value)); }
  delete(table: Table, id: string) { this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close() { this.db.close(); }
}
