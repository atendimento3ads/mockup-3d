import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

// Controles compactos do inspetor: cada ajuste ocupa uma linha só (nome à esquerda, valor à direita).

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

export function Section({ title, aside, defaultOpen = true, children }: { title: string; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`sec ${open ? 'open' : ''}`}>
      <button className="sec-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sec-title">{title}</span>
        {aside && <span className="sec-aside">{aside}</span>}
        <svg className="sec-chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="sec-b">{children}</div>}
    </section>
  );
}

// Barra de ajuste: a própria barra é o slider (clique ou arraste). Setas do teclado ajustam,
// Shift acelera, duplo clique volta ao padrão. Faixas com negativo preenchem a partir do zero.
export function Field({
  label,
  value,
  min,
  max,
  step = 0.01,
  def,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const snap = (v: number) => {
    const s = Math.round(clamp(v, min, max) / step) * step;
    return Number(s.toFixed(6));
  };
  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(snap(min + clamp((clientX - r.left) / r.width, 0, 1) * (max - min)));
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura */
    }
    fromX(e.clientX);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = step * (e.shiftKey ? 10 : 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(snap(value + k));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(snap(value - k));
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else return;
    e.preventDefault();
  };
  const p = clamp((value - min) / (max - min), 0, 1);
  const zero = min < 0 && max > 0 ? (0 - min) / (max - min) : 0;
  return (
    <div
      ref={ref}
      className="field"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format ? format(value) : String(value)}
      title={def !== undefined ? 'Arraste para ajustar · duplo clique volta ao padrão' : undefined}
      onPointerDown={down}
      onPointerMove={(e) => dragging.current && fromX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => def !== undefined && onChange(def)}
      onKeyDown={key}
    >
      <span className="field-fill" style={{ left: `${Math.min(zero, p) * 100}%`, width: `${Math.abs(p - zero) * 100}%` }} />
      <span className="field-label">{label}</span>
      <span className="field-value">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row toggle-row">
      <span className="row-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function SelectRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <label className="row select-row">
      <span className="row-label">{label}</span>
      <span className="row-value">
        {current?.label ?? '—'}
        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <select
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="row color-row">
      <span className="row-label">{label}</span>
      <span className="row-value">
        <code>{value.toUpperCase()}</code>
        <span className="chip-color" style={{ background: value }} />
      </span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

export function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="row text-row">
      <span className="row-label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </label>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

// Fecha com clique fora ou Esc.
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);
  return ref;
}

// Cartão "item atual + Trocar": a lista completa só aparece quando pedida.
export function Card({ thumb, title, subtitle, children }: { thumb: ReactNode; title: string; subtitle?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div className="card-wrap" ref={ref}>
      <div className="card">
        <span className="card-thumb">{thumb}</span>
        <span className="card-text">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </span>
        <button className="mini-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          Trocar
        </button>
      </div>
      {open && <div className="pop card-pop">{children(close)}</div>}
    </div>
  );
}

// Menu suspenso do topo e da linha do tempo.
export function Dropdown({
  label,
  className = '',
  align = 'left',
  up = false,
  children,
}: {
  label: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  up?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div className={`dd ${open ? 'open' : ''}`} ref={ref}>
      <button className={`dd-btn ${className}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </button>
      {open && <div className={`pop dd-pop ${align} ${up ? 'up' : ''}`}>{children(close)}</div>}
    </div>
  );
}
