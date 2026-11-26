import { useState } from 'react';
import { CheckCircle2, Pencil, Plug, Power, Trash2, XCircle, Zap, AlertTriangle, ExternalLink } from 'lucide-react';
import { EngineError, type CredentialSummary, type ProviderField, type ProviderView, type TestResult } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { Button, ConfirmDialog, Dialog, Field, Input, Mono, Spinner, StatusDot, Badge, useToast } from '../components/ui';
import { ago } from './Overview';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';

export function ProviderDialog({
  provider,
  onClose,
  onChanged,
}: {
  provider: ProviderView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const creds = useQuery(() => api.credentials(provider.id), [provider.id]);
  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const [label, setLabel] = useState('default');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [toDelete, setToDelete] = useState<CredentialSummary | null>(null);

  const reset = (c: CredentialSummary | null) => {
    setEditing(c);
    setLabel(c?.label ?? (creds.data?.length ? '' : 'default'));
    setValues(c ? { ...c.fields } : Object.fromEntries(provider.fields.filter((f) => f.default).map((f) => [f.key, f.default!])));
    setErrors({});
    setTest(null);
  };
  const changed = () => {
    creds.reload();
    onChanged();
  };
  const edit = (k: string, v: string) => {
    setValues({ ...values, [k]: v });
    setTest(null);
  };

  function payload(): Record<string, string> {
    if (!editing) return values;
    const patch: Record<string, string> = {};
    for (const f of provider.fields) {
      const v = (values[f.key] ?? '').trim();
      if (f.kind === 'secret') {
        if (v) patch[f.key] = v;
      } else if (v !== (editing.fields[f.key] ?? '')) patch[f.key] = v;
    }
    return patch;
  }

  function showIssues(err: unknown) {
    if (err instanceof EngineError && err.issues?.length) {
      setErrors(Object.fromEntries(err.issues.map((i) => [i.path.replace(/^values\./, ''), i.message])));
    } else {
      setErrors({ label: (err as Error).message });
      toast('error', (err as Error).message);
    }
  }

  async function runTest() {
    setTesting(true);
    setErrors({});
    try {
      const r = await api.testDraft(provider.id, { values: payload(), credentialId: editing?.id });
      setTest(r);
      r.warnings?.forEach((w) => toast('warning', w));
    } catch (err) {
      setTest(null);
      showIssues(err);
    } finally {
      setTesting(false);
    }
  }

  async function discover() {
    try {
      const [r] = await api.syncModels({ providerId: provider.id });
      if (!r || r.skipped) return;
      if (r.ok) toast('success', t('providerDialog.discovered', { count: r.count, name: provider.name }));
      else toast('warning', t('providerDialog.discoveryFailed', { error: r.error ?? '' }));
    } catch (e) {
      toast('warning', t('providerDialog.discoveryFailed', { error: (e as Error).message }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      let warnings: string[];
      if (editing) {
        ({ warnings } = await api.updateCredential(editing.id, {
          label: label.trim() !== editing.label ? label.trim() : undefined,
          values: payload(),
        }));
        toast('success', t('providerDialog.updated', { name: provider.name, label }));
      } else {
        ({ warnings } = await api.createCredential({ providerId: provider.id, label: label.trim() || 'default', values }));
        toast('success', t('providerDialog.saved', { name: provider.name }));
      }
      warnings.forEach((w) => toast('warning', w));
      reset(null);
      changed();
      await discover();
      changed();
    } catch (err) {
      showIssues(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: CredentialSummary) {
    try {
      await api.updateCredential(c.id, { enabled: !c.enabled });
      changed();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  async function retest(c: CredentialSummary) {
    try {
      const r = await api.testCredential(c.id);
      toast(r.status === 'connected' ? 'success' : r.status === 'failed' ? 'error' : 'warning', `${c.label}: ${r.message}`);
      changed();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  async function remove(c: CredentialSummary) {
    try {
      await api.deleteCredential(c.id);
      toast('success', t('providerDialog.deleted', { label: c.label }));
      if (editing?.id === c.id) reset(null);
      changed();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  const fieldInput = (f: ProviderField) => {
    const isSecret = f.kind === 'secret';
    const keep = editing && isSecret && editing.secretFields.includes(f.key);
    return (
      <Field key={f.key} label={`${f.label}${f.required ? '' : ` (${t('common.optional')})`}`} hint={keep ? t('providerDialog.secretKeepHint') : f.help} error={errors[f.key]}>
        {f.kind === 'select' ? (
          <select
            value={values[f.key] ?? ''}
            onChange={(e) => edit(f.key, e.target.value)}
            className="h-8 w-full rounded-lg bg-bg2 px-2.5 text-[13px] text-fg focus:bg-elevated focus:outline-none"
          >
            <option value="">—</option>
            {f.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : (
          <Input
            mono={isSecret || f.kind === 'url'}
            type={isSecret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={keep ? '••••••••••••••••' : f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => edit(f.key, e.target.value)}
            aria-invalid={Boolean(errors[f.key])}
          />
        )}
      </Field>
    );
  };

  const TestBanner = () => {
    if (!test) return null;
    const ok = test.status === 'connected';
    const Icon = ok ? CheckCircle2 : test.status === 'failed' ? XCircle : AlertTriangle;
    return (
      <div
        role="status"
        className={`flex items-start gap-2.5 rounded-xl p-3 ${
          ok ? 'bg-primary/10 text-fg' : test.status === 'failed' ? 'bg-err/10 text-fg' : 'bg-warn/10 text-fg'
        }`}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-ok' : test.status === 'failed' ? 'text-err' : 'text-warn'}`} aria-hidden />
        <div className="text-xs">
          <span className="font-semibold">{test.message}</span>
          {test.latencyMs !== null && <span className="font-mono text-muted"> · {test.latencyMs} ms</span>}
          {test.status === 'failed' && (
            <div className="mt-1 text-fg2">{t('providerDialog.testFailedHint')}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open onClose={onClose} title={t('providerDialog.title', { name: provider.name })} wide>
        <div className="grid gap-0 md:grid-cols-[1fr_1.3fr]">
          {/* Left panel: Info & Credential list */}
          <div className="p-5 bg-bg2/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <ProviderLogoBadge id={provider.id} name={provider.name} size="md" />
                <div>
                  <h3 className="font-bold text-base text-fg">{provider.name}</h3>
                  <span className="font-mono text-xs text-muted">{provider.id}</span>
                </div>
              </div>

              <p className="mb-5 text-xs leading-relaxed text-fg2">{provider.description}</p>

              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('providerDialog.savedCreds')}</h4>
              {creds.loading && !creds.data ? (
                <Spinner />
              ) : creds.data?.length ? (
                <ul className="space-y-2.5">
                  {creds.data.map((c) => (
                    <li key={c.id} className="rounded-xl bg-card p-3 transition-colors hover:bg-elevated/60">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium text-xs text-fg">
                          <StatusDot
                            status={!c.enabled ? 'disabled' : c.lastCheck?.status === 'connected' ? 'connected' : c.lastCheck?.status === 'failed' ? 'error' : 'configured'}
                          />
                          {c.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void retest(c)}
                            aria-label={`${t('common.test')} ${c.label}`}
                            title={t('providerDialog.testConnection')}
                            className="rounded-lg p-1 text-fg2 transition-colors hover:bg-elevated hover:text-primary"
                          >
                            <Zap className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => reset(c)}
                            aria-label={`${t('common.edit')} ${c.label}`}
                            title={t('common.edit')}
                            className="rounded-lg p-1 text-fg2 transition-colors hover:bg-elevated hover:text-fg"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void toggle(c)}
                            aria-label={c.enabled ? t('common.disable') : t('common.enable')}
                            title={c.enabled ? t('common.disable') : t('common.enable')}
                            className="rounded-lg p-1 text-fg2 transition-colors hover:bg-elevated hover:text-fg"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setToDelete(c)}
                            aria-label={`${t('common.delete')} ${c.label}`}
                            title={t('common.delete')}
                            className="rounded-lg p-1 text-err transition-colors hover:bg-err/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between">
                        <Mono>{c.maskedKey ?? t('providerDialog.noApiKey')}</Mono>
                        {c.lastCheck && (
                          <span className={`text-[10px] ${c.lastCheck.status === 'connected' ? 'text-ok' : 'text-err'}`}>
                            {c.lastCheck.status === 'connected' ? t('providerDialog.ok') : t('providerDialog.failed')} · {ago(c.lastCheck.checkedAt)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl bg-card/60 p-4 text-center text-xs text-fg2">
                  {t('providerDialog.noCreds')}
                </div>
              )}
            </div>

            {provider.docsUrl && (
              <div className="mt-6 pt-3">
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  {t('providerDialog.docs')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Right panel: Credential Form */}
          <form onSubmit={(e) => void submit(e)} className="space-y-3.5 p-6 bg-card">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {editing ? t('providerDialog.editing', { label: editing.label }) : t('providerDialog.addNew')}
              </h3>
              {editing && (
                <button
                  type="button"
                  onClick={() => reset(null)}
                  className="text-xs text-primary hover:underline"
                >
                  {t('providerDialog.cancelEdit')}
                </button>
              )}
            </div>

            <Field label={t('providerDialog.labelField')} hint={t('providerDialog.labelHint')} error={errors['label']}>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('providerDialog.labelPlaceholder')}
                maxLength={60}
                required
              />
            </Field>

            {provider.fields.map(fieldInput)}

            <TestBanner />

            <div className="flex items-center justify-between pt-3">
              <Button type="button" variant="secondary" loading={testing} onClick={() => void runTest()}>
                <Zap className="h-3.5 w-3.5 text-primary" /> {t('providerDialog.testConnection')}
              </Button>

              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={busy}>
                  {editing ? t('providerDialog.updateCredential') : t('providerDialog.saveSecurely')}
                </Button>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-muted">
              {t('providerDialog.vaultNote')}
            </p>
          </form>
        </div>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={t('providerDialog.deleteTitle')}
        confirmLabel={t('common.delete')}
        message={t('providerDialog.deleteMsg', { label: toDelete?.label ?? '', name: provider.name })}
        onConfirm={() => toDelete && void remove(toDelete)}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
