import { useMemo, useState } from 'react';
import { Boxes, GitCompare, Plus, RefreshCw, Search, Trash2, ArrowUpDown } from 'lucide-react';
import type { CapabilityFilter, ManualModelInput, ModelRecord, CapabilityState } from '@cameleon/shared';
import { EngineError } from '@cameleon/shared';
import { api } from '../api';
import { useDebounced, useQuery } from '../hooks';
import type { PageId } from '../components/Sidebar';
import { Cap, fmtTokens } from '../components/Cap';
import { CompatBadge } from '../components/CompatBadge';
import { Badge, Button, Card, cx, Dialog, EmptyState, ErrorState, Field, Input, Mono, Spinner, useToast } from '../components/ui';
import { ago } from './Overview';
import { ProviderLogo, ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';

const key = (m: ModelRecord) => `${m.providerId}\u0000${m.modelId}`;
const price = (m: ModelRecord) => {
  if (!m.pricing) return '–';
  const f = (n: number | null) => (n === null ? '?' : `$${+n.toFixed(4)}`);
  return `${f(m.pricing.inputPerMTok)} / ${f(m.pricing.outputPerMTok)}`;
};
const capFilters: [CapabilityFilter, string][] = [
  ['tools', 'models.cap.tools'],
  ['vision', 'models.cap.vision'],
  ['reasoning', 'models.cap.reasoning'],
  ['structured', 'models.cap.structured'],
  ['streaming', 'models.cap.streaming'],
];
const STEP = 200;

export function Models({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const providers = useQuery(() => api.providers());
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [caps, setCaps] = useState<Set<CapabilityFilter>>(new Set());
  const [includeAll, setIncludeAll] = useState(false);
  const [shown, setShown] = useState(STEP);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<ModelRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  const q = useDebounced(search, 200);
  const capKey = [...caps].sort().join(',');
  const models = useQuery(
    () =>
      api.models({
        providerId: provider || undefined,
        q: q || undefined,
        capabilities: capKey || undefined,
        chatOnly: includeAll ? '0' : '1',
        limit: 2000,
      }),
    [provider, q, capKey, includeAll],
  );

  const connected = (providers.data ?? []).filter((p) => p.status !== 'not_configured' && p.status !== 'disabled');
  const withModels = (providers.data ?? []).filter((p) => p.modelCount > 0);
  const list = models.data ?? [];
  const byKey = useMemo(() => new Map(list.map((m) => [key(m), m])), [list]);
  const pickedModels = picked.map((k) => byKey.get(k)).filter((m): m is ModelRecord => Boolean(m));
  const lastSync = list.reduce<string | null>((a, m) => (!a || m.syncedAt > a ? m.syncedAt : a), null);

  async function refresh() {
    setSyncing(true);
    try {
      const res = await api.syncModels({});
      if (!res.length) toast('warning', 'No provider has an enabled credential yet.');
      for (const r of res) {
        if (r.skipped) toast('warning', `${r.providerName}: manual provider — register models yourself`);
        else if (r.ok) toast('success', `${r.providerName}: ${r.count} models (+${r.added} / −${r.removed})`);
        else toast('error', `${r.providerName}: ${r.error}`);
      }
      models.reload();
      providers.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const toggleCap = (c: CapabilityFilter) =>
    setCaps((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  const toggleRow = (m: ModelRecord) =>
    setPicked((p) => (p.includes(key(m)) ? p.filter((x) => x !== key(m)) : p.length < 3 ? [...p, key(m)] : p));

  return (
    <div className="max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('models.title')}</h1>
            <Badge variant="default">{t('models.count', { n: list.length })}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">
            {t('models.subtitle')}{lastSync ? ` · ${t('models.syncedAgo', { ago: ago(lastSync) })}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> {t('models.addManual')}
          </Button>
          <Button variant="primary" loading={syncing} onClick={() => void refresh()} disabled={connected.length === 0}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('models.sync')}
          </Button>
        </div>
      </header>

      {providers.data && connected.length === 0 ? (
        <EmptyState icon={<Boxes className="h-5 w-5" />} title={t('models.connectFirstTitle')}>
          {t('models.connectFirstHint')}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" aria-hidden />
                <Input
                  aria-label={t('common.search')}
                  placeholder={t('models.searchPlaceholder')}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShown(STEP);
                  }}
                  className="pl-9"
                />
              </div>

              <select
                aria-label={t('models.col.provider')}
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setShown(STEP);
                }}
                className="h-8 rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
              >
                <option value="">{t('models.allProviders')}</option>
                {withModels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.modelCount})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t('models.capabilities')} className="flex flex-wrap gap-1 p-1 rounded-xl bg-bg2">
                {capFilters.map(([id, labelKey]) => {
                  const on = caps.has(id);
                  return (
                    <button
                      key={id}
                      aria-pressed={on}
                      onClick={() => {
                        toggleCap(id);
                        setShown(STEP);
                      }}
                      className={cx(
                        'h-6 rounded-md px-2 text-[11px] font-medium transition-all',
                        on
                          ? 'bg-elevated text-primary font-semibold'
                          : 'text-fg2 hover:bg-elevated/60 hover:text-fg',
                      )}
                    >
                      {t(labelKey)}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center gap-1.5 text-xs text-fg2 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--primary)] rounded"
                  checked={includeAll}
                  onChange={(e) => setIncludeAll(e.target.checked)}
                />
                <span>{t('models.includeAll')}</span>
              </label>

              {picked.length >= 2 && (
                <Button variant="accent-outline" onClick={() => setComparing(true)}>
                  <GitCompare className="h-3.5 w-3.5" /> {t('models.compare', { n: picked.length })}
                </Button>
              )}
            </div>
          </div>

          {models.loading && !models.data ? (
            <Spinner label={t('models.querying')} />
          ) : models.error ? (
            <ErrorState message={models.error} onRetry={models.reload} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-5 w-5" />}
              title={q || caps.size || provider ? t('models.noMatchesTitle') : t('models.noneRegisteredTitle')}
            >
              {q || caps.size || provider
                ? t('models.noMatchesHint')
                : t('models.noneRegisteredHint')}
            </EmptyState>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead>
                  <tr className="bg-bg2/50 text-[11px] font-medium uppercase tracking-wider text-muted">
                    <th className="w-9 px-3.5 py-3">
                      <span className="sr-only">{t('models.compareTitle')}</span>
                    </th>
                    <th className="px-3.5 py-3">{t('models.col.model')}</th>
                    <th className="px-3.5 py-3">{t('models.col.provider')}</th>
                    <th className="px-3.5 py-3">{t('models.col.context')}</th>
                    <th className="px-3.5 py-3">{t('models.col.maxOutput')}</th>
                    <th className="px-3.5 py-3">{t('models.col.tools')}</th>
                    <th className="px-3.5 py-3">{t('models.col.vision')}</th>
                    <th className="px-3.5 py-3">{t('models.col.reasoning')}</th>
                    <th className="px-3.5 py-3">{t('models.col.pricing')}</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {list.slice(0, shown).map((m) => (
                    <tr key={key(m)} className="transition-colors hover:bg-elevated/50">
                      <td className="px-3.5 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Compare ${m.modelId}`}
                          className="h-3.5 w-3.5 accent-[var(--primary)] rounded cursor-pointer"
                          checked={picked.includes(key(m))}
                          disabled={!picked.includes(key(m)) && picked.length >= 3}
                          onChange={() => toggleRow(m)}
                        />
                      </td>
                      <td className="max-w-[300px] px-3.5 py-2.5">
                        <button
                          onClick={() => setDetail(m)}
                          className="block max-w-full truncate text-left font-semibold text-fg hover:text-primary transition-colors"
                        >
                          {m.displayName}
                        </button>
                        <div className="truncate font-mono text-[11px] text-muted">{m.modelId}</div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2 text-fg">
                          <ProviderLogo id={m.providerId} size="xs" />
                          <span className="font-medium">{m.providerId}</span>
                          {m.origin !== 'discovered' && <Badge>{m.origin}</Badge>}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-fg2">{fmtTokens(m.contextWindow)}</td>
                      <td className="px-3.5 py-2.5 font-mono text-fg2">{fmtTokens(m.maxOutputTokens)}</td>
                      <td className="px-3.5 py-2.5">
                        <Cap state={m.capabilities.toolCalling} />
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Cap state={m.capabilities.vision} />
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Cap state={m.capabilities.reasoning} />
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-fg2">{price(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between px-4 py-3 text-xs text-fg2 bg-bg2/30">
                <span>
                  {t('models.showing', { shown: Math.min(shown, list.length), total: list.length })}
                </span>
                {list.length > shown && (
                  <Button variant="ghost" onClick={() => setShown((s) => s + STEP)}>
                    {t('models.loadMore', { n: Math.min(STEP, list.length - shown) })}
                  </Button>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {detail && (
        <ModelDetail
          model={detail}
          onClose={() => setDetail(null)}
          onDeleted={() => {
            setDetail(null);
            models.reload();
            providers.reload();
          }}
          onCompare={() => {
            if (!picked.includes(key(detail)) && picked.length < 3) setPicked([...picked, key(detail)]);
            setDetail(null);
          }}
        />
      )}

      {adding && (
        <AddModelDialog
          providers={(providers.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            models.reload();
            providers.reload();
          }}
        />
      )}

      <Dialog open={comparing} onClose={() => setComparing(false)} title={t('models.compareTitle')} wide>
        <div className="overflow-x-auto p-6">
          <CompareTable models={pickedModels} />
        </div>
        <div className="flex justify-between px-5 py-3.5 bg-bg2/40">
          <Button
            variant="ghost"
            onClick={() => {
              setPicked([]);
              setComparing(false);
            }}
          >
            {t('models.clearSelection')}
          </Button>
          <Button onClick={() => setComparing(false)}>{t('common.done')}</Button>
        </div>
      </Dialog>
    </div>
  );
}

function CompareTable({ models }: { models: ModelRecord[] }) {
  const { t } = useI18n();
  const rows: [string, (m: ModelRecord) => React.ReactNode][] = [
    [
      t('models.col.provider'),
      (m) => (
        <div className="flex items-center gap-2">
          <ProviderLogo id={m.providerId} size="xs" />
          <span>{m.providerId}</span>
        </div>
      ),
    ],
    [t('models.modelIdLabel'), (m) => <Mono>{m.modelId}</Mono>],
    [t('models.protocol'), (m) => <Badge>{m.protocol}</Badge>],
    [t('models.col.context'), (m) => fmtTokens(m.contextWindow)],
    [t('models.col.maxOutput'), (m) => fmtTokens(m.maxOutputTokens)],
    [t('models.col.tools'), (m) => <Cap state={m.capabilities.toolCalling} withLabel />],
    [t('models.streaming'), (m) => <Cap state={m.capabilities.streaming} withLabel />],
    [t('models.col.vision'), (m) => <Cap state={m.capabilities.vision} withLabel />],
    [t('models.structuredOutput'), (m) => <Cap state={m.capabilities.structuredOutput} withLabel />],
    [t('models.col.reasoning'), (m) => <Cap state={m.capabilities.reasoning} withLabel />],
    [t('models.col.pricing'), (m) => <span className="font-mono">{price(m)}</span>],
  ];

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr>
          <th className="w-48 py-2.5 pr-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('models.metric')}</th>
          {models.map((m) => (
            <th key={key(m)} className="px-4 py-2.5 font-bold text-sm text-fg">
              {m.displayName}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, cell]) => (
          <tr key={label} className="hover:bg-elevated/40">
            <th scope="row" className="py-2.5 pr-4 text-xs font-medium text-fg2">
              {label}
            </th>
            {models.map((m) => (
              <td key={key(m)} className="px-4 py-2.5">
                {cell(m)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelDetail({
  model: m,
  onClose,
  onDeleted,
  onCompare,
}: {
  model: ModelRecord;
  onClose: () => void;
  onDeleted: () => void;
  onCompare: () => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const compat = useQuery(() => api.modelCompat(m.providerId, m.modelId), [m.providerId, m.modelId]);
  const caps: [string, CapabilityState][] = [
    [t('models.col.tools'), m.capabilities.toolCalling],
    [t('models.streaming'), m.capabilities.streaming],
    [t('models.col.vision'), m.capabilities.vision],
    [t('models.structuredOutput'), m.capabilities.structuredOutput],
    [t('models.col.reasoning'), m.capabilities.reasoning],
  ];

  return (
    <Dialog open onClose={onClose} title={m.displayName}>
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-3">
          <ProviderLogoBadge id={m.providerId} size="md" />
          <div className="min-w-0">
            <Mono>{m.modelId}</Mono>
            {m.description && <p className="mt-1 text-xs text-fg2">{m.description}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-bg2/50 p-4 text-xs">
          {(
            [
              [t('models.col.provider'), m.providerId],
              [t('models.protocol'), m.protocol],
              [t('models.category'), m.kind],
              [t('models.origin'), m.origin],
              [t('models.col.context'), m.contextWindow?.toLocaleString() ?? t('models.notReported')],
              [t('models.col.maxOutput'), m.maxOutputTokens?.toLocaleString() ?? t('models.notReported')],
              [t('models.col.pricing'), m.pricing ? `${price(m)}` : t('models.notPublished')],
              [t('models.lastSynced'), ago(m.syncedAt)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="font-medium text-fg">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('models.capabilities')}</h4>
          <ul className="space-y-1.5">
            {caps.map(([l, s]) => (
              <li key={l} className="flex items-center justify-between text-xs py-1">
                <span className="text-fg2">{l}</span>
                <Cap state={s} withLabel />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('models.agentCompat')}</h4>
          {compat.loading && !compat.data ? (
            <Spinner />
          ) : (
            <ul className="space-y-2">
              {(compat.data ?? []).map((a) => (
                <li key={a.agentId} className="rounded-lg bg-bg2/50 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-xs text-fg">{a.agentName}</span>
                    <CompatBadge compat={a.compat} />
                  </div>
                  {a.compat.reasons
                    .filter((r) => r.level !== 'info')
                    .slice(0, 2)
                    .map((r) => (
                      <div key={r.code} className="mt-1 text-[11px] text-muted">
                        {r.message}
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-6 py-3.5 bg-bg2/40">
        {m.origin === 'manual' ? (
          <Button
            variant="danger"
            onClick={() =>
              void api
                .deleteModel(m.providerId, m.modelId)
                .then(onDeleted)
                .catch((e: Error) => toast('error', e.message))
            }
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('common.remove')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onCompare}>
            <GitCompare className="h-3.5 w-3.5" /> {t('models.compare', { n: '' }).replace('()', '').trim()}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddModelDialog({
  providers,
  onClose,
  onAdded,
}: {
  providers: { id: string; name: string }[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [context, setContext] = useState('');
  const [maxOut, setMaxOut] = useState('');
  const [caps, setCaps] = useState<Record<string, CapabilityState>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() ? Number(v) : undefined);
  const set = (k: string, v: CapabilityState) => setCaps({ ...caps, [k]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input: ManualModelInput = {
        providerId,
        modelId: modelId.trim(),
        displayName: name.trim() || undefined,
        contextWindow: num(context),
        maxOutputTokens: num(maxOut),
        capabilities: caps,
      };
      await api.addModel(input);
      toast('success', t('models.registered', { id: modelId.trim() }));
      onAdded();
    } catch (err) {
      setError(
        err instanceof EngineError && err.issues?.length
          ? err.issues.map((i) => `${i.path}: ${i.message}`).join(' · ')
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const sel = (k: string, label: string) => (
    <Field label={label}>
      <select
        value={caps[k] ?? 'unknown'}
        onChange={(e) => set(k, e.target.value as CapabilityState)}
        className="h-8 w-full rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
      >
        <option value="unknown">{t('common.unknown')}</option>
        <option value="supported">{t('common.supported')}</option>
        <option value="unsupported">{t('common.notSupported')}</option>
      </select>
    </Field>
  );

  return (
    <Dialog open onClose={onClose} title={t('models.registerTitle')}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3.5 p-6 bg-card">
        <Field label={t('models.col.provider')}>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="h-8 w-full rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('models.modelIdLabel')} hint={t('models.modelIdHint')}>
          <Input mono value={modelId} onChange={(e) => setModelId(e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t('models.displayNameLabel')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('models.contextTokensLabel')}>
            <Input type="number" min={1} value={context} onChange={(e) => setContext(e.target.value)} />
          </Field>
          <Field label={t('models.maxOutTokensLabel')}>
            <Input type="number" min={1} value={maxOut} onChange={(e) => setMaxOut(e.target.value)} />
          </Field>
          {sel('toolCalling', t('models.col.tools'))}
          {sel('vision', t('models.col.vision'))}
          {sel('reasoning', t('models.col.reasoning'))}
          {sel('structuredOutput', t('models.structuredOutput'))}
        </div>
        {error && <p role="alert" className="text-xs text-err">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('models.registerBtn')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
