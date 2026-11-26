import fs from 'node:fs';
import path from 'node:path';
import { ProviderDefinition, type ProviderCategory } from '@cameleon/shared';
import { BUILTIN_PROVIDERS } from './builtin.js';
import { AppError } from '../errors.js';

export type ProviderSource = 'builtin' | 'file' | 'custom';

export interface RegistryEntry {
  def: ProviderDefinition;
  source: ProviderSource;
}

/**
 * Modular provider registry. Three sources, merged at runtime — adding a provider never touches core code:
 *   builtin  → src/catalog/builtin.ts
 *   file     → JSON dropped in `<config>/providers.d/*.json`
 *   custom   → created from the UI/CLI and stored in SQLite
 */
export class ProviderRegistry {
  private entries = new Map<string, RegistryEntry>();

  constructor(builtins: readonly ProviderDefinition[] = BUILTIN_PROVIDERS) {
    for (const def of builtins) this.entries.set(def.id, { def, source: 'builtin' });
  }

  register(def: ProviderDefinition, source: Exclude<ProviderSource, 'builtin'>): void {
    const existing = this.entries.get(def.id);
    if (existing) throw new AppError(409, 'provider_exists', `Provider id "${def.id}" is already registered (${existing.source})`);
    this.entries.set(def.id, { def, source });
  }

  unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) throw new AppError(404, 'provider_not_found', `Unknown provider "${id}"`);
    if (e.source === 'builtin') throw new AppError(403, 'builtin_provider', 'Built-in providers cannot be removed');
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): RegistryEntry {
    const e = this.entries.get(id);
    if (!e) throw new AppError(404, 'provider_not_found', `Unknown provider "${id}"`);
    return e;
  }

  list(filter: { category?: ProviderCategory; q?: string } = {}): RegistryEntry[] {
    const q = filter.q?.trim().toLowerCase();
    return [...this.entries.values()].filter(({ def }) =>
      (!filter.category || def.category === filter.category) &&
      (!q || def.name.toLowerCase().includes(q) || def.id.includes(q) || def.description.toLowerCase().includes(q)),
    );
  }

  /** Load user-supplied definitions. Invalid files are reported, never fatal. */
  loadDirectory(dir: string): { loaded: string[]; errors: { file: string; message: string }[] } {
    const loaded: string[] = [];
    const errors: { file: string; message: string }[] = [];
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return { loaded, errors };
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const def = ProviderDefinition.parse({ ...raw, category: raw?.category ?? 'custom' });
        this.register(def, 'file');
        loaded.push(def.id);
      } catch (e) {
        errors.push({ file, message: (e as Error).message.slice(0, 300) });
      }
    }
    return { loaded, errors };
  }
}
