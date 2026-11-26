import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getPaths } from '@cameleon/cli';

const Settings = z.object({
  /** Keep the engine alive after the desktop window is closed (the CLI keeps working). */
  keepEngineRunning: z.boolean().default(true),
  /** Start CAMELEON Desktop when you log in to your computer. */
  launchAtLogin: z.boolean().default(false),
  /** Agent preselected in the UI. */
  defaultAgent: z.string().regex(/^[a-z0-9-]{2,41}$/).nullable().default(null),
  language: z.enum([
    'en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar'
  ]).default('en'),
});
export type DesktopSettings = z.infer<typeof Settings>;
export const SettingsPatch = Settings.partial().strict();

const file = () => path.join(getPaths().config, 'desktop-settings.json');

export function readSettings(): DesktopSettings {
  try {
    return Settings.parse(JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    return Settings.parse({});
  }
}

export function writeSettings(patch: z.infer<typeof SettingsPatch>): DesktopSettings {
  const next = Settings.parse({ ...readSettings(), ...patch });
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
