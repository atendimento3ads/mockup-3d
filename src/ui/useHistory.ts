import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneState } from '../state';

// Quantos passos guardar e quanto tempo de pausa separa um passo do outro: arrastar um ajuste
// gera dezenas de mudanças seguidas, que viram um passo só.
const LIMIT = 100;
const GROUP_MS = 450;

// Desfazer e refazer sobre o estado da cena (aparelho, cenas, luz, efeitos, animação…).
// A câmera e a mídia sem cenas ficam de fora, como nos editores 3D.
export function useHistory(state: SceneState, apply: (s: SceneState) => void) {
  const h = useRef({ past: [] as SceneState[], future: [] as SceneState[], last: state, timer: 0, applying: false });
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const sync = () => setCounts({ undo: h.current.past.length, redo: h.current.future.length });

  useEffect(() => {
    const x = h.current;
    if (x.applying) {
      x.applying = false;
      x.last = state;
      return;
    }
    if (state === x.last) return;
    if (x.timer) {
      window.clearTimeout(x.timer);
    } else {
      x.past.push(x.last);
      if (x.past.length > LIMIT) x.past.shift();
      x.future = [];
      sync();
    }
    x.timer = window.setTimeout(() => (x.timer = 0), GROUP_MS);
    x.last = state;
  }, [state]);

  const step = useCallback(
    (back: boolean) => {
      const x = h.current;
      if (x.timer) {
        window.clearTimeout(x.timer);
        x.timer = 0;
      }
      const target = (back ? x.past : x.future).pop();
      if (!target) return false;
      (back ? x.future : x.past).push(x.last);
      x.applying = true;
      apply(target);
      sync();
      return true;
    },
    [apply],
  );

  const undo = useCallback(() => step(true), [step]);
  const redo = useCallback(() => step(false), [step]);
  return { undo, redo, canUndo: counts.undo > 0, canRedo: counts.redo > 0 };
}
