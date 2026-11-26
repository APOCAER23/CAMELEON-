import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { useI18n } from '../i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ───── Button ───── */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent-outline';
const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary font-medium hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50',
  secondary:
    'bg-elevated text-fg hover:bg-elevated/80 active:scale-[0.98] disabled:opacity-50',
  ghost:
    'text-fg2 hover:bg-elevated hover:text-fg disabled:opacity-50',
  danger:
    'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50',
  'accent-outline':
    'bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.98] disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  loading,
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-all duration-150 disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ───── Field ───── */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg2 tracking-tight">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-err">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ mono, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...p}
      className={cx(
        'h-8 w-full rounded-lg bg-bg2 px-3 text-[13px] text-fg placeholder:text-muted transition-colors focus:bg-elevated focus:outline-none focus:ring-1 focus:ring-primary',
        mono && 'font-mono text-xs',
        className,
      )}
    />
  );
}

/* ───── Surfaces & status ───── */
export const Card = ({
  className,
  hoverable = false,
  children,
  ...rest
}: {
  className?: string;
  hoverable?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    {...rest}
    className={cx(
      'rounded-xl bg-card transition-all duration-200',
      hoverable && 'hover:bg-elevated/70',
      className,
    )}
  >
    {children}
  </div>
);

export function StatusDot({ status }: { status: string; pulse?: boolean }) {
  const isOk = status === 'configured' || status === 'connected' || status === 'running';
  const isWarn = status === 'disabled';
  const isErr = status === 'error' || status === 'stopped';

  const color = isOk ? 'bg-primary' : isWarn ? 'bg-amber-400' : isErr ? 'bg-rose-500' : 'bg-muted/70';

  return (
    <span className="inline-flex items-center justify-center">
      <span className={cx('inline-block h-2 w-2 rounded-full transition-colors', color)} aria-hidden />
    </span>
  );
}

export const Badge = ({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warn' | 'muted';
  className?: string;
}) => {
  const variantStyles = {
    default: 'bg-elevated/80 text-fg2',
    success: 'bg-primary/10 text-primary font-medium',
    warn: 'bg-amber-400/10 text-amber-400 font-medium',
    muted: 'bg-elevated/40 text-muted',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] transition-colors',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
};

export const Mono = ({ children }: { children: ReactNode }) => (
  <span className="rounded bg-elevated/80 px-1.5 py-0.5 font-mono text-xs text-fg2">{children}</span>
);

/* ───── States ───── */
export const Spinner = ({ label }: { label?: string }) => {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-12 text-fg2 font-medium text-xs">
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
};

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl bg-card p-5">
      <div className="flex items-center gap-2 text-err">
        <XCircle className="h-4 w-4" aria-hidden />
        <span className="font-semibold text-sm">{t('common.errorTitle')}</span>
      </div>
      <p className="text-fg2 text-[13px]">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-1">
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-card/60 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elevated/70 text-primary">
        {icon}
      </div>
      <div className="font-semibold text-sm tracking-tight text-fg">{title}</div>
      {children && <p className="max-w-md text-xs leading-relaxed text-fg2">{children}</p>}
    </div>
  );
}

/* ───── Dialog (native <dialog>: focus trap, Esc, backdrop) ───── */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cx(
        'm-auto w-full rounded-2xl bg-card/95 backdrop-blur-md p-0 text-fg shadow-2xl transition-all',
        wide ? 'max-w-3xl' : 'max-w-md',
      )}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-fg2 transition-colors hover:bg-elevated hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="px-5 py-4 text-[13px] leading-relaxed text-fg2">{message}</p>
      <div className="flex justify-end gap-2 px-5 py-3.5 bg-bg2/40">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}

/* ───── Toasts ───── */
interface ToastItem {
  id: number;
  kind: 'success' | 'warning' | 'error';
  text: string;
}
const ToastCtx = createContext<(kind: ToastItem['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 6000);
  }, []);
  const Icon = { success: CheckCircle2, warning: AlertTriangle, error: XCircle };
  const tone = { success: 'text-ok', warning: 'text-warn', error: 'text-err' };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2.5">
        {items.map((t) => {
          const I = Icon[t.kind];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-card/95 backdrop-blur-md p-3.5 shadow-lg shadow-black/20 transition-all"
            >
              <I className={cx('mt-0.5 h-4 w-4 shrink-0', tone[t.kind])} aria-hidden />
              <span className="text-[13px] text-fg leading-snug">{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───── Copy button ───── */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md bg-elevated/80 px-2.5 py-1 text-xs text-fg2 transition-colors hover:bg-elevated hover:text-fg"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {done ? <span className="text-primary font-medium">{t('common.copied')}</span> : (label ?? t('common.copy'))}
    </button>
  );
}

export const CodeBlock = ({ children }: { children: string }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg bg-bg2 px-3 py-2">
    <code className="break-all font-mono text-xs text-fg">{children}</code>
    <CopyButton text={children} />
  </div>
);
