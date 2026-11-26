import { History, RotateCcw, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Badge, Button, Card, CodeBlock, EmptyState, ErrorState, Spinner } from '../components/ui';
import { ago } from './Overview';
import { ProviderLogo } from '../components/ProviderLogo';
import { useI18n } from '../i18n';
import { useTerminal } from '../terminal-context';

export function HistoryPage() {
  const { t } = useI18n();
  const { requestLaunch } = useTerminal();
  const launches = useQuery(() => api.launches(30));
  const [manual, setManual] = useState<string | null>(null);

  async function openShell() {
    const cwd = await window.cameleon.dialog.chooseFolder();
    if (!cwd) return;
    requestLaunch({ kind: 'shell', cwd }, { title: 'Shell', defaultCwd: cwd });
  }

  return (
    <div className="max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('history.title')}</h1>
            <Badge variant="default">{t('history.badge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">{t('history.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => void openShell()}>
          <TerminalSquare className="h-3.5 w-3.5" /> {t('history.openFolder')}
        </Button>
      </header>

      {manual && (
        <div className="space-y-2 rounded-xl bg-card p-4">
          <p className="text-xs text-fg2">{t('history.manualCmd')}</p>
          <CodeBlock>{manual}</CodeBlock>
        </div>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-bold tracking-tight text-fg">{t('history.recentRuns')}</h2>
        {launches.loading && !launches.data ? (
          <Spinner />
        ) : launches.error ? (
          <ErrorState message={launches.error} onRetry={launches.reload} />
        ) : !launches.data?.length ? (
          <EmptyState icon={<History className="h-5 w-5" />} title={t('history.emptyTitle')}>
            {t('history.emptyHint')}
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {launches.data.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between gap-4 rounded-xl bg-bg2/50 p-3.5 transition-colors hover:bg-elevated/60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card">
                    <ProviderLogo id={l.providerId} size="xs" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-fg">{l.agentId}</span>
                      <span className="text-muted">→</span>
                      <span className="text-xs text-fg2">{l.providerId}</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted" title={l.modelId}>
                      {l.modelId}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                        l.endedAt
                          ? l.exitCode === 0
                            ? 'bg-primary/10 text-primary'
                            : 'bg-rose-500/10 text-rose-400'
                          : 'bg-elevated text-fg2'
                      }`}
                    >
                      {l.endedAt
                        ? l.exitCode === 0
                          ? t('history.completed')
                          : t('history.exitCode', { code: String(l.exitCode ?? l.signal) })
                        : t('common.active')}
                    </span>
                    <div className="mt-1 font-mono text-[11px] text-muted">{ago(l.startedAt)}</div>
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() =>
                      requestLaunch(
                        { kind: 'launch', agentId: l.agentId, providerId: l.providerId, modelId: l.modelId },
                        { title: `${l.agentId} · ${l.providerId}`, onManual: setManual },
                      )
                    }
                    title={t('history.relaunch')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
