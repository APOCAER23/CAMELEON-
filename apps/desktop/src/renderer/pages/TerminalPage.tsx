import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Eraser,
  ExternalLink,
  FolderOpen,
  Play,
  Plus,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react';
import { Button, EmptyState, StatusDot } from '../components/ui';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { useTerminal, type TerminalTabSession } from '../terminal-context';

const QUICK_COMMANDS = [
  'cameleon status',
  'cameleon doctor',
  'cameleon provider list',
  'cameleon agent list',
];

function getXtermTheme(dark: boolean) {
  return dark
    ? {
        background: '#000000',
        foreground: '#f4f4f5',
        cursor: '#10b981',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(16, 185, 129, 0.28)',
        black: '#09090b',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#38bdf8',
        magenta: '#a855f7',
        cyan: '#22d3ee',
        white: '#f4f4f5',
        brightBlack: '#71717a',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#7dd3fc',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      }
    : {
        background: '#ffffff',
        foreground: '#09090b',
        cursor: '#059669',
        cursorAccent: '#ffffff',
        selectionBackground: 'rgba(5, 150, 105, 0.2)',
        black: '#09090b',
        red: '#dc2626',
        green: '#059669',
        yellow: '#d97706',
        blue: '#0284c7',
        magenta: '#9333ea',
        cyan: '#0891b2',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#ef4444',
        brightGreen: '#10b981',
        brightYellow: '#f59e0b',
        brightBlue: '#0ea5e9',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      };
}

function XTermView({
  session,
  isDark,
  clearSeq,
  onClear,
}: {
  session: TerminalTabSession;
  isDark: boolean;
  clearSeq: number;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const { writeRaw, resizeSession, subscribeData } = useTerminal();

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const actionsRef = useRef({ writeRaw, resizeSession, onClear });
  actionsRef.current = { writeRaw, resizeSession, onClear };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'block',
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.42,
      scrollback: 5000,
      allowProposedApi: false,
      theme: getXtermTheme(isDark),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    const syncSize = () => {
      try {
        fit.fit();
        if (term.cols > 0 && term.rows > 0) {
          void actionsRef.current.resizeSession(sessionRef.current.id, term.cols, term.rows);
        }
      } catch {
        /* ignore */
      }
    };

    requestAnimationFrame(() => {
      syncSize();
      term.focus();
    });

    if (session.rawLog) {
      term.write(session.rawLog);
    }

    const dataDisposable = term.onData((data) => {
      const cur = sessionRef.current;
      const acts = actionsRef.current;

      if (data === '\x03' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
        term.clearSelection();
        return;
      }

      if (data === '\x16') {
        if (!cur.running) return;
        void navigator.clipboard
          .readText()
          .then((clip) => {
            if (clip) void acts.writeRaw(cur.id, clip);
          })
          .catch(() => undefined);
        return;
      }

      if (data === '\x0c') {
        term.clear();
        acts.onClear();
        return;
      }

      if (!cur.running) return;
      void acts.writeRaw(cur.id, data);
    });

    const unsub = subscribeData(session.id, (chunk) => {
      term.write(chunk);
    });

    const ro = new ResizeObserver(() => {
      syncSize();
    });
    ro.observe(el);

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      ro.disconnect();
      unsub();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getXtermTheme(isDark);
    }
  }, [isDark]);

  useEffect(() => {
    if (clearSeq > 0 && termRef.current) {
      termRef.current.clear();
      termRef.current.focus();
    }
  }, [clearSeq]);

  return (
    <div
      ref={containerRef}
      onClick={() => termRef.current?.focus()}
      className="h-full w-full flex-1 cursor-text overflow-hidden pl-4 pr-2 pt-2 pb-1"
    />
  );
}

