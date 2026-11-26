import { useEffect, useState } from 'react';
import { RefreshCw, Stethoscope, Trash2, ShieldCheck, Cpu, Terminal, Moon, Sun, Monitor } from 'lucide-react';
import type { DiagnosticCheck } from '@cameleon/shared';
import { api } from '../api';
import { useQuery } from '../hooks';
import { useTheme, type ThemeChoice } from '../theme';
import { useI18n, LANGUAGES, type SupportedLanguage } from '../i18n';
import { Button, Card, CodeBlock, ConfirmDialog, Dialog, ErrorState, Mono, Spinner, cx, useToast, Badge } from '../components/ui';

const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-6 py-2.5">
    <div>
      <div className="text-xs font-medium text-fg">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
    <div className="text-right">{children}</div>
  </div>
);

const Section = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => (
  <Card className="p-5">
    <div className="flex items-center gap-2 mb-3 pb-1">
      {icon}
      <h2 className="text-sm font-bold tracking-tight text-fg">{title}</h2>
    </div>
    <div className="space-y-2">{children}</div>
  </Card>
);

const Toggle = ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) => (
  <input
    type="checkbox"
    aria-label={label}
    className="h-4 w-4 rounded accent-[var(--primary)] cursor-pointer disabled:cursor-not-allowed"
    checked={checked}
    disabled={disabled}
    onChange={(e) => onChange(e.target.checked)}
  />
);

const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
  getLabel,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  label: string;
  getLabel?: (v: T) => string;
}) => (
  <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-bg2 p-1">
    {options.map((o) => {
      const active = value === o;
      return (
        <button
          key={o}
          role="radio"
          aria-checked={active}
          onClick={() => onChange(o)}
          className={cx(
            'h-7 rounded-lg px-3 text-xs font-medium capitalize transition-all',
            active
              ? 'bg-elevated text-primary shadow-sm font-semibold'
              : 'text-fg2 hover:text-fg hover:bg-elevated/60',
          )}
        >
          {getLabel ? getLabel(o) : o}
        </button>
      );
    })}
  </div>
);

const DENSITY_KEY = 'cameleon.density';
export const applyDensity = (d: string) => {
  document.documentElement.dataset['density'] = d;
};
export const storedDensity = (): 'comfortable' | 'compact' => {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
};

