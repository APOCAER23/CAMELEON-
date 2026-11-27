import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { getPaths, stopDaemon, tailLog } from '@cameleon/cli';
import { findExecutable, redactString } from '@cameleon/kit';
import { ensureEngine, forward } from './engine-bridge.js';
import { resolveNodeBin } from './node-runtime.js';
import { readSettings, SettingsPatch, writeSettings } from './settings.js';
import { buildTerminalCommand, isSafeModelId, manualCommand, openTerminal } from './terminal.js';
import {
  buildInAppCommand,
  killAllInAppSessions,
  killInAppSession,
  resizeInAppSession,
  startInAppSession,
  writeInAppSession,
} from './inapp-terminal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';
const RENDERER_DIR = path.join(here, '..', 'dist', 'renderer');
const RENDERER_INDEX = path.join(RENDERER_DIR, 'index.html');

process.umask?.(0o077);
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.apocaer23.cameleon');

let win: BrowserWindow | null = null;

/** Only our own renderer may talk to the main process. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return DEV ? url.startsWith(DEV_URL) : url.startsWith(pathToFileURL(RENDERER_DIR).href);
}
const guarded = <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>, fallback: R) =>
  (e: IpcMainInvokeEvent, ...a: A) => (trusted(e) ? fn(...a) : fallback);

function createWindow() {
  const iconPath = path.join(here, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 960, minHeight: 600, show: false,
    title: 'CAMELEON',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0B0F0D' : '#FFFFFF',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, devTools: DEV,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    const ok = DEV ? url.startsWith(DEV_URL) : url.startsWith(pathToFileURL(RENDERER_DIR).href);
    if (!ok) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  if (DEV) void win.loadURL(DEV_URL); else void win.loadFile(RENDERER_INDEX);
}

/* ───────── terminal launching: identifiers are validated, then passed as separate argv entries ───────── */
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;
const TerminalRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('launch'), agentId: z.string().regex(ID), providerId: z.string().regex(ID), modelId: z.string().refine(isSafeModelId), label: z.string().regex(NAME).optional(), cwd: z.string().max(500).optional() }),
  z.object({ kind: z.literal('profile'), name: z.string().regex(NAME), cwd: z.string().max(500).optional() }),
  z.object({ kind: z.literal('shell'), cwd: z.string().max(500).optional() }),
]);

const nodeBin = () => resolveNodeBin(process.resourcesPath, process.platform);
const cliBin = () => fileURLToPath(import.meta.resolve('@cameleon/cli/bin'));
function resolveCwd(cwd?: string): string {
  if (cwd && path.isAbsolute(cwd)) { try { if (fs.statSync(cwd).isDirectory()) return cwd; } catch { /* fall through */ } }
  return os.homedir();
}

function resolveTerminalRequest(raw: unknown) {
  const parsed = TerminalRequestSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const cliArgs = r.kind === 'launch'
    ? ['launch', r.agentId, '--provider', r.providerId, '--model', r.modelId, ...(r.label ? ['--label', r.label] : [])]
    : r.kind === 'profile' ? ['launch', '--profile', r.name] : null;
  return { nodeBin: nodeBin(), cliBin: cliBin(), cwd: resolveCwd(r.cwd), cliArgs };
}

async function openTerminalFor(raw: unknown): Promise<{ ok: boolean; manual?: string; error?: string }> {
  const req = resolveTerminalRequest(raw);
  if (!req) return { ok: false, error: 'Some value cannot be passed safely to a terminal — launch from the CLI instead.' };
  const cmd = buildTerminalCommand(process.platform, req);
  const manual = manualCommand(req);
  if (!cmd) return { ok: false, manual, error: 'No supported terminal emulator found — run the command below yourself.' };
  return (await openTerminal(cmd)) ? { ok: true, manual } : { ok: false, manual, error: 'The terminal could not be opened — run the command below yourself.' };
}

