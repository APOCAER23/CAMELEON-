import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { FolderOpen, Monitor, TerminalSquare, ArrowRight } from 'lucide-react';
import { useI18n } from './i18n';
import { Button, Dialog, useToast } from './components/ui';
import type { PageId } from './components/Sidebar';

export type TerminalReq =
  | { kind: 'launch'; agentId: string; providerId: string; modelId: string; label?: string; cwd?: string }
  | { kind: 'profile'; name: string; cwd?: string }
  | { kind: 'shell'; cwd?: string };

export interface TerminalTabSession {
  id: string;
  title: string;
  cwd: string;
  req: TerminalReq;
  rawLog: string;
  running: boolean;
  exitCode: number | null;
  startedAt: string;
}

export interface LaunchChoiceMeta {
  title?: string;
  defaultCwd?: string;
  onManual?: (cmd: string) => void;
}

interface PendingLaunch {
  req: TerminalReq;
  meta?: LaunchChoiceMeta;
  cwd: string;
}

type DataListener = (text: string) => void;

interface TerminalContextValue {
  sessions: TerminalTabSession[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  startInApp: (req: TerminalReq, titleHint?: string) => Promise<boolean>;
  openExternal: (req: TerminalReq, onManual?: (cmd: string) => void) => Promise<boolean>;
  requestLaunch: (req: TerminalReq, meta?: LaunchChoiceMeta) => void;
  writeRaw: (sessionId: string, data: string) => Promise<void>;
  resizeSession: (sessionId: string, cols: number, rows: number) => Promise<void>;
  subscribeData: (sessionId: string, listener: DataListener) => () => void;
  killSession: (sessionId: string) => Promise<void>;
  clearSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => void;
}

const TerminalCtx = createContext<TerminalContextValue | null>(null);

const MAX_LOG_CHARS = 250_000;

export function TerminalProvider({
  onNavigate,
  children,
}: {
  onNavigate: (p: PageId) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [sessions, setSessions] = useState<TerminalTabSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLaunch | null>(null);
  const [busy, setBusy] = useState(false);

  const listenersRef = useRef(new Map<string, Set<DataListener>>());

  const emitToSession = useCallback((sessionId: string, text: string) => {
    const set = listenersRef.current.get(sessionId);
    if (set) {
      for (const fn of set) fn(text);
    }
  }, []);

  useEffect(() => {
    const apiTerm = window.cameleon?.terminal;
    if (!apiTerm?.onSessionData || !apiTerm?.onSessionExit) return;

    const unsubData = apiTerm.onSessionData(({ sessionId, text }) => {
      emitToSession(sessionId, text);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const combined = s.rawLog + text;
          return {
            ...s,
            rawLog: combined.length > MAX_LOG_CHARS ? combined.slice(-MAX_LOG_CHARS) : combined,
          };
        }),
      );
    });

    const unsubExit = apiTerm.onSessionExit(({ sessionId, code }) => {
      const exitMsg = `\r\n\x1b[2m[${t('terminal.exitedWith', { code: code ?? 0 })}]\x1b[0m\r\n`;
      emitToSession(sessionId, exitMsg);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const combined = s.rawLog + exitMsg;
          return {
            ...s,
            running: false,
            exitCode: code,
            rawLog: combined.length > MAX_LOG_CHARS ? combined.slice(-MAX_LOG_CHARS) : combined,
          };
        }),
      );
    });

    return () => {
      unsubData();
      unsubExit();
    };
  }, [emitToSession, t]);

  const subscribeData = useCallback((sessionId: string, listener: DataListener) => {
    let set = listenersRef.current.get(sessionId);
    if (!set) {
      set = new Set();
      listenersRef.current.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) listenersRef.current.delete(sessionId);
    };
  }, []);

  const startInApp = useCallback(
    async (req: TerminalReq, titleHint?: string): Promise<boolean> => {
      const res = await window.cameleon.terminal.startSession(req);
      if (!res.ok || !res.sessionId) {
        toast('error', res.error ?? t('overview.terminalErr'));
        return false;
      }
      const tab: TerminalTabSession = {
        id: res.sessionId,
        title: titleHint || res.title || (req.kind === 'shell' ? 'Shell' : req.kind === 'profile' ? req.name : req.agentId),
        cwd: res.cwd ?? req.cwd ?? '',
        req: { ...req, cwd: res.cwd ?? req.cwd },
        rawLog: '',
        running: true,
        exitCode: null,
        startedAt: new Date().toISOString(),
      };
      setSessions((prev) => [...prev, tab]);
      setActiveId(tab.id);
      onNavigate('terminal');
      return true;
    },
    [onNavigate, t, toast],
  );

  const openExternal = useCallback(
    async (req: TerminalReq, onManual?: (cmd: string) => void): Promise<boolean> => {
      const r = await window.cameleon.terminal.open(req);
      if (r.ok) {
        toast('success', t('agents.terminalOpened'));
        return true;
      }
      toast('warning', r.error ?? t('overview.terminalErr'));
      if (r.manual && onManual) onManual(r.manual);
      return false;
    },
    [t, toast],
  );

  const requestLaunch = useCallback((req: TerminalReq, meta?: LaunchChoiceMeta) => {
    setPending({
      req,
      meta,
      cwd: meta?.defaultCwd ?? req.cwd ?? '',
    });
  }, []);

  const writeRaw = useCallback(async (sessionId: string, data: string) => {
    await window.cameleon.terminal.writeSession(sessionId, data);
  }, []);

  const resizeSession = useCallback(async (sessionId: string, cols: number, rows: number) => {
    await window.cameleon.terminal.resizeSession(sessionId, cols, rows);
  }, []);

  const killSession = useCallback(async (sessionId: string) => {
    await window.cameleon.terminal.killSession(sessionId);
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, running: false } : s)),
    );
  }, []);

  const clearSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, rawLog: '' } : s)));
  }, []);

  const closeSession = useCallback(
    (sessionId: string) => {
      void window.cameleon.terminal.killSession(sessionId);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        if (activeId === sessionId) {
          setActiveId(next.length ? next[next.length - 1]!.id : null);
        }
        return next;
      });
    },
    [activeId],
  );

  const chooseFolderForPending = async () => {
    const folder = await window.cameleon.dialog.chooseFolder();
    if (folder && pending) {
      setPending({ ...pending, cwd: folder });
    }
  };

  const confirmPending = async (mode: 'inapp' | 'external') => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const finalReq: TerminalReq = pending.cwd ? { ...pending.req, cwd: pending.cwd } : pending.req;
      if (mode === 'inapp') {
        const ok = await startInApp(finalReq, pending.meta?.title);
        if (ok) setPending(null);
      } else {
        await openExternal(finalReq, pending.meta?.onManual);
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const defaultHeading =
    pending?.meta?.title ??
    (pending?.req.kind === 'profile'
      ? pending.req.name
      : pending?.req.kind === 'launch'
      ? pending.req.agentId
      : 'Shell');

  return (
    <TerminalCtx.Provider
      value={{
        sessions,
        activeId,
        setActiveId,
        startInApp,
        openExternal,
        requestLaunch,
        writeRaw,
        resizeSession,
        subscribeData,
        killSession,
        clearSession,
        closeSession,
      }}
    >
      {children}

      {/* Creative Launch Mode Selector Modal */}
      <Dialog
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        title={`${t('launchModal.title')} · ${defaultHeading}`}
        wide
      >
        {pending && (
          <div className="p-6 space-y-5 bg-card">
            <p className="text-xs text-fg2">{t('launchModal.subtitle')}</p>

            {/* Working directory chooser */}
            <div className="rounded-xl bg-bg2/60 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  {t('launchModal.folderLabel')}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-fg">
                  {pending.cwd || '~ (Home)'}
                </div>
              </div>
              <Button type="button" variant="secondary" onClick={() => void chooseFolderForPending()}>
                <FolderOpen className="h-3.5 w-3.5 text-primary" /> {t('launchModal.changeFolder')}
              </Button>
            </div>

            {/* Two side-by-side creative choice cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmPending('inapp')}
                className="group flex flex-col justify-between rounded-2xl bg-bg2/70 p-5 text-left transition-all hover:bg-elevated focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <TerminalSquare className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                      {t('launchModal.inAppBadge')}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-bold text-fg group-hover:text-primary transition-colors">
                    {t('launchModal.inAppTitle')}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-fg2">
                    {t('launchModal.inAppDesc')}
                  </p>
                </div>
                <div className="mt-5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <span>{t('launchModal.inAppBtn')}</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmPending('external')}
                className="group flex flex-col justify-between rounded-2xl bg-bg2/70 p-5 text-left transition-all hover:bg-elevated focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated text-fg">
                      <Monitor className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-fg2">
                      {t('launchModal.externalBadge')}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-bold text-fg group-hover:text-primary transition-colors">
                    {t('launchModal.externalTitle')}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-fg2">
                    {t('launchModal.externalDesc')}
                  </p>
                </div>
                <div className="mt-5 flex items-center gap-1.5 text-xs font-semibold text-fg group-hover:text-primary transition-colors">
                  <span>{t('launchModal.externalBtn')}</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </TerminalCtx.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalCtx);
  if (!ctx) throw new Error('useTerminal must be used inside TerminalProvider');
  return ctx;
}
