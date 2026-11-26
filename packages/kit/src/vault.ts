import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type VaultBackend = 'os-keychain' | 'encrypted-file';

export interface SecretStore {
  readonly backend: VaultBackend;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

export interface VaultInfo {
  backend: VaultBackend;
  /** true when secrets are protected by the OS credential manager. */
  osProtected: boolean;
  detail: string;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/* ───────────────────────── OS keychain (Windows Credential Manager / macOS Keychain / Secret Service) ───────────────────────── */

interface KeyringEntry {
  setPassword(v: string): void;
  getPassword(): string | null | undefined;
  deletePassword(): boolean;
}
type KeyringEntryCtor = new (service: string, username: string) => KeyringEntry;

export class KeychainStore implements SecretStore {
  readonly backend = 'os-keychain' as const;
  constructor(private service: string, private Entry: KeyringEntryCtor) {}
  private entry(name: string) {
    return new this.Entry(this.service, name);
  }
  async get(name: string) {
    return this.entry(name).getPassword() ?? null;
  }
  async set(name: string, value: string) {
    this.entry(name).setPassword(value);
  }
  async delete(name: string) {
    try {
      return this.entry(name).deletePassword();
    } catch {
      return false;
    }
  }
}

/* ───────────────────────── Encrypted file fallback (AES-256-GCM) ───────────────────────── */

interface VaultFile {
  v: 1;
  entries: Record<string, { iv: string; tag: string; ct: string }>;
}

/**
 * AES-256-GCM encrypted JSON file. Each entry is bound to its name through AAD,
 * so ciphertexts cannot be swapped between entries. The 32-byte master key lives in a
 * separate 0600 file. Weaker than an OS keychain (same-user malware can read both files)
 * but never plaintext, and safe against DB leaks, backups and casual inspection.
 */
export class EncryptedFileStore implements SecretStore {
  readonly backend = 'encrypted-file' as const;
  private key: Buffer | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string, private keyFile: string) {}

  private serial<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private loadKey(): Buffer {
    if (this.key) return this.key;
    try {
      const hex = fs.readFileSync(this.keyFile, 'utf8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length !== 32) throw new VaultError('Vault master key is corrupted');
      return (this.key = buf);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 });
    const fresh = randomBytes(32);
    fs.writeFileSync(this.keyFile, fresh.toString('hex'), { mode: 0o600, flag: 'wx' });
    return (this.key = fresh);
  }

  private read(): VaultFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as VaultFile;
      if (parsed.v !== 1 || typeof parsed.entries !== 'object') throw new VaultError('Unsupported vault format');
      return parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, entries: {} };
      throw e;
    }
  }

  private write(data: VaultFile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(name: string) {
    return this.serial(() => {
      const item = this.read().entries[name];
      if (!item) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', this.loadKey(), Buffer.from(item.iv, 'base64'));
        d.setAAD(Buffer.from(name));
        d.setAuthTag(Buffer.from(item.tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(item.ct, 'base64')), d.final()]).toString('utf8');
      } catch {
        throw new VaultError(`Cannot decrypt secret "${name}" (wrong key or tampered data)`);
      }
    });
  }

  set(name: string, value: string) {
    return this.serial(() => {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', this.loadKey(), iv);
      c.setAAD(Buffer.from(name));
      const ct = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      const data = this.read();
      data.entries[name] = { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
      this.write(data);
    });
  }

  delete(name: string) {
    return this.serial(() => {
      const data = this.read();
      if (!(name in data.entries)) return false;
      delete data.entries[name];
      this.write(data);
      return true;
    });
  }
}

/* ───────────────────────── Selection ───────────────────────── */

export interface OpenVaultOptions {
  service: string;
  /** Directory for the encrypted-file fallback. */
  dir: string;
  /** Skip the OS keychain (tests, headless servers). Also honoured via `<SERVICE>_VAULT=file`. */
  forceFile?: boolean;
  /** Injectable for tests. */
  loadKeyring?: () => Promise<{ Entry: KeyringEntryCtor } | null>;
}

async function defaultLoadKeyring() {
  try {
    const mod = (await import('@napi-rs/keyring' as string)) as { Entry: KeyringEntryCtor };
    return mod?.Entry ? mod : null;
  } catch {
    return null;
  }
}

/**
 * Pick the best available backend. The OS keychain is *probed* (write → read → delete)
 * because on Linux the library can load while no Secret Service is running.
 */
export async function openVault(opts: OpenVaultOptions): Promise<{ store: SecretStore; info: VaultInfo }> {
  const envForce = process.env[`${opts.service.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_VAULT`] === 'file';
  if (!opts.forceFile && !envForce) {
    const kr = await (opts.loadKeyring ?? defaultLoadKeyring)();
    if (kr) {
      const store = new KeychainStore(opts.service, kr.Entry);
      try {
        const probe = `__probe_${randomBytes(4).toString('hex')}`;
        await store.set(probe, 'ok');
        const ok = (await store.get(probe)) === 'ok';
        await store.delete(probe);
        if (ok) return { store, info: { backend: 'os-keychain', osProtected: true, detail: 'OS credential manager' } };
      } catch {
        /* fall through to file backend */
      }
    }
  }
  const store = new EncryptedFileStore(path.join(opts.dir, 'vault.enc.json'), path.join(opts.dir, 'vault.key'));
  return {
    store,
    info: {
      backend: 'encrypted-file',
      osProtected: false,
      detail: 'AES-256-GCM file vault (OS credential manager unavailable)',
    },
  };
}
