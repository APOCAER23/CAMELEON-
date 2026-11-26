import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { CompatResult } from '@cameleon/shared';
import { useI18n } from '../i18n';

const meta = {
  compatible: { Icon: CheckCircle2, cls: 'text-ok', key: 'compat.compatible' },
  limited: { Icon: AlertTriangle, cls: 'text-warn', key: 'compat.limited' },
  untested: { Icon: HelpCircle, cls: 'text-muted', key: 'compat.untested' },
  incompatible: { Icon: XCircle, cls: 'text-err', key: 'compat.incompatible' },
} as const;

/** Four-state compatibility marker: icon shape + text, so colour is never the only signal. */
export function CompatBadge({ compat, status }: { compat?: CompatResult; status?: CompatResult['status'] }) {
  const { t } = useI18n();
  const s = status ?? compat!.status;
  const { Icon, cls, key } = meta[s];
  const title = compat?.reasons.map((r) => r.message).join('\n') || undefined;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium ${cls}`} title={title}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {t(key)}
    </span>
  );
}

export function Reasons({ compat }: { compat: CompatResult }) {
  if (!compat.reasons.length) return null;
  return (
    <ul className="space-y-1 text-xs text-fg2">
      {compat.reasons.map((r) => (
        <li key={r.code + r.message} className="flex gap-1.5">
          <span aria-hidden className={r.level === 'blocker' ? 'text-err' : r.level === 'limitation' ? 'text-warn' : 'text-muted'}>•</span>
          <span><span className="sr-only">{r.level}: </span>{r.message}</span>
        </li>
      ))}
    </ul>
  );
}