function startSessionFor(raw: unknown): { ok: boolean; sessionId?: string; title?: string; cwd?: string; manual?: string; error?: string } {
  const req = resolveTerminalRequest(raw);
  if (!req) return { ok: false, error: 'Invalid terminal session parameters.' };
  const spec = buildInAppCommand(process.platform, req.nodeBin, req.cliBin, req.cliArgs, req.cwd);
  const manual = manualCommand(req);
  const info = startInAppSession(
    spec,
    (sessionId, text) => {
      if (win && !win.isDestroyed()) win.webContents.send('terminal:session:data', { sessionId, text });
    },
    (sessionId, code, signal) => {
      if (win && !win.isDestroyed()) win.webContents.send('terminal:session:exit', { sessionId, code, signal });
    },
  );
  return { ok: true, ...info, manual };
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // Everything is denied except writing to the clipboard (copy buttons).
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-sanitized-write');
  const denied = { status: 403, body: { error: { code: 'untrusted_sender', message: 'Untrusted sender' } } };

  ipcMain.handle('engine:request', (e, req) => (trusted(e) ? forward(req) : denied));
  ipcMain.handle('engine:ensure', async (e) => {
    if (!trusted(e)) return { running: false, error: 'Untrusted sender' };
    try { const info = await ensureEngine(); return { running: true, port: info.port, version: info.version }; }
    catch (err) { return { running: false, error: (err as Error).message }; }
  });
  ipcMain.handle('engine:restart', async (e) => {
    if (!trusted(e)) return { running: false, error: 'Untrusted sender' };
    try { await stopDaemon(); const info = await ensureEngine(); return { running: true, port: info.port, version: info.version }; }
    catch (err) { return { running: false, error: (err as Error).message }; }
  });
  ipcMain.handle('engine:logs', guarded((lines: unknown) => tailLog(getPaths(), Math.min(Math.max(Number(lines) || 100, 1), 500)).map(redactString), [] as string[]));

  ipcMain.handle('settings:get', guarded(() => readSettings(), null));
  ipcMain.handle('settings:set', guarded((patch: unknown) => {
    const next = writeSettings(SettingsPatch.parse(patch));
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    return next;
  }, null));

  ipcMain.handle('system:info', guarded(() => {
    const cli = findExecutable(process.platform === 'win32' ? ['cameleon'] : ['cameleon']);
    return { platform: process.platform, dataDir: getPaths().data, cli: { installed: cli !== null, path: cli }, cliBin: cliBin(), nodeBin: nodeBin(), version: app.getVersion() };
  }, null));

  ipcMain.handle('terminal:open', guarded((req: unknown) => openTerminalFor(req), { ok: false, error: 'Untrusted sender' }));
  ipcMain.handle('terminal:session:start', guarded((req: unknown) => startSessionFor(req), { ok: false, error: 'Untrusted sender' }));
  ipcMain.handle('terminal:session:write', guarded((payload: unknown) => {
    const p = z.object({ sessionId: z.string().uuid(), data: z.string().max(32_000) }).safeParse(payload);
    return p.success ? writeInAppSession(p.data.sessionId, p.data.data) : false;
  }, false));
  ipcMain.handle('terminal:session:kill', guarded((payload: unknown) => {
    const p = z.object({ sessionId: z.string().uuid() }).safeParse(payload);
    return p.success ? killInAppSession(p.data.sessionId) : false;
  }, false));
  ipcMain.handle('terminal:session:resize', guarded((payload: unknown) => {
    const p = z.object({ sessionId: z.string().uuid(), cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(200) }).safeParse(payload);
    return p.success ? resizeInAppSession(p.data.sessionId, p.data.cols, p.data.rows) : false;
  }, false));
  ipcMain.handle('dialog:folder', guarded(async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  }, null));

  void ensureEngine().catch(() => undefined);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let stopping = false;
app.on('before-quit', (e) => {
  killAllInAppSessions();
  if (stopping || readSettings().keepEngineRunning) return;
  e.preventDefault();
  stopping = true;
  void stopDaemon().finally(() => app.quit());
});
