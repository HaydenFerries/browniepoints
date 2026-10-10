import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Minus, Plus, X } from 'lucide-react';
import { useApp } from '../app/store';
import { Amount, BrownieIcon, BROWNIE_SMALL } from './Brownie';

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, button:not(.sheet-close)');
    if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-layer" role="presentation">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={panel}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <div>
            <h2 className="sheet-title">{title}</h2>
            {subtitle && <p className="sheet-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// A button that disables itself while its async action runs (no double taps)
// ---------------------------------------------------------------------------
export function AsyncButton({
  onClick,
  className = '',
  disabled,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onClick: () => unknown }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      {...rest}
      className={`${className} ${pending ? 'is-pending' : ''}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={async () => {
        setPending(true);
        try {
          await onClick();
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Brownie amount picker
// ---------------------------------------------------------------------------
export function PointsPicker({
  value,
  onChange,
  presets = [5, 10, 20, 50],
  max = 1000,
  compact = false,
}: {
  value: number;
  onChange: (n: number) => void;
  presets?: number[];
  max?: number;
  compact?: boolean;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(max, Math.round(n) || 1));
  const step = value >= 50 ? 5 : 1;
  // The box can be cleared while typing (value 0); callers block saving until it's 1+.
  const invalid = value < 1;
  return (
    <div className={`points-picker ${compact ? 'compact' : ''}`}>
      <div className="pp-row">
        <button type="button" className="pp-btn" onClick={() => onChange(clamp(value - step))} aria-label="Fewer brownies">
          <Minus size={22} />
        </button>
        <label className={`pp-value ${invalid ? 'is-invalid' : ''}`}>
          <BrownieIcon size={compact ? 28 : 44} />
          <input
            inputMode="numeric"
            aria-label="Brownies"
            aria-invalid={invalid || undefined}
            value={invalid ? '' : value}
            placeholder="0"
            onChange={(e) => onChange(Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0))}
          />
        </label>
        <button type="button" className="pp-btn" onClick={() => onChange(clamp(value + step))} aria-label="More brownies">
          <Plus size={22} />
        </button>
      </div>
      {invalid && <p className="pp-error">Needs to be at least 1 brownie.</p>}
      {presets.length > 0 && (
      <div className="chips center">
        {presets.map((p) => (
          <button type="button" key={p} className={`chip ${p === value ? 'chip-on' : ''}`} onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-way switch used on the Tasks and Treats tabs
// ---------------------------------------------------------------------------
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div className="segmented" role="tablist" style={{ ['--n' as string]: options.length, ['--i' as string]: idx }}>
      <span className="segmented-pill" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ emoji, tone = 'caramel', size = 40 }: { emoji: string; tone?: 'caramel' | 'berry'; size?: number }) {
  return (
    <span className={`avatar avatar-${tone}`} style={{ width: size, height: size, fontSize: size * 0.52 }} aria-hidden="true">
      {emoji}
    </span>
  );
}

export function Empty({ title, children, art = true }: { title: string; children?: ReactNode; art?: boolean }) {
  return (
    <div className="empty">
      {art && <BrownieIcon size={84} className="empty-art" />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Number that rolls up/down to its new value. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value) return;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return <>{shown}</>;
}

// ---------------------------------------------------------------------------
// Toasts + celebration burst (rendered once at the app root)
// ---------------------------------------------------------------------------
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">
            {t.tone === 'error' ? <CircleAlert size={20} /> : t.tone === 'success' ? <CircleCheck size={20} /> : <BrownieIcon size={26} />}
          </span>
          <span className="toast-text">{t.text}</span>
          {t.delta ? <Amount n={t.delta} sign size="sm" className={t.delta > 0 ? 'pos' : 'neg'} /> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function Burst() {
  const { burst } = useApp();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!burst) return;
    setActive(burst);
    const t = setTimeout(() => setActive(0), 1700);
    return () => clearTimeout(t);
  }, [burst]);
  if (!active) return null;
  const bits = Array.from({ length: 26 }, (_, i) => {
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 90 + Math.random() * 120;
    const isBrownie = i % 4 === 0;
    return {
      i,
      isBrownie,
      size: isBrownie ? 26 + Math.random() * 14 : 4 + Math.random() * 7,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist * 0.8 - 40,
      rot: (Math.random() - 0.5) * 540,
      delay: Math.random() * 90,
      hue: ['#5a2c15', '#7a3f1f', '#3b1a0b', '#e2a557', '#9a5a2f'][i % 5],
    };
  });
  return createPortal(
    <div className="burst" key={active} aria-hidden="true">
      {bits.map((b) =>
        b.isBrownie ? (
          <img
            key={b.i}
            src={BROWNIE_SMALL}
            alt=""
            className="burst-bit"
            style={vars(b)}
          />
        ) : (
          <span key={b.i} className="burst-bit crumb" style={{ ...vars(b), height: b.size, background: b.hue }} />
        ),
      )}
    </div>,
    document.body,
  );
}

function vars(b: { size: number; dx: number; dy: number; rot: number; delay: number }) {
  return {
    width: b.size,
    animationDelay: `${b.delay}ms`,
    ['--dx' as string]: `${b.dx}px`,
    ['--dy' as string]: `${b.dy}px`,
    ['--rot' as string]: `${b.rot}deg`,
  };
}
