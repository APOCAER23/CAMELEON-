import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Sidebar, type PageId } from './components/Sidebar';
import { Button, ErrorState, Spinner, ToastProvider, Card, StatusDot } from './components/ui';
import { Overview, ago } from './pages/Overview';
import { Providers } from './pages/Providers';
import { Models } from './pages/Models';
import { Agents } from './pages/Agents';
import { Profiles } from './pages/Profiles';
import { Usage } from './pages/Usage';
import { TerminalPage } from './pages/TerminalPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/Settings';
import { useQuery } from './hooks';
import { Activity } from 'lucide-react';
import { I18nProvider, useI18n } from './i18n';
import { TerminalProvider } from './terminal-context';

function ActivityPage() {
  const { t } = useI18n();
  const q = useQuery(() => api.activity(100));
  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex flex-col gap-1 pb-2">
        <h1 className="text-xl font-bold tracking-tight text-fg">{t('activity.title')}</h1>
        <p className="text-xs text-fg2">{t('activity.subtitle')}</p>
      </header>
      {q.loading && !q.data ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : (
        <Card className="overflow-hidden p-2">
          {q.data?.length ? (
            <ul className="space-y-1">
              {q.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-elevated/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-elevated/80 text-primary">
                      <Activity className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate text-[13px] text-fg">{a.message}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">{ago(a.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-12 text-center text-xs text-fg2">{t('activity.empty')}</div>
          )}
        </Card>
      )}
    </div>
  );
}

function MainContent({
  engine,
  engineError,
  start,
  page,
  setPage,
}: {
  engine: 'starting' | 'ready' | 'failed';
  engineError: string;
  start: () => void;
  page: PageId;
  setPage: (p: PageId) => void;
}) {
  const { t } = useI18n();
  if (engine === 'starting') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Spinner label={t('app.initializing')} />
      </div>
    );
  }
  if (engine === 'failed') {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-16">
        <ErrorState message={t('app.engineFailed', { error: engineError })} />
        <Button variant="primary" onClick={start}>
          {t('app.retryEngine')}
        </Button>
      </div>
    );
  }
  if (page === 'overview') return <Overview onNavigate={setPage} />;
  if (page === 'providers') return <Providers />;
  if (page === 'models') return <Models onNavigate={setPage} />;
  if (page === 'agents') return <Agents onNavigate={setPage} />;
  if (page === 'profiles') return <Profiles />;
  if (page === 'usage') return <Usage />;
  if (page === 'terminal') return <TerminalPage />;
  if (page === 'history') return <HistoryPage />;
  if (page === 'activity') return <ActivityPage />;
  return <SettingsPage />;
}

export function App() {
  const [engine, setEngine] = useState<'starting' | 'ready' | 'failed'>('starting');
  const [engineError, setEngineError] = useState('');
  const [page, setPage] = useState<PageId>('overview');
  const [collapsed, setCollapsed] = useState(false);

  const start = useCallback(() => {
    setEngine('starting');
    if (!window.cameleon?.engine) {
      setEngine('failed');
      setEngineError('Launch CAMELEON through Electron. The desktop bridge is unavailable in a regular browser.');
      return;
    }
    void window.cameleon.engine.ensure()
      .then((r) => {
        if (r.running) setEngine('ready');
        else {
          setEngine('failed');
          setEngineError(r.error ?? 'Unknown error');
        }
      })
      .catch((err: Error) => {
        setEngine('failed');
        setEngineError(err.message || 'Unknown initialization error');
      });
  }, []);

  useEffect(start, [start]);

  return (
    <I18nProvider>
      <ToastProvider>
        <TerminalProvider onNavigate={setPage}>
          <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
            <Sidebar
              page={page}
              onNavigate={setPage}
              collapsed={collapsed}
              onToggle={() => setCollapsed((c) => !c)}
              engineRunning={engine === 'ready'}
            />
            <main
              className={
                page === 'terminal'
                  ? 'min-w-0 flex-1 overflow-hidden p-0'
                  : 'min-w-0 flex-1 overflow-y-auto px-8 py-7'
              }
            >
              <MainContent engine={engine} engineError={engineError} start={start} page={page} setPage={setPage} />
            </main>
          </div>
        </TerminalProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
