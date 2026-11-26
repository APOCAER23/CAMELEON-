import path from 'node:path';
import { ensureAppDirs, openVault, type AppPaths, type SecretStore, type VaultInfo } from '@cameleon/kit';
import { openDatabase, type Db } from './db.js';
import { ProviderRegistry } from './catalog/registry.js';
import { ActivityService } from './services/activity.js';
import { CredentialService } from './services/credentials.js';
import { ProviderService } from './services/providers.js';
import { ConnectionService } from './services/connections.js';
import { ModelService } from './services/models.js';
import { LauncherService } from './services/launcher.js';
import { ProfileService } from './services/profiles.js';
import { UsageService } from './services/usage.js';
import { MeterProxy } from './proxy/meter.js';
import { APP_NAME } from '@cameleon/shared';

export interface EngineContext {
  paths: AppPaths;
  db: Db;
  dbPath: string;
  schemaVersion: number;
  vault: SecretStore;
  vaultInfo: VaultInfo;
  registry: ProviderRegistry;
  activity: ActivityService;
  credentials: CredentialService;
  providers: ProviderService;
  connections: ConnectionService;
  models: ModelService;
  launcher: LauncherService;
  profiles: ProfileService;
  usage: UsageService;
  meterProxy: MeterProxy;
  catalog: { userFiles: number; invalidFiles: string[] };
  startedAt: string;
}

/** Wire every service together. No network, no listening socket — easy to use in tests. */
export async function createContext(paths: AppPaths, opts: { forceFileVault?: boolean } = {}): Promise<EngineContext> {
  ensureAppDirs(paths);
  const dbPath = path.join(paths.data, 'cameleon.db');
  const { db, schemaVersion } = openDatabase(dbPath);
  const { store: vault, info: vaultInfo } = await openVault({ service: APP_NAME, dir: paths.data, forceFile: opts.forceFileVault });

  const registry = new ProviderRegistry();
  const providersDir = path.join(paths.config, 'providers.d');
  const report = registry.loadDirectory(providersDir);

  const activity = new ActivityService(db);
  const credentials = new CredentialService(db, vault, registry, activity);
  const providers = new ProviderService(db, registry, credentials, activity);
  providers.loadCustomFromDb();
  const connections = new ConnectionService(db, registry, credentials, activity);
  const models = new ModelService(db, registry, credentials, connections, activity);
  const usage = new UsageService(db, registry);
  const meterProxy = new MeterProxy(usage);
  const launcher = new LauncherService(db, registry, credentials, models, activity, meterProxy);
  const profiles = new ProfileService(db, registry, credentials, models, launcher, activity);

  return {
    paths, db, dbPath, schemaVersion, vault, vaultInfo, registry, activity, credentials, providers, connections, models, launcher, profiles, usage, meterProxy,
    catalog: { userFiles: report.loaded.length + report.errors.length, invalidFiles: report.errors.map((e) => e.file) },
    startedAt: new Date().toISOString(),
  };
}
