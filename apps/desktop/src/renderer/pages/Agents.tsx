import { useState } from 'react';
import { Bot, Plus, RefreshCw, Rocket, Save, ScanSearch, Trash2, Wrench } from 'lucide-react';
import { EngineError, type AgentView, type LaunchPlan, type ProfileView, type Protocol } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { CompatBadge, Reasons } from '../components/CompatBadge';
import { SelectionPicker, type Selection } from '../components/SelectionPicker';
import { Badge, Button, Card, CodeBlock, Dialog, ErrorState, Field, Input, Mono, Spinner, StatusDot, useToast } from '../components/ui';
import { ProviderLogoBadge } from '../components/ProviderLogo';
import { useI18n } from '../i18n';
import { useTerminal } from '../terminal-context';

/** Ask where the agent should work (coding agents act on that folder), then open the system terminal. */
export async function launchInTerminal(
  toast: ReturnType<typeof useToast>,
  req: Parameters<Window['cameleon']['terminal']['open']>[0] extends infer R ? (R extends { cwd?: string } ? Omit<R, 'cwd'> : never) : never,
): Promise<{ manual?: string } | null> {
  const cwd = await window.cameleon.dialog.chooseFolder();
  if (!cwd) return null;
  const r = await window.cameleon.terminal.open({ ...req, cwd } as never);
  if (r.ok) {
    toast('success', 'Terminal opened — the agent is initializing in your workspace.');
    return null;
  }
  toast('warning', r.error ?? 'Could not open a terminal');
  return { manual: r.manual };
}

