import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Field } from './controls';

export interface Area {
  a0: number;
  b0: number;
  a1: number;
  b1: number;
}

interface Props {
  preview: { url: string; aspect: number };
  onClose: () => void;
  onApply: (areas: Area[], travel: number, hold: number) => void;
}

// Desenhe retângulos sobre o print: a câmera vai visitar cada um, na ordem.
export function FocusAreas({ preview, onClose, onApply }: Props) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [draft, setDraft] = useState<Area | null>(null);
  const [travel, setTravel] = useState(1.4);
  const [hold, setHold] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ a: number; b: number } | null>(null);
  // O rascunho fica num ref também: o "soltar" precisa do valor mais recente, não do último render.
  const draftRef = useRef<Area | null>(null);
  const updateDraft = (d: Area | null) => {
    draftRef.current = d;
    setDraft(d);
  };

  const norm = (e: ReactPointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      a: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      b: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sem captura o desenho ainda funciona enquanto o cursor estiver sobre o print.
    }
    start.current = norm(e);
    updateDraft(null);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = norm(e);
    const s = start.current;
    updateDraft({ a0: Math.min(s.a, p.a), b0: Math.min(s.b, p.b), a1: Math.max(s.a, p.a), b1: Math.max(s.b, p.b) });
  };
  const up = () => {
    start.current = null;
    const d = draftRef.current;
    // Ignora cliques soltos: a área precisa ter um tamanho mínimo.
    if (d && d.a1 - d.a0 > 0.03 && d.b1 - d.b0 > 0.02) setAreas((list) => [...list, d]);
    updateDraft(null);
  };

  const portrait = preview.aspect < 1;
  const boxStyle = portrait ? { height: 'min(62vh, 560px)', aspectRatio: String(preview.aspect) } : { width: 'min(70vw, 760px)', aspectRatio: String(preview.aspect) };
  const total = areas.length ? travel * (areas.length + 1) + hold * areas.length : 0;

  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Áreas de foco">
        <header className="modal-h">
          <div>
            <strong>Áreas de foco</strong>
            <span>Arraste sobre o print para marcar o que a câmera deve mostrar, na ordem.</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        <div className="areas-body">
          <div className="areas-canvas" ref={boxRef} style={boxStyle} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
            <img src={preview.url} alt="" draggable={false} />
            {areas.map((r, i) => (
              <div key={i} className="area" style={{ left: `${r.a0 * 100}%`, top: `${r.b0 * 100}%`, width: `${(r.a1 - r.a0) * 100}%`, height: `${(r.b1 - r.b0) * 100}%` }}>
                <span>{i + 1}</span>
              </div>
            ))}
            {draft && <div className="area draft" style={{ left: `${draft.a0 * 100}%`, top: `${draft.b0 * 100}%`, width: `${(draft.a1 - draft.a0) * 100}%`, height: `${(draft.b1 - draft.b0) * 100}%` }} />}
          </div>
          <aside className="areas-side">
            <ol className="areas-list">
              {areas.length === 0 && <li className="empty">Nenhuma área ainda.</li>}
              {areas.map((_, i) => (
                <li key={i}>
                  <span>Área {i + 1}</span>
                  <button className="link" onClick={() => setAreas((l) => l.filter((__, j) => j !== i))}>remover</button>
                </li>
              ))}
            </ol>
            <Field label="Viagem entre áreas" value={travel} min={0.6} max={3} step={0.1} def={1.4} onChange={setTravel} format={(v) => `${v.toFixed(1)}s`} />
            <Field label="Pausa em cada área" value={hold} min={0} max={3} step={0.1} def={1} onChange={setHold} format={(v) => `${v.toFixed(1)}s`} />
            <p className="note">O vídeo começa e termina no enquadramento atual{total ? ` · ${total.toFixed(1)}s no total` : ''}.</p>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={onClose}>Cancelar</button>
              <button className="primary" disabled={!areas.length} onClick={() => onApply(areas, travel, hold)}>Criar movimento</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
