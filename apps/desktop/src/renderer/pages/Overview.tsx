import {
  Boxes,
  Bot,
  Layers,
  Plug,
  Rocket,
  TerminalSquare,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';
import { useQuery } from '../hooks';
import type { PageId } from '../components/Sidebar';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  StatusDot,
} from '../components/ui';
import { CompatBadge } from '../components/CompatBadge';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';
import { useTerminal } from '../terminal-context';

export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export function Overview({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { t } = useI18n();
  const { requestLaunch } = useTerminal();

  function openTerminal() {
    requestLaunch({ kind: 'shell' }, { title: 'Shell' });
  }

  function launchActiveProfile(name: string) {
    requestLaunch({ kind: 'profile', name }, { title: name });
  }

  const q = useQuery(async () => {
    const [status, providers, activity, agents, active] = await Promise.all([
      api.status(),
      api.providers(),
      api.activity(8),
      api.agents(),
      api.activeProfile(),
    ]);
    return { status, providers, activity, agents, active };
  });

  if (q.loading && !q.data) return <Spinner label={t('overview.loading')} />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? t('common.noData')} onRetry={q.reload} />;

  const { status: s, providers, activity, agents, active } = q.data;
  const installed = agents.filter((a) => a.installed);
  const configured = providers.filter((p) => p.status !== 'not_configured');

  return (
    <div className="max-w-6xl space-y-7">
      {/* Top Banner / Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('overview.title')}</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {t('overview.engineOnline')}
            </span>
          </div>
          <p className="mt-1 text-xs text-fg2">
            {t('overview.subtitle')}
          </p>
        </div>

        {/* Quick actions strip */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => onNavigate('providers')}>
            <Plug className="h-3.5 w-3.5" /> {t('common.configure')}
          </Button>
          <Button variant="secondary" onClick={() => onNavigate('models')}>
            <Boxes className="h-3.5 w-3.5" /> {t('nav.models')} ({s.counts.models})
          </Button>
          <Button variant="secondary" onClick={() => onNavigate('agents')}>
            <Bot className="h-3.5 w-3.5" /> {t('nav.agents')}
          </Button>
          <Button variant="secondary" onClick={() => void openTerminal()}>
            <TerminalSquare className="h-3.5 w-3.5" /> {t('nav.terminal')}
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <section aria-label="System status" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Card className="p-4 hoverable">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{t('overview.kpi.engine')}</div>
          <div className="mt-2 flex items-center gap-2 text-lg font-bold text-fg">
            <StatusDot status="running" />
            <span>v{s.engine.version}</span>
          </div>
          <div className="mt-1 text-[11px] text-primary font-mono">{t('overview.kpi.loopback')}</div>
        </Card>

        <Card className="p-4 hoverable">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{t('overview.kpi.providers')}</div>
          <div className="mt-2 text-lg font-bold text-fg">
            {s.counts.providersConnected}
            <span className="text-xs font-normal text-muted"> / {s.counts.providersConfigured} {t('overview.kpi.set')}</span>
          </div>
          <div className="mt-1 text-[11px] text-fg2">
            {s.counts.providersConnected > 0 ? t('overview.kpi.readyInference') : t('overview.kpi.noProviderActive')}
          </div>
        </Card>

        <Card className="p-4 hoverable">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{t('overview.kpi.models')}</div>
          <div className="mt-2 text-lg font-bold text-fg">{s.counts.models}</div>
          <div className="mt-1 text-[11px] text-fg2">{t('overview.kpi.modelsDesc')}</div>
        </Card>

        <Card className="p-4 hoverable">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{t('overview.kpi.agents')}</div>
          <div className="mt-2 text-lg font-bold text-fg">
            {installed.length}
            <span className="text-xs font-normal text-muted"> / {agents.length}</span>
          </div>
          <div className="mt-1 text-[11px] text-fg2">{t('overview.kpi.agentsDesc')}</div>
        </Card>
      </section>

      {/* Active configuration hero spotlight */}
      <Card className="p-6 bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">{t('overview.activeProfile')}</span>
              {active && <CompatBadge compat={active.compat} />}
            </div>
            <h2 className="text-xl font-bold tracking-tight text-fg">
              {active ? active.name : t('overview.noActiveProfile')}
            </h2>
            <p className="text-xs text-fg2">
              {active ? t('overview.activeProfileHint') : t('overview.noActiveProfileHint')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => onNavigate('profiles')}>
              <Layers className="h-3.5 w-3.5" /> {t('overview.manageProfiles')}
            </Button>
            {active && (
              <Button variant="primary" onClick={() => launchActiveProfile(active.name)}>
                <Rocket className="h-3.5 w-3.5" /> {t('overview.launchInTerminal')}
              </Button>
            )}
          </div>
        </div>

        {active ? (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2">
            <div className="flex items-center gap-3">
              <ProviderLogoBadge id={active.agentId} name={active.agentId} size="md" />
              <div>
                <div className="text-[11px] text-muted">Agent</div>
                <div className="text-sm font-semibold text-fg">
                  {agents.find((a) => a.id === active.agentId)?.name ?? active.agentId}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <ProviderLogoBadge id={active.providerId} name={active.providerName ?? undefined} size="md" active />
              <div>
                <div className="text-[11px] text-muted">{t('models.col.provider')}</div>
                <div className="text-sm font-semibold text-fg">{active.providerName ?? active.providerId}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-primary">
                <Boxes className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted">{t('models.col.model')}</div>
                <div className="truncate font-mono text-xs font-medium text-fg" title={active.modelId}>
                  {active.modelId}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-bg2 p-3">
            <span className="text-xs text-fg2">{t('overview.bindProfileHint')}</span>
            <Button variant="primary" onClick={() => onNavigate('profiles')}>
              {t('overview.createFirstProfile')}
            </Button>
          </div>
        )}
      </Card>

      {/* Two columns: Configured Providers with Logos & Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Providers card */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold tracking-tight text-fg">{t('overview.kpi.providers')}</h2>
              </div>
              <button
                onClick={() => onNavigate('providers')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t('common.all')} ({providers.length}) <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            {configured.length === 0 ? (
              <EmptyState icon={<Plug className="h-5 w-5" />} title={t('overview.noProvidersTitle')}>
                {t('overview.noProvidersHint')}
              </EmptyState>
            ) : (
              <div className="space-y-2.5">
                {configured.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onNavigate('providers')}
                    className="group flex cursor-pointer items-center justify-between rounded-xl bg-bg2/50 p-3 transition-all hover:bg-elevated"
                  >
                    <div className="flex items-center gap-3">
                      <ProviderLogoBadge id={p.id} name={p.name} size="sm" active={p.status === 'connected'} />
                      <div>
                        <div className="text-[13px] font-semibold text-fg group-hover:text-primary transition-colors">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-fg2">
                          {t(`providers.type.${p.category}`)} · {p.modelCount} {t('nav.models').toLowerCase()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot status={p.status} />
                      <span className="text-xs text-fg2">{t(`providers.status.${p.status}`)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 flex items-center justify-between text-xs text-fg2">
            <span>{configured.length} {t('overview.configured')}</span>
            <Button variant="ghost" onClick={() => onNavigate('providers')}>
              + {t('overview.addProvider')}
            </Button>
          </div>
        </Card>

        {/* Recent Activity card */}
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold tracking-tight text-fg">{t('overview.recentActivity')}</h2>
              </div>
              <button
                onClick={() => onNavigate('activity')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t('nav.activity')} <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            {activity.length === 0 ? (
              <div className="py-12 text-center text-xs text-fg2">{t('overview.noEvents')}</div>
            ) : (
              <ul className="space-y-2">
                {activity.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate text-xs text-fg">{a.message}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{ago(a.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 pt-3 flex items-center justify-between text-xs text-muted">
            <span>{t('overview.auditEnabled')}</span>
            <span className="font-mono">AES-256</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
