import type { Tool } from '../engine/Engine';

interface Props {
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  undoKey: string;
  redoKey: string;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFrame: () => void;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

// Barra de ferramentas do canvas: girar ou mover (mãozinha), desfazer/refazer e reenquadrar.
export function CanvasTools(p: Props) {
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Ferramentas">
      <button className={p.tool === 'orbit' ? 'on' : ''} aria-pressed={p.tool === 'orbit'} onClick={() => p.onTool('orbit')} title="Girar a câmera (V)" aria-label="Girar a câmera">
        <svg viewBox="0 0 24 24" width="17" height="17">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" {...stroke} />
          <path d="M20 4.5v4h-4" {...stroke} />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      <button className={p.tool === 'hand' ? 'on' : ''} aria-pressed={p.tool === 'hand'} onClick={() => p.onTool('hand')} title="Mover o quadro (H) · segure Espaço" aria-label="Mover o quadro">
        <svg viewBox="0 0 24 24" width="17" height="17">
          <path d="M8 12.5V6.5a1.5 1.5 0 0 1 3 0v5M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0v4.5M17 11.5V9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.9-2.5L4 14.2a1.6 1.6 0 0 1 2.5-2l1.5 1.8" {...stroke} />
        </svg>
      </button>
      <span className="ct-sep" aria-hidden />
      <button disabled={!p.canUndo} onClick={p.onUndo} title={`Desfazer (${p.undoKey})`} aria-label="Desfazer">
        <svg viewBox="0 0 24 24" width="17" height="17">
          <path d="M9 14 4 9l5-5" {...stroke} />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" {...stroke} />
        </svg>
      </button>
      <button disabled={!p.canRedo} onClick={p.onRedo} title={`Refazer (${p.redoKey})`} aria-label="Refazer">
        <svg viewBox="0 0 24 24" width="17" height="17">
          <path d="m15 14 5-5-5-5" {...stroke} />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" {...stroke} />
        </svg>
      </button>
      <span className="ct-sep" aria-hidden />
      <button onClick={p.onFrame} title="Enquadrar o aparelho (F)" aria-label="Enquadrar o aparelho">
        <svg viewBox="0 0 24 24" width="17" height="17">
          <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" {...stroke} />
          <rect x="9" y="8" width="6" height="8" rx="1.5" {...stroke} />
        </svg>
      </button>
    </div>
  );
}
