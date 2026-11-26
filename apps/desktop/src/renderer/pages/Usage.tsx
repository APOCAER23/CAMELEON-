import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Coins,
  Cpu,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { UsageRange } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner, useToast } from '../components/ui';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';
import { ago } from './Overview';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function Usage() {
  const { t } = useI18n();
  const toast = useToast();
  const [timeframe, setTimeframe] = useState<UsageRange>('7d');
  const [clearing, setClearing] = useState(false);

  const q = useQuery(() => api.usage(timeframe), [timeframe]);

  useEffect(() => {
    const onFocus = () => q.reload();
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(() => q.reload(), 10_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, [q.reload]);

  async function handleClear() {
    setClearing(true);
    try {
      await api.clearUsage();
      toast('success', t('usage.cleared'));
      q.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? t('common.noData')} onRetry={q.reload} />;

  const { totals, byModel, byAgent, recent } = q.data;
  const maxModelTokens = Math.max(1, ...byModel.map((m) => m.totalTokens));

  return (
    <div className="max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('usage.title')}</h1>
            <Badge variant="success">{t('usage.badge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">{t('usage.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-bg2 p-1">
            {(['7d', '30d', 'all'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`h-7 rounded-lg px-3 text-xs font-medium transition-all ${
                  timeframe === tf
                    ? 'bg-elevated text-primary shadow-sm font-semibold'
                    : 'text-fg2 hover:text-fg'
                }`}
              >
                {tf === '7d' ? t('usage.last7d') : tf === '30d' ? t('usage.last30d') : t('usage.allTime')}
              </button>
            ))}
          </div>

          <Button variant="secondary" onClick={q.reload}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('usage.refresh')}
          </Button>
          {totals.requests > 0 && (
            <Button variant="ghost" loading={clearing} onClick={() => void handleClear()} className="text-err hover:bg-err/10">
              <Trash2 className="h-3.5 w-3.5" /> {t('usage.clear')}
            </Button>
          )}
        </div>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5 hoverable">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>{t('usage.totalTokens')}</span>
            <Coins className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-fg">
            {fmtTokens(totals.totalTokens)}
          </div>
          <div className="mt-1 text-xs text-fg2">
            {t('usage.tokensSub', {
              in: fmtTokens(totals.inputTokens),
              out: fmtTokens(totals.outputTokens),
            })}
          </div>
        </Card>

        <Card className="p-5 hoverable">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>{t('usage.inputTokens')}</span>
            <ArrowUpRight className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-fg">
            {fmtTokens(totals.inputTokens)}
          </div>
          <div className="mt-1 text-xs text-fg2">
            {totals.cacheReadTokens > 0
              ? t('usage.cacheReadSub', { n: fmtTokens(totals.cacheReadTokens) })
              : `${totals.inputTokens.toLocaleString()} tokens`}
          </div>
        </Card>

        <Card className="p-5 hoverable">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>{t('usage.outputTokens')}</span>
            <ArrowDownLeft className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-fg">
            {fmtTokens(totals.outputTokens)}
          </div>
          <div className="mt-1 text-xs text-fg2">{totals.outputTokens.toLocaleString()} tokens</div>
        </Card>

        <Card className="p-5 hoverable">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>{t('usage.requestsLatency')}</span>
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight text-fg">{totals.requests.toLocaleString()}</div>
          <div className="mt-1 text-xs text-fg2">
            {t('usage.avgLatencySub', { ms: totals.avgLatencyMs })}
          </div>
        </Card>
      </section>

      {byModel.length === 0 ? (
        <EmptyState icon={<Coins className="h-5 w-5" />} title={t('usage.emptyTitle')}>
          <span className="max-w-md inline-block">{t('usage.emptyHint')}</span>
        </EmptyState>
      ) : (
        <>
          {/* Per-Model Token Breakdown */}
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight text-fg">{t('usage.breakdown')}</h2>
              <span className="font-mono text-xs text-muted">
                {t('usage.activeModels', { n: byModel.length })}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-bg2/50 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <th className="rounded-l-lg px-4 py-3">{t('usage.col.model')}</th>
                    <th className="px-4 py-3">{t('usage.col.provider')}</th>
                    <th className="px-4 py-3">{t('usage.col.requests')}</th>
                    <th className="px-4 py-3">{t('usage.col.promptTokens')}</th>
                    <th className="px-4 py-3">{t('usage.col.outputTokens')}</th>
                    <th className="px-4 py-3">{t('usage.col.totalTokens')}</th>
                    <th className="rounded-r-lg px-4 py-3 text-right">{t('usage.col.avgLatency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => {
                    const sharePct = totals.totalTokens > 0 ? Math.round((m.totalTokens / totals.totalTokens) * 100) : 0;
                    const barPct = Math.max(4, Math.round((m.totalTokens / maxModelTokens) * 100));
                    return (
                      <tr key={`${m.providerId}:${m.modelId}`} className="transition-colors hover:bg-elevated/40">
                        <td className="px-4 py-3">
                          <div className="font-mono font-semibold text-fg">{m.modelId}</div>
                          <div className="mt-1.5 h-1.5 w-36 overflow-hidden rounded-full bg-bg2">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barPct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ProviderLogoBadge id={m.providerId} name={m.providerName} size="xs" />
                            <span className="text-fg2">{m.providerName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-fg">{m.requests}</td>
                        <td className="px-4 py-3 font-mono text-fg2">{fmtTokens(m.inputTokens)}</td>
                        <td className="px-4 py-3 font-mono text-fg2">{fmtTokens(m.outputTokens)}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-semibold text-fg">{fmtTokens(m.totalTokens)}</span>
                          <span className="ml-2 text-[11px] font-mono text-muted">
                            {t('usage.share', { pct: sharePct })}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-fg2">{m.avgLatencyMs} ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* By Agent & Recent Model Calls */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{t('usage.byAgent')}</h3>
              </div>
              <div className="space-y-2.5">
                {byAgent.map((a) => (
                  <div key={a.agentId} className="flex items-center justify-between rounded-xl bg-bg2/60 px-3.5 py-2.5 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ProviderLogoBadge id={a.agentId} name={a.agentId} size="xs" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-fg">{a.agentId}</div>
                        <div className="text-[11px] text-muted">{a.requests} req</div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-semibold text-fg">{fmtTokens(a.totalTokens)}</div>
                      <div className="text-[10px] text-fg2">
                        {fmtTokens(a.inputTokens)} / {fmtTokens(a.outputTokens)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{t('usage.recentCalls')}</h3>
              </div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {recent.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg2/40 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={r.statusCode < 400 ? 'success' : 'warn'}>{r.statusCode}</Badge>
                      <span className="truncate font-mono font-medium text-fg">{r.modelId}</span>
                      <span className="text-muted">· {r.agentId}</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-fg2">
                      <span>
                        {fmtTokens(r.inputTokens)} in / {fmtTokens(r.outputTokens)} out
                      </span>
                      <span className="font-semibold text-fg">{fmtTokens(r.totalTokens)}</span>
                      <span className="text-muted">{r.latencyMs}ms</span>
                      <span className="text-muted">{ago(r.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