export function SettingsPage() {
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const { language, setLanguage, t } = useI18n();
  const [density, setDensity] = useState(storedDensity);
  const status = useQuery(() => api.status());
  const agents = useQuery(() => api.agents());
  const [settings, setSettings] = useState<CameleonSettings | null>(null);
  const [sys, setSys] = useState<Awaited<ReturnType<Window['cameleon']['system']['info']>>>(null);
  const [port, setPort] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCache, setConfirmCache] = useState(false);

  useEffect(() => {
    void window.cameleon.settings.get().then(setSettings);
    void window.cameleon.system.info().then(setSys);
    void window.cameleon.engine.ensure().then((r) => setPort(r.port ?? null));
  }, []);

  const patch = (p: Partial<CameleonSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    void window.cameleon.settings.set(p).then((s) => s && setSettings(s));
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const s = status.data;

  return (
    <div className="max-w-4xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">{t('settings.title')}</h1>
            <Badge variant="default">{t('settings.badge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg2">{t('settings.subtitle')}</p>
        </div>
      </header>

      {/* Appearance */}
      <Section title={t('settings.appearance')} icon={<Moon className="h-4 w-4 text-primary" />}>
        <Row label={t('settings.theme')} hint={t('settings.themeHint')}>
          <Segmented<ThemeChoice>
            label={t('settings.theme')}
            value={theme}
            options={['dark', 'light', 'system']}
            onChange={setTheme}
            getLabel={(o) => t(`settings.opt.${o}`)}
          />
        </Row>
        <Row label={t('settings.density')}>
          <Segmented<'comfortable' | 'compact'>
            label={t('settings.density')}
            value={density}
            options={['comfortable', 'compact']}
            getLabel={(o) => t(`settings.opt.${o}`)}
            onChange={(d) => {
              setDensity(d);
              applyDensity(d);
              try {
                localStorage.setItem(DENSITY_KEY, d);
              } catch {
                /* ignore */
              }
            }}
          />
        </Row>
      </Section>

      {/* General */}
      <Section title={t('settings.general')}>
        <Row label={t('settings.language')} hint={t('settings.languageHint')}>
          <select
            aria-label={t('settings.language')}
            value={language}
            onChange={(e) => {
              const next = e.target.value as SupportedLanguage;
              setLanguage(next);
              patch({ language: next });
            }}
            className="h-8 rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none cursor-pointer"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.native} — {lang.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.launchAtLogin')} hint={t('settings.launchAtLoginHint')}>
          <Toggle
            label={t('settings.launchAtLogin')}
            checked={settings?.launchAtLogin ?? false}
            disabled={!settings || window.cameleon.platform === 'linux'}
            onChange={(v) => patch({ launchAtLogin: v })}
          />
        </Row>
        <Row label={t('settings.keepEngine')} hint={t('settings.keepEngineHint')}>
          <Toggle
            label={t('settings.keepEngine')}
            checked={settings?.keepEngineRunning ?? true}
            disabled={!settings}
            onChange={(v) => patch({ keepEngineRunning: v })}
          />
        </Row>
        <Row label={t('settings.defaultAgent')}>
          <select
            aria-label={t('settings.defaultAgent')}
            value={settings?.defaultAgent ?? ''}
            onChange={(e) => patch({ defaultAgent: e.target.value || null })}
            className="h-8 rounded-lg bg-bg2 px-2.5 text-xs text-fg focus:bg-elevated focus:outline-none"
          >
            <option value="">{t('common.noneSelected')}</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      {status.loading && !s ? (
        <Spinner />
      ) : status.error || !s ? (
        <ErrorState message={status.error ?? t('settings.engineUnavailable')} onRetry={status.reload} />
      ) : (
        <>
          {/* Engine */}
          <Section title={t('settings.localEngine')} icon={<Cpu className="h-4 w-4 text-primary" />}>
            <Row label={t('settings.status')}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ok">
                <span className="h-2 w-2 rounded-full bg-primary" /> {t('nav.engine.running')}
              </span>
            </Row>
            <Row label={t('settings.engineVersion')}>
              <Mono>v{s.engine.version}</Mono>
            </Row>
            <Row label={t('settings.loopbackPort')} hint={t('settings.loopbackHint')}>
              <Mono>{port !== null ? `127.0.0.1:${port}` : '–'}</Mono>
            </Row>
            <Row label={t('settings.processPid')}>
              <Mono>{s.engine.pid}</Mono>
            </Row>
            <Row label={t('settings.hostRuntime')}>
              <Mono>Node {s.host.node} · {s.host.platform}</Mono>
            </Row>
            <Row label={t('settings.maintenance')}>
              <div className="flex gap-2">
                <Button
                  loading={busy === 'restart'}
                  onClick={() =>
                    void run('restart', async () => {
                      const r = await window.cameleon.engine.restart();
                      if (!r.running) throw new Error(r.error ?? 'Restart failed');
                      setPort(r.port ?? null);
                      toast('success', t('settings.restartedToast'));
                      status.reload();
                    })
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t('settings.restart')}
                </Button>
                <Button loading={busy === 'logs'} onClick={() => void run('logs', async () => setLogs(await window.cameleon.engine.logs(200)))}>
                  {t('settings.viewLogs')}
                </Button>
              </div>
            </Row>
          </Section>

          {/* Command Line */}
          <Section title={t('settings.cliTitle')} icon={<Terminal className="h-4 w-4 text-primary" />}>
            <Row label={t('settings.cliState')}>
              {sys?.cli.installed ? (
                <span className="font-semibold text-ok text-xs">{t('settings.cliOnPath')}</span>
              ) : (
                <span className="text-warn text-xs">{t('settings.cliNotFound')}</span>
              )}
            </Row>
            <Row label={t('settings.cliLocation')}>
              <Mono>{sys?.cli.path ?? sys?.cliBin ?? '–'}</Mono>
            </Row>
            <Row label={t('settings.cliShell')}>
              <span className="text-xs text-fg2">{sys?.cli.installed ? t('settings.cliConfigured') : t('settings.cliRunLink')}</span>
            </Row>
            {!sys?.cli.installed && (
              <div className="py-2">
                <CodeBlock>npm link -w @cameleon/cli</CodeBlock>
              </div>
            )}
          </Section>

          {/* Security */}
          <Section title={t('settings.securityTitle')} icon={<ShieldCheck className="h-4 w-4 text-primary" />}>
            <Row label={t('settings.credEnc')}>
              <span className="font-medium text-xs text-fg">
                {s.vault.osProtected ? `${t('overview.kpi.osKeychain')} (DPAPI / Keychain)` : 'Encrypted File Vault (AES-256-GCM)'}
              </span>
            </Row>
            <Row label={t('settings.vaultStatus')}>
              <Mono>{s.vault.detail}</Mono>
            </Row>
            <Row label={t('settings.netSurface')}>{t('settings.netSurfaceVal')}</Row>
            <Row label={t('settings.rendererIso')}>{t('settings.rendererIsoVal')}</Row>
          </Section>

          {/* Advanced */}
          <Section title={t('settings.diagTitle')}>
            <Row label={t('settings.localDb')}>
              <Mono>{s.database.path} (v{s.database.schemaVersion})</Mono>
            </Row>
            <Row label={t('settings.modelCache')} hint={t('settings.modelCacheHint')}>
              <Button variant="danger" onClick={() => setConfirmCache(true)}>
                <Trash2 className="h-3.5 w-3.5" /> {t('settings.clearCache')}
              </Button>
            </Row>
            <Row label={t('settings.selfDiag')}>
              <Button loading={busy === 'diag'} onClick={() => void run('diag', async () => setChecks(await api.diagnostics()))}>
                <Stethoscope className="h-3.5 w-3.5 text-primary" /> {t('settings.runCheckup')}
              </Button>
            </Row>
            {checks && (
              <ul className="space-y-2 py-3">
                {checks.map((c) => (
                  <li key={c.title} className="flex items-start gap-2 rounded-lg bg-bg2/60 p-2.5 text-xs">
                    <span className={c.level === 'ok' ? 'text-ok font-bold' : c.level === 'warn' ? 'text-warn font-bold' : 'text-err font-bold'}>
                      {c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'}
                    </span>
                    <div>
                      <div className="font-semibold text-fg">{c.title}</div>
                      {c.detail && <div className="mt-0.5 text-muted">{c.detail}</div>}
                      {c.fix && c.level !== 'ok' && <div className="mt-1 text-fg2 font-mono">→ {c.fix}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <ConfirmDialog
        open={confirmCache}
        title={t('settings.clearCacheTitle')}
        confirmLabel={t('settings.clearCache')}
        danger
        message={t('settings.clearCacheMsg')}
        onConfirm={() =>
          void run('cache', async () => {
            const r = await api.clearModelCache();
            toast('success', t('settings.clearedToast', { n: r.removed }));
            status.reload();
          })
        }
        onClose={() => setConfirmCache(false)}
      />

      <Dialog open={logs !== null} onClose={() => setLogs(null)} title={t('settings.logsTitle')} wide>
        <pre className="max-h-[60vh] overflow-auto p-5 font-mono text-xs bg-bg2 text-fg leading-relaxed">
          {logs?.length ? logs.join('\n') : t('settings.noLogs')}
        </pre>
        <div className="flex justify-end px-5 py-3.5 bg-bg2/40">
          <Button variant="primary" onClick={() => setLogs(null)}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
