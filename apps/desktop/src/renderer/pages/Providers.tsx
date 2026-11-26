import { useMemo, useState } from 'react';
import { Search, SearchX, Plus, Sparkles, CheckCircle2, SlidersHorizontal } from 'lucide-react';
import type { ProviderCategory, ProviderView } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Spinner, StatusDot } from '../components/ui';
import { ProviderDialog } from './ProviderDialog';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';

const categories: [ProviderCategory | 'all', string][] = [
  ['all', 'providers.cat.all'],
  ['direct', 'providers.cat.direct'],
  ['aggregator', 'providers.cat.aggregator'],
  ['local', 'providers.cat.local'],
  ['custom', 'providers.cat.custom'],
];

const typeLabel: Record<ProviderCategory, string> = {
  direct: 'Direct API',
  aggregator: 'Aggregator',
  local: 'Local Inference',
  custom: 'Custom Gateway',
};

const statusLabel: Record<string, string> = {
  not_configured: 'Not Configured',
  configured: 'Configured · Untested',
  disabled: 'Disabled',
  connected: 'Connected',
  error: 'Connection Failed',
};

export function Providers() {
  const { t } = useI18n();
  const q = useQuery(() => api.providers());
  const [filter, setFilter] = useState<ProviderCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const list = q.data ?? [];
    return {
      all: list.length,
      direct: list.filter((p) => p.category === 'direct').length,
      aggregator: list.filter((p) => p.category === 'aggregator').length,
      local: list.filter((p) => p.category === 'local').length,
      custom: list.filter((p) => p.category === 'custom').length,
    };
  }, [q.data]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter(
        (p) =>
          (filter === 'all' || p.category === filter) &&
          (!term ||
            p.name.toLowerCase().includes(term) ||
            p.id.includes(term) ||
            p.description.toLowerCase().includes(term) ||
            p.protocols.some((proto) => proto.includes(term))),
      )
      .sort((a, b) => {
        const aCfg = a.status !== 'not_configured' ? 0 : 1;
        const bCfg = b.status !== 'not_configured' ? 0 : 1;
        return aCfg - bCfg;
      });
  }, [q.data, filter, search]);

  const current: ProviderView | undefined = q.data?.find((p) => p.id === selected);

  return (
    <div className="max-w-6xl space-y-7">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('providers.title')}</h1>
            <Badge variant="success">{t('providers.badge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">
            {t('providers.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setSelected('custom-openai')}>
            <Plus className="h-3.5 w-3.5" /> {t('providers.addCustom')}
          </Button>
        </div>
      </header>

      {/* Search & Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search input with green focus */}
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" aria-hidden />
          <Input
            aria-label={t('common.search')}
            placeholder={t('providers.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Minimalist Filter Tabs */}
        <div role="tablist" aria-label={t('models.col.provider')} className="flex flex-wrap gap-1 p-1 rounded-xl bg-bg2">
          {categories.map(([id, key]) => {
            const active = filter === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(id)}
                className={cx(
                  'h-7 rounded-lg px-3 text-xs font-medium transition-all duration-150',
                  active
                    ? 'bg-elevated text-primary font-semibold shadow-sm'
                    : 'text-fg2 hover:text-fg hover:bg-elevated/60',
                )}
              >
                {t(key)} <span className="ml-1 font-mono text-[10px] opacity-60">{counts[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Providers */}
      {q.loading && !q.data ? (
        <Spinner label={t('common.loading')} />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<SearchX className="h-5 w-5" />} title={t('providers.emptyTitle')}>
          {t('providers.emptyHint')}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => {
            const isConfigured = p.status !== 'not_configured';
            const isConnected = p.status === 'connected';

            return (
              <Card
                key={p.id}
                hoverable
                className="group flex flex-col justify-between p-5 transition-all duration-200"
              >
                {/* Provider Card Header */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ProviderLogoBadge id={p.id} name={p.name} size="md" active={isConnected} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-bold text-sm text-fg group-hover:text-primary transition-colors">
                            {p.name}
                          </h3>
                        </div>
                        <span className="text-[11px] text-muted font-mono">{p.id}</span>
                      </div>
                    </div>

                    <StatusDot status={p.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-fg2">
                    {p.description}
                  </p>
                </div>

                {/* Badges & Meta info */}
                <div className="mt-5 space-y-3.5 pt-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={p.category === 'local' ? 'success' : 'default'}>
                        {t(`providers.type.${p.category}`)}
                      </Badge>
                      {p.source !== 'builtin' && <Badge variant="warn">{p.source}</Badge>}
                    </div>

                    <span className="font-mono text-[11px] text-fg2">
                      {p.modelCount > 0 ? `${p.modelCount} ${t('nav.models').toLowerCase()}` : t('providers.catalogReady')}
                    </span>
                  </div>

                  {/* Actions & Connection status */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-fg2">
                      <span>{t(`providers.status.${p.status}`)}</span>
                    </div>

                    <Button
                      variant={!isConfigured ? 'primary' : 'secondary'}
                      onClick={() => setSelected(p.id)}
                    >
                      {!isConfigured ? t('common.configure') : t('common.manage')}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {current && (
        <ProviderDialog provider={current} onClose={() => setSelected(null)} onChanged={q.reload} />
      )}
    </div>
  );
}
