import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ANIM_PRESETS, EASE_OPTIONS, MOTIONS, type AnimPresetKey, type EaseKey, type MotionKind, type SceneState } from '../state';
import { Dropdown, Seg } from './controls';

type Anim = SceneState['animation'];

interface Props {
  anim: Anim;
  selected: string | null;
  hasVideo: boolean;
  subscribe: (fn: (t: number, playing: boolean) => void) => () => void;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onChange: (patch: Partial<Anim>) => void;
  onAddKey: (t: number) => void;
  onUpdateKey: (id: string) => void;
  onDeleteKey: (id: string) => void;
  onSelect: (id: string | null) => void;
  onPreset: (key: AnimPresetKey) => void;
  onMotion: (kind: MotionKind) => void;
  onAreas: () => void;
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

type Drag = { kind: 'head' } | { kind: 'key'; id: string; startX: number; moved: boolean };

function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* sem captura */
  }
}

function readMode(): 'simple' | 'advanced' {
  try {
    return localStorage.getItem('mockup3d.timeline') === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

export function Timeline(p: Props) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'simple' | 'advanced'>(readMode);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const { anim } = p;

  // O tempo chega direto do motor, sem passar pelo App (evita redesenhar o editor a cada quadro).
  useEffect(() => p.subscribe((t, pl) => {
    setTime(t);
    setPlaying(pl);
  }), [p.subscribe]);

  const changeMode = (m: 'simple' | 'advanced') => {
    setMode(m);
    try {
      localStorage.setItem('mockup3d.timeline', m);
    } catch {
      /* sem armazenamento */
    }
  };

  // Planos: trechos entre cortes. Sem quadros-chave, um bloco só (flutuação ou vídeo).
  const shots = useMemo(() => {
    const ks = [...anim.keyframes].sort((a, b) => a.t - b.t);
    if (ks.length < 2) {
      if (anim.float || p.hasVideo) return [{ t0: 0, t1: anim.duration, label: anim.float ? 'Flutuação' : 'Vídeo' }];
      return [];
    }
    const cuts = ks.filter((k) => k.cut).map((k) => k.t);
    const edges = [ks[0].t, ...cuts, ks[ks.length - 1].t];
    return edges.slice(0, -1).map((t0, i) => ({ t0, t1: edges[i + 1], label: cuts.length ? `Plano ${i + 1}` : 'Movimento' }));
  }, [anim.keyframes, anim.float, anim.duration, p.hasVideo]);

  const tFromX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * anim.duration;
  };

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    capture(e.currentTarget, e.pointerId);
    drag.current = { kind: 'head' };
    p.onSelect(null);
    p.onSeek(tFromX(e.clientX));
  };

  const onKeyDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    capture(trackRef.current!, e.pointerId);
    drag.current = { kind: 'key', id, startX: e.clientX, moved: false };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'head') {
      p.onSeek(tFromX(e.clientX));
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
    d.moved = true;
    const t = Math.round(tFromX(e.clientX) * 10) / 10;
    p.onChange({ keyframes: anim.keyframes.map((k) => (k.id === d.id ? { ...k, t } : k)) });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'key') {
      const k = anim.keyframes.find((x) => x.id === d.id);
      p.onSelect(d.id);
      if (k) p.onSeek(k.t);
    }
  };

  const setDuration = (v: number) => {
    const duration = Math.min(Math.max(v || 1, 1), 60);
    const k = duration / anim.duration;
    p.onChange({ duration, keyframes: anim.keyframes.map((x) => ({ ...x, t: Math.round(x.t * k * 100) / 100 })) });
  };

  const step = anim.duration <= 4 ? 0.5 : anim.duration <= 15 ? 1 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= anim.duration + 1e-6; t += step) ticks.push(Math.round(t * 100) / 100);
  const selectedKey = anim.keyframes.find((k) => k.id === p.selected);
  const canPlay = anim.keyframes.length >= 2 || anim.float || p.hasVideo;
  const pct = (t: number) => `${(t / anim.duration) * 100}%`;
  const advanced = mode === 'advanced';

  return (
    <div className={`timeline ${advanced ? 'adv' : ''}`}>
      <div className="tl-bar">
        <Seg
          label="Modo da linha do tempo"
          value={mode}
          options={[
            { value: 'simple', label: 'Simples' },
            { value: 'advanced', label: 'Avançado' },
          ]}
          onChange={changeMode}
        />
        <Dropdown label={<>Presets <Chevron /></>} up className="ghost">
          {(close) => (
            <div className="menu-list">
              <div className="menu-head">Animações</div>
              {ANIM_PRESETS.map((m) => (
                <button key={m.key} className="menu-item" onClick={() => (close(), p.onPreset(m.key))}>
                  <strong>{m.label}</strong>
                  <span>{m.hint}</span>
                </button>
              ))}
              <div className="menu-head">Movimentos simples</div>
              {MOTIONS.map((m) => (
                <button key={m.key} className="menu-item" onClick={() => (close(), p.onMotion(m.key))}>
                  <strong>{m.label}</strong>
                  <span>{m.hint}</span>
                </button>
              ))}
            </div>
          )}
        </Dropdown>
        <button className="ghost-btn" onClick={p.onAreas} title="Desenhe retângulos no print e a câmera visita cada um">
          Áreas de foco
        </button>

        <span className="tl-spacer" />
        <button className={`tl-play ${playing ? 'on' : ''}`} onClick={p.onPlayPause} disabled={!canPlay} aria-label={playing ? 'Pausar' : 'Reproduzir'} title={canPlay ? 'Espaço' : 'Escolha um preset para animar'}>
          {playing ? (
            <svg viewBox="0 0 16 16" width="12" height="12"><rect x="3" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" /><rect x="9.5" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L4.9 2.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>
          )}
        </button>
        <span className="tl-time">
          {fmt(time)} <span>/</span>
          <input type="number" min={1} max={60} step={0.5} value={anim.duration} onChange={(e) => setDuration(parseFloat(e.target.value))} aria-label="Duração em segundos" />
          <span>s</span>
        </span>
        <span className="tl-spacer" />

        {advanced && (
          <>
            <button className="ghost-btn" onClick={() => p.onAddKey(time)} title="Guarda a câmera atual neste ponto">
              ◆ Quadro-chave
            </button>
            {selectedKey && (
              <>
                <button className="ghost-btn" onClick={() => p.onUpdateKey(selectedKey.id)}>Atualizar</button>
                <button className="ghost-btn danger" onClick={() => p.onDeleteKey(selectedKey.id)}>Excluir</button>
              </>
            )}
            <label className="tl-select">
              <select value={anim.ease} onChange={(e) => p.onChange({ ease: e.target.value as EaseKey })} aria-label="Ritmo">
                {EASE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="tl-select">
              <select value={anim.fps} onChange={(e) => p.onChange({ fps: Number(e.target.value) as 30 | 60 })} aria-label="Quadros por segundo">
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
            <label className="tl-check">
              <input type="checkbox" checked={anim.float} onChange={(e) => p.onChange({ float: e.target.checked })} />
              Flutuar
            </label>
          </>
        )}
        {anim.keyframes.length > 0 && (
          <button className="ghost-btn quiet" onClick={() => p.onChange({ keyframes: [], clips: [] })} title="Remove a animação">
            Limpar
          </button>
        )}
      </div>

      <div className="tl-body">
        <div className="tl-labels">
          <span />
          <span>Planos</span>
          {advanced && <span>Câmera</span>}
        </div>
        <div className="tl-track" ref={trackRef} onPointerDown={onTrackDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="tl-ruler">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>{Number.isInteger(t) ? `${t}s` : ''}</span>
            ))}
          </div>
          <div className="tl-lane">
            {shots.length === 0 && <span className="tl-empty">Escolha um preset em “Presets” ou desenhe áreas de foco para animar.</span>}
            {shots.map((s, i) => (
              <span key={i} className="tl-shot" style={{ left: pct(s.t0), width: `calc(${pct(s.t1 - s.t0)} - 2px)` }}>
                {s.label} <em>{(s.t1 - s.t0).toFixed(1)}s</em>
              </span>
            ))}
          </div>
          {advanced && (
            <div className="tl-lane keys">
              {anim.keyframes.map((k) => (
                <button
                  key={k.id}
                  className={`tl-key ${p.selected === k.id ? 'on' : ''} ${k.cut ? 'cut' : ''}`}
                  style={{ left: pct(k.t) }}
                  onPointerDown={(e) => onKeyDown(e, k.id)}
                  aria-label={`Quadro-chave em ${k.t.toFixed(1)} segundos${k.cut ? ' (corte)' : ''}`}
                />
              ))}
            </div>
          )}
          <div className="tl-head" style={{ left: pct(time) }} />
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
