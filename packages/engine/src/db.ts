import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '@cameleon/kit';
import { migrations } from './migrations.js';

export type Db = Database.Database;

export function openDatabase(file: string): { db: Db; schemaVersion: number } {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('secure_delete = ON');
  const { current } = runMigrations(db, migrations);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return { db, schemaVersion: current };
}
