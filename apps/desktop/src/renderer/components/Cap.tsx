import { Check, HelpCircle, X } from 'lucide-react';
import type { CapabilityState } from '@cameleon/shared';
import { useI18n } from '../i18n';

const meta = {
  supported: { Icon: Check, cls: 'text-ok', key: 'common.supported' },
  unsupported: { Icon: X, cls: 'text-muted', key: 'common.notSupported' },
  unknown: { Icon: HelpCircle, cls: 'text-muted', key: 'common.unknownCaps' },
} as const;

/** Three-state capability marker. Never colour-only: icon shape + accessible label. */
export function Cap({ state, withLabel }: { state: CapabilityState; withLabel?: boolean }) {
  const { t } = useI18n();
  const { Icon, cls, key } = meta[state];
  const label = t(key);
  return (
    <span className={`inline-flex items-center gap-1.5 ${cls}`} title={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {withLabel ? <span className="text-fg2">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

export const fmtTokens = (n: number | null): string => {
  if (n === null) return '–';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
};