export function Agents({ onNavigate }: { onNavigate: (p: 'providers' | 'profiles') => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const { requestLaunch } = useTerminal();
  const [tick, setTick] = useState(0);
  const q = useQuery(async () => {
    const [agents, profiles] = await Promise.all([api.agents(tick > 0), api.profiles()]);
    return { agents, profiles };
  }, [tick]);
  const [dialog, setDialog] = useState<{ agent: AgentView; kind: 'configure' | 'install' } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  if (q.loading && !q.data) return <Spinner label={t('agents.scanning')} />;
  if (q.error || !q.data) return <ErrorState message={q.error ?? t('common.noData')} onRetry={q.reload} />;
  const { agents, profiles } = q.data;
  const activeFor = (a: AgentView): ProfileView | undefined => profiles.find((p) => p.active && p.agentId === a.id);

  function quickLaunch(a: AgentView) {
    const p = activeFor(a);
    if (!p) {
      setDialog({ agent: a, kind: 'configure' });
      return;
    }
    requestLaunch({ kind: 'profile', name: p.name }, { title: `${a.name} · ${p.name}`, onManual: setManual });
  }

  return (
    <div className="max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('agents.title')}</h1>
            <Badge variant="default">{t('agents.detectedCount', { n: agents.length })}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">
            {t('agents.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> {t('agents.addCustom')}
          </Button>
          <Button variant="secondary" onClick={() => setTick((n) => n + 1)}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('agents.scan')}
          </Button>
        </div>
      </header>

      {manual && (
        <div role="note" className="space-y-2 rounded-xl bg-card p-4">
          <p className="text-xs text-fg2">{t('agents.manualHint')}</p>
          <CodeBlock>{manual}</CodeBlock>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const p = activeFor(a);
          return (
            <Card key={a.id} hoverable className="flex flex-col justify-between p-5 transition-all">
              <div>
                <div className="flex items-start gap-3">
                  <ProviderLogoBadge id={a.id} name={a.name} size="md" active={a.installed} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-fg">{a.name}</div>
                    <div className="mt-0.5 text-xs text-fg2 line-clamp-2">{a.description}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-fg2">
                    <StatusDot status={a.installed ? 'running' : 'stopped'} />
                    {a.installed ? t('agents.installed') : t('agents.notInstalled')}
                  </span>
                  {a.custom && <Badge variant="default">{t('agents.customBadge')}</Badge>}
                  {a.version && <Badge variant="success">{a.version}</Badge>}
                  {a.protocols.map((x) => (
                    <Badge key={x}>{x}</Badge>
                  ))}
                  {!a.osSupported && <Badge variant="warn">{t('agents.unsupportedOs')}</Badge>}
                </div>

                {a.path && (
                  <div className="mt-2.5 truncate font-mono text-[11px] text-muted" title={a.path}>
                    {a.path}
                  </div>
                )}
                {a.osNote && <p className="mt-2 text-xs text-warn">{a.osNote}</p>}

                {p && (
                  <div className="mt-3 rounded-lg bg-bg2/60 p-2.5 text-xs text-fg2">
                    {t('agents.activeProfile')}: <span className="font-semibold text-primary">{p.name}</span>{' '}
                    <span className="text-muted font-mono text-[11px]">({p.modelId})</span>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2 pt-3.5">
                <Button
                  variant="primary"
                  disabled={!a.installed || !a.osSupported}
                  title={a.installed ? undefined : t('agents.installFirst')}
                  onClick={() => void quickLaunch(a)}
                >
                  <Rocket className="h-3.5 w-3.5" /> {t('common.launch')}
                </Button>
                <Button variant="secondary" onClick={() => setDialog({ agent: a, kind: 'configure' })}>
                  <Wrench className="h-3.5 w-3.5" /> {t('common.configure')}
                </Button>
                <Button variant="ghost" onClick={() => setDialog({ agent: a, kind: 'configure' })}>
                  <ScanSearch className="h-3.5 w-3.5" /> {t('common.inspect')}
                </Button>
                {!a.installed && (
                  <Button variant="ghost" onClick={() => setDialog({ agent: a, kind: 'install' })}>
                    {t('agents.installGuide')}
                  </Button>
                )}
                {a.custom && (
                  <Button
                    variant="ghost"
                    className="text-err hover:bg-err/10"
                    onClick={() => {
                      void api.deleteCustomAgent(a.id).then(() => {
                        toast('success', t('agents.customDeleted'));
                        q.reload();
                      }).catch((e) => toast('error', (e as Error).message));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t('agents.deleteCustom')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        {t('agents.needKeys')} <button className="text-primary underline hover:text-primary-hover" onClick={() => onNavigate('providers')}>{t('agents.connectProviders')}</button> · {t('agents.savedProfiles')} <button className="text-primary underline hover:text-primary-hover" onClick={() => onNavigate('profiles')}>{t('overview.manageProfiles')}</button>
      </p>

      {dialog?.kind === 'install' && <InstallDialog agent={dialog.agent} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'configure' && (
        <AgentDialog agent={dialog.agent} onClose={() => setDialog(null)} onSaved={q.reload} onManual={setManual} />
      )}
      {addOpen && (
        <AddCustomAgentDialog
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            setTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function AddCustomAgentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [binary, setBinary] = useState('');
  const [protocols, setProtocols] = useState<Protocol[]>(['openai', 'anthropic']);
  const [modelFlag, setModelFlag] = useState('');
  const [description, setDescription] = useState('');
  const [envText, setEnvText] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleProto = (p: Protocol) => {
    setProtocols((prev) => (prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]));
  };

  async function submit() {
    if (!name.trim() || !binary.trim()) return;
    setBusy(true);
    try {
      const envTemplate: Record<string, string> = {};
      for (const line of envText.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (k) envTemplate[k] = v;
        }
      }
      await api.createCustomAgent({
        name: name.trim(),
        binary: binary.trim(),
        protocols,
        modelFlag: modelFlag.trim(),
        description: description.trim(),
        envTemplate,
      });
      toast('success', t('agents.customCreated'));
      onSaved();
    } catch (e) {
      toast('error', e instanceof EngineError && e.issues?.length ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t('agents.customModalTitle')} wide>
      <div className="space-y-4 p-6">
        <p className="text-xs leading-relaxed text-fg2">{t('agents.customModalHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('agents.customName')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aider / Gemini CLI / Goose" maxLength={60} />
          </Field>
          <Field label={t('agents.customBinary')} hint={t('agents.customBinaryHint')}>
            <Input value={binary} onChange={(e) => setBinary(e.target.value)} placeholder="aider" maxLength={200} />
          </Field>
        </div>
        <Field label={t('agents.customProtocols')}>
          <div className="flex flex-wrap gap-2 pt-1">
            {(['openai', 'anthropic', 'gemini'] as Protocol[]).map((p) => {
              const active = protocols.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleProto(p)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-primary text-primary-fg' : 'bg-bg2 text-fg2 hover:bg-elevated'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('agents.customModelFlag')} hint={t('agents.customModelFlagHint')}>
            <Input value={modelFlag} onChange={(e) => setModelFlag(e.target.value)} placeholder="--model" maxLength={40} />
          </Field>
          <Field label={t('agents.customDesc')}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="AI pair programming in your terminal" maxLength={400} />
          </Field>
        </div>
        <Field label={t('agents.customEnvVars')} hint={t('agents.customEnvHint')}>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={3}
            placeholder={'AIDER_MODEL={{model}}\nOPENAI_API_BASE={{baseUrl}}'}
            className="w-full rounded-lg bg-bg2 px-3 py-2 font-mono text-xs text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 px-6 py-3.5 bg-bg2/40">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!name.trim() || !binary.trim()} loading={busy} onClick={() => void submit()}>
          <Plus className="h-3.5 w-3.5" /> {t('agents.addCustom')}
        </Button>
      </div>
    </Dialog>
  );
}

function InstallDialog({ agent, onClose }: { agent: AgentView; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onClose={onClose} title={t('agents.installTitle', { name: agent.name })}>
      <div className="space-y-4 p-6">
        <p className="text-xs leading-relaxed text-fg2">{agent.install.summary}</p>
        <div className="space-y-2">
          {agent.install.commands.map((c) => (
            <CodeBlock key={c}>{c}</CodeBlock>
          ))}
        </div>
        {agent.install.url && (
          <p className="text-xs text-muted">
            {t('agents.officialUrl')} <Mono>{agent.install.url}</Mono>
          </p>
        )}
        <p className="text-xs text-muted">{t('agents.afterInstall')}</p>
      </div>
      <div className="flex justify-end px-6 py-3.5 bg-bg2/40">
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Dialog>
  );
}

function AgentDialog({
  agent,
  onClose,
  onSaved,
  onManual,
}: {
  agent: AgentView;
  onClose: () => void;
  onSaved: () => void;
  onManual: (c: string) => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const { requestLaunch } = useTerminal();
  const [sel, setSel] = useState<Selection | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = useQuery<LaunchPlan | { error: string } | null>(async () => {
    if (!sel) return null;
    try {
      return await api.inspectLaunch({ agentId: agent.id, providerId: sel.providerId, modelId: sel.modelId });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [agent.id, sel?.providerId, sel?.modelId]);
  const p = plan.data && 'summary' in plan.data ? plan.data : null;
  const blocked = !p || p.compat.status === 'incompatible';

  async function save() {
    if (!sel) return;
    setBusy(true);
    try {
      await api.createProfile({ name: name.trim(), agentId: agent.id, providerId: sel.providerId, modelId: sel.modelId });
      toast('success', t('profiles.saved', { name: name.trim() }));
      setName('');
      onSaved();
    } catch (e) {
      toast('error', e instanceof EngineError && e.issues?.length ? e.issues.map((i) => i.message).join(' · ') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function launch() {
    if (!sel) return;
    onClose();
    requestLaunch(
      { kind: 'launch', agentId: agent.id, providerId: sel.providerId, modelId: sel.modelId },
      { title: `${agent.name} · ${sel.providerId}`, onManual },
    );
  }

  return (
    <Dialog open onClose={onClose} title={t('agents.configureTitle', { name: agent.name })} wide>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-3.5 p-6 bg-bg2/40">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{t('agents.selectProviderModel')}</h3>
          <SelectionPicker agentId={agent.id} value={sel} onChange={setSel} />
        </div>
        <div className="space-y-3.5 p-6 bg-card">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{t('agents.configPreview')}</h3>
          {!sel ? (
            <p className="text-xs text-fg2">{t('agents.selectPrompt')}</p>
          ) : plan.loading && !plan.data ? (
            <Spinner />
          ) : plan.data && 'error' in plan.data ? (
            <p role="alert" className="text-xs text-err">{plan.data.error}</p>
          ) : (
            p && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-fg">
                    {p.summary.providerName} · {p.summary.protocol}
                  </span>
                  <CompatBadge compat={p.compat} />
                </div>
                <Reasons compat={p.compat} />
                <dl className="space-y-1.5 text-xs">
                  <div>
                    <dt className="text-muted">{t('agents.endpoint')}</dt>
                    <dd className="font-mono text-fg">{p.summary.baseUrl}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('agents.credential')}</dt>
                    <dd className="text-fg">{p.summary.credentialLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('agents.command')}</dt>
                    <dd className="break-all font-mono text-fg">
                      {p.command} {p.args.join(' ')}
                    </dd>
                  </div>
                </dl>
                <div>
                  <div className="mb-1 text-xs text-muted">{t('agents.injectedEnv')}</div>
                  <div className="max-h-32 overflow-y-auto rounded-lg bg-bg2 p-2.5 font-mono text-xs">
                    {Object.entries(p.env).map(([k, v]) => (
                      <div key={k} className="break-all">
                        <span className="text-fg2">{k}</span>=
                        {p.secretEnvKeys.includes(k) ? <span className="text-muted">{v}</span> : v}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 bg-bg2/40">
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('profiles.nameLabel')}
            placeholder={t('agents.saveAsProfile')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-48"
            maxLength={60}
          />
          <Button disabled={!sel || !name.trim()} loading={busy} onClick={() => void save()}>
            <Save className="h-3.5 w-3.5" /> {t('agents.saveProfile')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button
            variant="primary"
            disabled={blocked || !agent.installed}
            title={!agent.installed ? t('agents.installFirst') : blocked ? t('agents.incompatibleHint') : undefined}
            onClick={() => void launch()}
          >
            <Rocket className="h-3.5 w-3.5" /> {t('agents.launchInTerminal')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
export { Bot, Field };
