import { useState } from 'react';
import { Layers, Pencil, Play, Plus, Power, Rocket, Trash2, ArrowRight } from 'lucide-react';
import { EngineError, type ProfileView } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { CompatBadge, Reasons } from '../components/CompatBadge';
import { SelectionPicker, type Selection } from '../components/SelectionPicker';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, Spinner, StatusDot, useToast } from '../components/ui';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';
import { useTerminal } from '../terminal-context';

const splitArgs = (s: string): string[] =>
  (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));

export function Profiles() {
  const toast = useToast();
  const { t } = useI18n();
  const { requestLaunch } = useTerminal();
  const q = useQuery(async () => ({ profiles: await api.profiles(), agents: await api.agents() }));
  const [editing, setEditing] = useState<ProfileView | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<ProfileView | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  if (q.loading && !q.data) return <Spinner label={t('profiles.loading')} />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? t('common.noData')} onRetry={q.reload} />;
  const { profiles, agents } = q.data;

  const activate = async (p: ProfileView) => {
    try {
      await api.activateProfile(p.active ? null : p.id);
      q.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const launch = (p: ProfileView) => {
    requestLaunch(
      { kind: 'profile', name: p.name, cwd: p.projectPath ?? undefined },
      { title: p.name, defaultCwd: p.projectPath ?? undefined, onManual: setManual },
    );
  };

  const remove = async (p: ProfileView) => {
    try {
      await api.deleteProfile(p.id);
      toast('success', t('profiles.deleted', { name: p.name }));
      q.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('profiles.title')}</h1>
            <Badge variant="default">{t('profiles.savedCount', { n: profiles.length })}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">
            {t('profiles.subtitle')} <span className="font-mono text-primary font-semibold">cameleon launch</span>
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" /> {t('profiles.create')}
        </Button>
      </header>

      {manual && (
        <div role="note" className="rounded-xl bg-card p-4 text-xs text-fg2">
          {t('profiles.runInTerminal')} <span className="font-mono text-primary">{manual}</span>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" />} title={t('profiles.emptyTitle')}>
          {t('profiles.emptyHint')}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {profiles.map((p) => {
            const agent = agents.find((a) => a.id === p.agentId);
            return (
              <Card
                key={p.id}
                hoverable
                className="flex flex-col justify-between p-5 transition-all bg-card"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        <ProviderLogoBadge id={p.agentId} name={agent?.name} size="sm" />
                        <ProviderLogoBadge id={p.providerId} name={p.providerName ?? undefined} size="sm" active={p.active} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-bold text-sm text-fg">{p.name}</h3>
                          {p.active && <Badge variant="success">{t('common.active')}</Badge>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg2">
                          <span>{agent?.name ?? p.agentId}</span>
                          <ArrowRight className="h-3 w-3 text-muted" />
                          <span className="font-medium text-fg">{p.providerName ?? p.providerId}</span>
                        </div>
                      </div>
                    </div>

                    <CompatBadge compat={p.compat} />
                  </div>

                  <div className="mt-3.5 rounded-lg bg-bg2/60 p-2.5">
                    <div className="text-[11px] text-muted">{t('profiles.modelIdentifier')}</div>
                    <div className="truncate font-mono text-xs font-semibold text-fg" title={p.modelId}>
                      {p.modelId}
                    </div>
                  </div>

                  {p.launchArgs.length > 0 && (
                    <div className="mt-2 font-mono text-[11px] text-muted truncate">
                      args: {p.launchArgs.join(' ')}
                    </div>
                  )}

                  {p.projectPath && (
                    <div className="mt-1 truncate text-xs text-muted" title={p.projectPath}>
                      project: {p.projectPath}
                    </div>
                  )}

                  {p.compat.status !== 'compatible' && (
                    <div className="mt-2">
                      <Reasons compat={p.compat} />
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 pt-3.5">
                  <Button
                    variant={p.active ? 'secondary' : 'primary'}
                    onClick={() => void activate(p)}
                  >
                    <Power className="h-3.5 w-3.5" /> {p.active ? t('profiles.deactivate') : t('profiles.setActive')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={p.compat.status === 'incompatible'}
                    onClick={() => void launch(p)}
                  >
                    <Rocket className="h-3.5 w-3.5" /> {t('common.launch')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(p)}>
                    <Pencil className="h-3.5 w-3.5" /> {t('common.edit')}
                  </Button>
                  <Button variant="ghost" className="text-err hover:bg-err/10" onClick={() => setToDelete(p)}>
                    <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <ProfileDialog
          initial={editing === 'new' ? null : editing}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            q.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={t('profiles.deleteTitle')}
        confirmLabel={t('common.delete')}
        message={t('profiles.deleteMsg', { name: toDelete?.name ?? '' })}
        onConfirm={() => toDelete && void remove(toDelete)}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}

function ProfileDialog({
  initial,
  agents,
  onClose,
  onSaved,
}: {
  initial: ProfileView | null;
  agents: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [agentId, setAgentId] = useState(initial?.agentId ?? agents[0]?.id ?? '');
  const [sel, setSel] = useState<Selection | null>(
    initial ? { providerId: initial.providerId, modelId: initial.modelId } : null,
  );
  const [label, setLabel] = useState(initial?.credentialLabel ?? '');
  const [args, setArgs] = useState(initial?.launchArgs.join(' ') ?? '');
  const [project, setProject] = useState(initial?.projectPath ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const creds = useQuery(async () => (sel ? api.credentials(sel.providerId) : []), [sel?.providerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) {
      setErrors({ modelId: t('profiles.chooseModelErr') });
      return;
    }
    setBusy(true);
    setErrors({});
    const body = {
      name: name.trim(),
      agentId,
      providerId: sel.providerId,
      modelId: sel.modelId,
      credentialLabel: label || null,
      launchArgs: splitArgs(args),
      projectPath: project.trim() || null,
    };
    try {
      if (initial) await api.updateProfile(initial.id, body);
      else await api.createProfile(body);
      toast('success', t('profiles.saved', { name: body.name }));
      onSaved();
    } catch (err) {
      if (err instanceof EngineError && err.issues?.length)
        setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      else setErrors({ name: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={initial ? t('profiles.editTitle', { name: initial.name }) : t('profiles.createTitle')} wide>
      <form onSubmit={(e) => void submit(e)}>
        <div className="grid gap-0 md:grid-cols-2">
          <div className="space-y-4 p-6 bg-bg2/30">
            <Field label={t('profiles.nameLabel')} hint={t('profiles.nameHint')} error={errors['name']}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('profiles.namePlaceholder')}
                required
                maxLength={60}
              />
            </Field>

            <Field label={t('profiles.agentTarget')}>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-8 w-full rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('profiles.extraArgs')} hint={t('profiles.extraArgsHint')}>
              <Input
                mono
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--verbose --no-telemetry"
              />
            </Field>

            <Field label={t('profiles.workDir')}>
              <Input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="/path/to/my/workspace"
              />
            </Field>
          </div>

          <div className="space-y-4 p-6 bg-card">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{t('profiles.providerModel')}</div>
              <SelectionPicker agentId={agentId} value={sel} onChange={setSel} />
              {errors['modelId'] && <p className="mt-1 text-xs text-err">{errors['modelId']}</p>}
            </div>

            {sel && creds.data && creds.data.length > 1 && (
              <Field label={t('profiles.credToUse')} hint={t('profiles.credToUseHint')}>
                <select
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="h-8 w-full rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
                >
                  <option value="">{t('profiles.defaultCred')}</option>
                  {creds.data.map((c) => (
                    <option key={c.id} value={c.label}>
                      {c.label} ({c.maskedKey ?? t('providerDialog.noApiKey')})
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-3.5 bg-bg2/40">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {initial ? t('profiles.saveChanges') : t('profiles.createBtn')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
