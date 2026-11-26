import fs from 'node:fs';
import path from 'node:path';
import { findExecutable } from '@cameleon/kit';

export function resolveNodeBin(
  resourcesPath: string | undefined,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env['CAMELEON_NODE']) return env['CAMELEON_NODE'];

  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'runtime', platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(bundled)) return bundled;
  }

  return findExecutable(['node']) ?? 'node';
}
