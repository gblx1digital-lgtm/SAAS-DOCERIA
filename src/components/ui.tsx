import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────── Button ─────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 shadow-[0_1px_0_rgba(255,255,255,.12)_inset]',
  secondary: 'bg-surface text-ink border border-line hover:bg-subtle hover:border-line-strong',
  ghost: 'text-ink-2 hover:bg-subtle',
  danger: 'bg-surface text-neg border border-line hover:bg-neg-soft hover:border-neg/30',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean }
>(({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors whitespace-nowrap',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none',
      size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8.5 px-3 text-[13px]',
      variants[variant],
      className,
    )}
    {...rest}
  >
    {loading ? <span className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" /> : icon}
    {children}
  </button>
));

export const IconButton = ({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
  <button
    aria-label={label}
    title={label}
    className={cx('inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink transition-colors', className)}
    {...rest}
  >
    {children}
  </button>
);

// ───────── Form ─────────

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-2.5 text-[13.5px] text-ink placeholder:text-faint transition-colors ' +
  'hover:border-line-strong focus:border-ink/40 focus:outline-none focus:ring-3 focus:ring-ink/5 disabled:bg-subtle disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; suffix?: ReactNode; prefix?: ReactNode }>(
  ({ className, invalid, suffix, prefix, ...rest }, ref) => {
    const input = (
      <input
        ref={ref}
        className={cx(fieldBase, 'h-8.5', invalid && 'border-neg/60', prefix ? 'pl-8' : '', suffix ? 'pr-10' : '', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    );
    if (!suffix && !prefix) return input;
    return (
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">{prefix}</span>}
        {input}
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">{suffix}</span>}
      </div>
    );
  },
);

/** Campo numérico que aceita vírgula (padrão brasileiro). */
export const NumInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (v: string) => void;
    invalid?: boolean;
    suffix?: ReactNode;
    prefix?: ReactNode;
  }
>(({ value, onChange, ...rest }, ref) => (
  <Input
    ref={ref}
    inputMode="decimal"
    autoComplete="off"
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))}
    className="num"
    {...rest}
  />
));

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cx(
        fieldBase,
        'h-8.5 appearance-none pr-8 bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2712%27%20height%3D%2712%27%20fill%3D%27none%27%20stroke%3D%27%2378716c%27%20stroke-width%3D%271.6%27%3E%3Cpath%20d%3D%27M3%204.5l3%203%203-3%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.6rem_center]',
        invalid && 'border-neg/60',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  ),
);

export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(fieldBase, 'py-2 resize-y', p.className ?? 'min-h-[72px]')} />
);

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-neg">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

// ───────── Layout ─────────

export function Card({ children, className, title, action, subtitle, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(28,25,23,.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'pos' | 'neg' | 'accent' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(28,25,23,.04)]">
      <div className="text-[12.5px] font-medium text-muted">{label}</div>
      <div className={cx('num mt-1 text-[22px] font-semibold tracking-[-0.02em]', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg', tone === 'accent' && 'text-accent')}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'accent'; className?: string }) {
  const tones = {
    neutral: 'bg-subtle text-ink-2 border-line',
    pos: 'bg-pos-soft text-pos border-pos/15',
    neg: 'bg-neg-soft text-neg border-neg/15',
    warn: 'bg-warn-soft text-warn border-warn/20',
    accent: 'bg-accent-soft text-accent border-accent/15',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export function Empty({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-subtle text-muted">{icon}</div>}
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'neg' | 'pos'; children: ReactNode; className?: string }) {
  const map = {
    info: ['bg-subtle border-line text-ink-2', <Info key="i" className="size-4 shrink-0 text-muted" />],
    warn: ['bg-warn-soft border-warn/20 text-warn', <AlertTriangle key="w" className="size-4 shrink-0" />],
    neg: ['bg-neg-soft border-neg/20 text-neg', <AlertTriangle key="n" className="size-4 shrink-0" />],
    pos: ['bg-pos-soft border-pos/20 text-pos', <CheckCircle2 key="p" className="size-4 shrink-0" />],
  } as const;
  const [cls, icon] = map[tone];
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', cls, className)}>
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ───────── Table ─────────

export const Th = ({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) => (
  <th className={cx('h-9 border-b border-line bg-subtle/60 px-3 text-[12px] font-medium text-muted whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left', className)}>
    {children}
  </th>
);
export const Td = ({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) => (
  <td className={cx('h-11 border-b border-line px-3 text-[13px]', align === 'right' && 'text-right num', className)}>{children}</td>
);
export const TableWrap = ({ children }: { children: ReactNode }) => (
  <div className="scroll-thin overflow-x-auto">
    <table className="w-full border-collapse">{children}</table>
  </div>
);

// ───────── Modal / Drawer ─────────

const modalStack: object[] = [];

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = {};
    modalStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement))
        panel.current?.querySelector<HTMLElement>('input:not([type=checkbox]),select,textarea')?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      modalStack.splice(modalStack.indexOf(token), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:p-6 sm:pt-[6vh]" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className={cx(
          'anim-pop relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgba(28,25,23,.28)] sm:max-h-[88vh] sm:rounded-xl',
          widths[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
          </div>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle/40 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ───────── Toasts + confirmação ─────────

type Toast = { id: number; tone: 'pos' | 'neg' | 'info'; message: string };
type Confirm = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void };

const FeedbackCtx = createContext<{
  toast: (message: string, tone?: Toast['tone']) => void;
  confirm: (o: Omit<Confirm, 'resolve'>) => Promise<boolean>;
} | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Confirm | null>(null);
  const toast = useCallback((message: string, tone: Toast['tone'] = 'pos') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'neg' ? 6000 : 3200);
  }, []);
  const confirm = useCallback(
    (o: Omit<Confirm, 'resolve'>) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };
  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="anim-pop pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-[13px] shadow-[0_12px_32px_-8px_rgba(28,25,23,.25)]"
          >
            {t.tone === 'pos' ? (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-pos" />
            ) : t.tone === 'neg' ? (
              <AlertTriangle className="mt-px size-4 shrink-0 text-neg" />
            ) : (
              <Info className="mt-px size-4 shrink-0 text-muted" />
            )}
            <span className="text-ink">{t.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        title={dialog?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={dialog?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {dialog?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="text-[13.5px] text-ink-2">{dialog?.message}</div>
      </Modal>
    </FeedbackCtx.Provider>
  );
}

export function useFeedback() {
  const c = useContext(FeedbackCtx);
  if (!c) throw new Error('FeedbackProvider ausente');
  return c;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(28,25,23,.08)]' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Buscar…'} className="sm:w-64" type="search" />
  );
}
