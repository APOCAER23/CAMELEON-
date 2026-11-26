import type { ActivityEntry } from '@cameleon/shared';
import { redactString } from '@cameleon/kit';
import type { Db } from '../db.js';

const KEEP = 1000;

export class ActivityService {
  constructor(private db: Db) {}

  log(kind: string, message: string, providerId?: string): void {
    this.db
      .prepare('INSERT INTO activity (ts, kind, provider_id, message) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), kind, providerId ?? null, redactString(message).slice(0, 300));
    this.db.prepare('DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - ?').run(KEEP);
  }

  list(limit = 50): ActivityEntry[] {
    const rows = this.db
      .prepare('SELECT id, ts, kind, provider_id AS providerId, message FROM activity ORDER BY id DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), 500)) as ActivityEntry[];
    return rows;
  }
}
