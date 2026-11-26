#!/usr/bin/env node
import { EngineAlreadyRunningError, startEngine } from './engine.js';
import { redact } from '@cameleon/kit';

// Every file the engine creates (db, WAL, vault, logs) is private to the current user.
process.umask(0o077);

const port = Number(process.env['CAMELEON_PORT'] ?? 0);

try {
  const engine = await startEngine({ port, logger: true, onShutdownRequested: () => process.exit(0) });
  const stop = (sig: string) => {
    engine.app.log.info({ sig }, 'shutting down');
    void engine.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', (err) => {
    engine.app.log.error(redact(err), 'uncaught exception');
    void engine.close().finally(() => process.exit(1));
  });
} catch (err) {
  if (err instanceof EngineAlreadyRunningError) {
    console.error(err.message);
    process.exit(3);
  }
  console.error('Engine failed to start:', redact(err));
  process.exit(1);
}
