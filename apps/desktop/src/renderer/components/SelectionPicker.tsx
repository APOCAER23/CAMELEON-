import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api';
import { useDebounced, useQuery } from '../hooks';
import { CompatBadge, Reasons } from './CompatBadge';
import { Input, Spinner, cx } from './ui';
import { ProviderLogo } from './ProviderLogo';
import { useI18n } from '../i18n';

export interface Selection {
  providerId: string;
  modelId: string;
}

/** Pick provider + model among those a given agent can use, with live compatibility verdicts. */
export function SelectionPicker({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: Selection | null;
  onChange: (s: Selection | null) => void;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [provider, setProvider] = useState(value?.providerId ?? '');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 150);
  const entries = useQuery(
    () => api.compat({ agentId, status: showAll ? 'compatible,limited,untested,incompatible' : undefined, limit: 5000 }),
    [agentId, showAll],
  );
  const list = entries.data ?? [];
  const providers = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.providerId, (m.get(e.providerId) ?? 0) + 1);
    return [...m];
  }, [list]);

  useEffect(() => {
    if (providers.length && !providers.some(([id]) => id === provider)) setProvider(providers[0]![0]);
  }, [providers, provider]);

  const rows = list.filter(
    (e) =>
      e.providerId === provider &&
      (!q || e.modelId.toLowerCase().includes(q.toLowerCase()) || e.displayName.toLowerCase().includes(q.toLowerCase())),
  );
  const chosen = list.find((e) => value && e.providerId === value.providerId && e.modelId === value.modelId) ?? null;

  if (entries.loading && !entries.data) return <Spinner />;
  if (!list.length) {
    return (
      <div className="rounded-xl bg-bg2/60 p-4 text-xs text-fg2">
        {t('picker.empty')}
        <label className="mt-2.5 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[var(--primary)] rounded h-3.5 w-3.5"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span>{t('picker.showIncompatible')}</span>
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('models.col.provider')}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="h-8 rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
        >
          {providers.map(([id, n]) => (
            <option key={id} value={id}>
              {id} ({n})
            </option>
          ))}
        </select>
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" aria-hidden />
          <Input
            aria-label={t('picker.searchModels')}
            placeholder={t('picker.searchModels')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-fg2 select-none cursor-pointer">
          <input
            type="checkbox"
            className="accent-[var(--primary)] rounded h-3.5 w-3.5"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span>{t('picker.showAll')}</span>
        </label>
      </div>

      <ul
        role="radiogroup"
        aria-label={t('models.col.model')}
        className="max-h-60 overflow-y-auto rounded-xl bg-bg2/40 p-1 space-y-1"
      >
        {rows.slice(0, 100).map((e) => {
          const on = value?.providerId === e.providerId && value.modelId === e.modelId;
          return (
            <li key={e.modelId}>
              <button
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ providerId: e.providerId, modelId: e.modelId })}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  on
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-elevated text-fg',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{e.modelId}</span>
                  {e.contextWindow && (
                    <span className="text-[11px] text-muted">{t('picker.contextK', { n: Math.round(e.contextWindow / 1000) })}</span>
                  )}
                </span>
                <CompatBadge compat={e.compat} />
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-4 text-center text-xs text-fg2">{t('picker.noMatch')}</li>}
      </ul>
      {rows.length > 100 && <p className="text-[11px] text-muted">{t('picker.first100')}</p>}
      {chosen && (
        <div className="rounded-xl bg-bg2/60 p-3">
          <Reasons compat={chosen.compat} />
        </div>
      )}
    </div>
  );
}