export function TerminalPage() {
  const { t } = useI18n();
  const [theme] = useTheme();
  const isDark =
    theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const {
    sessions,
    activeId,
    setActiveId,
    startInApp,
    openExternal,
    writeRaw,
    killSession,
    clearSession,
    closeSession,
  } = useTerminal();

  const [clearSeq, setClearSeq] = useState(0);
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartedRef.current && sessions.length === 0) {
      autoStartedRef.current = true;
      void startInApp({ kind: 'shell' }, 'Shell');
    }
  }, [sessions.length, startInApp]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;

  const startNewShell = async (pickFolder = false) => {
    let cwd: string | undefined;
    if (pickFolder) {
      const chosen = await window.cameleon.dialog.chooseFolder();
      if (!chosen) return;
      cwd = chosen;
    }
    await startInApp({ kind: 'shell', cwd }, 'Shell');
  };

  const runQuickCmd = async (cmd: string) => {
    if (!active || !active.running) return;
    await writeRaw(active.id, cmd + '\r');
  };

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Slim Seamless Top Bar (Tabs + Actions in one clean strip) */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 bg-sidebar/60 px-4">
        {/* Left: Tabs + New Tab / Folder Shell */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {sessions.map((s) => {
            const isSelected = active?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setActiveId(s.id)}
                title={s.cwd || s.title}
                className={`group flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs transition-all ${
                  isSelected
                    ? 'bg-elevated text-fg font-semibold shadow-sm'
                    : 'text-fg2 hover:bg-elevated/50 hover:text-fg'
                }`}
              >
                <StatusDot status={s.running ? 'running' : 'stopped'} />
                <span className="max-w-[140px] truncate">{s.title}</span>
                <button
                  type="button"
                  aria-label={t('terminal.closeTab')}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(s.id);
                  }}
                  className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:bg-card hover:text-fg group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => void startNewShell(false)}
            title={t('terminal.newTab')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg2 transition-colors hover:bg-elevated hover:text-primary"
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => void startNewShell(true)}
            title={t('terminal.startShell')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg2 transition-colors hover:bg-elevated hover:text-primary"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right: Minimal Quick Chips & Session Controls */}
        {active && (
          <div className="flex shrink-0 items-center gap-1.5">
            {active.req.kind === 'shell' && active.running && (
              <div className="hidden lg:flex items-center gap-1 mr-1">
                {QUICK_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => void runQuickCmd(cmd)}
                    className="rounded-md bg-bg2/80 px-2 py-1 font-mono text-[11px] text-fg2 transition-colors hover:bg-elevated hover:text-primary"
                  >
                    {cmd.replace('cameleon ', '')}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                clearSession(active.id);
                setClearSeq((n) => n + 1);
              }}
              title={t('terminal.clear')}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-fg2 transition-colors hover:bg-elevated hover:text-fg"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('terminal.clear')}</span>
            </button>

            {active.running && (
              <button
                type="button"
                onClick={() => void killSession(active.id)}
                title={t('terminal.stop')}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-err/10 px-2.5 text-xs font-medium text-err transition-colors hover:bg-err/20"
              >
                <Square className="h-3 w-3 fill-current" />
                <span className="hidden sm:inline">{t('terminal.stop')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void openExternal(active.req)}
              title={t('terminal.openExternal')}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-bg2/80 px-2.5 text-xs text-fg2 transition-colors hover:bg-elevated hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t('terminal.openExternal')}</span>
            </button>
          </div>
        )}
      </header>

      {/* Full-Bleed Borderless Terminal Canvas */}
      {!active ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState icon={<TerminalSquare className="h-5 w-5" />} title={t('terminal.emptyWorkspaceTitle')}>
            <span className="mb-4 block">{t('terminal.emptyWorkspaceHint')}</span>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => void startNewShell(false)}>
                <Play className="h-3.5 w-3.5" /> {t('terminal.newTab')}
              </Button>
              <Button variant="secondary" onClick={() => void startNewShell(true)}>
                <FolderOpen className="h-3.5 w-3.5" /> {t('terminal.startShell')}
              </Button>
            </div>
          </EmptyState>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
          <XTermView
            key={active.id}
            session={active}
            isDark={isDark}
            clearSeq={clearSeq}
            onClear={() => clearSession(active.id)}
          />
        </div>
      )}
    </div>
  );
}
