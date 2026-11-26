import { createHash } from 'node:crypto';

/** Minimal surface shared by better-sqlite3 and node:sqlite. */
export interface MigratableDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: any[]): unknown;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  };
}

export interface Migration {
  /** Strictly increasing integer. Never renumber a released migration. */
  id: number;
  name: string;
  sql: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

/**
 * Apply pending migrations inside one transaction each.
 *  - detects edited (already applied) migrations via checksum,
 *  - refuses to run against a database created by a NEWER app version (downgrade guard).
 */
export function runMigrations(db: MigratableDb, migrations: readonly Migration[]): { applied: number[]; current: number } {
  const sorted = [...migrations].sort((a, b) => a.id - b.id);
  sorted.forEach((m, i) => {
    if (!Number.isInteger(m.id) || m.id <= 0) throw new MigrationError(`Invalid migration id: ${m.id}`);
    if (i > 0 && sorted[i - 1]!.id === m.id) throw new MigrationError(`Duplicate migration id: ${m.id}`);
  });

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);

  const done = new Map<number, string>(
    db.prepare('SELECT id, checksum FROM schema_migrations').all().map((r: any) => [r.id as number, r.checksum as string]),
  );
  const known = new Set(sorted.map((m) => m.id));
  for (const id of done.keys()) {
    if (!known.has(id)) {
      throw new MigrationError(`Database schema v${id} is newer than this application. Update the application before opening this database.`);
    }
  }

  const applied: number[] = [];
  for (const m of sorted) {
    const sum = checksum(m.sql);
    const existing = done.get(m.id);
    if (existing !== undefined) {
      if (existing !== sum) throw new MigrationError(`Migration ${m.id} (${m.name}) was modified after being applied.`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        m.id, m.name, sum, new Date().toISOString(),
      );
      db.exec('COMMIT');
      applied.push(m.id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new MigrationError(`Migration ${m.id} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
  return { applied, current: sorted.at(-1)?.id ?? 0 };
}
