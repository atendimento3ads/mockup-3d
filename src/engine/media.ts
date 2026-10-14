import type { ScreenImage } from './textures';

// Carrega um vídeo (URL de blob) pronto para desenhar quadro a quadro na tela do aparelho.
export function loadVideo(url: string): Promise<ScreenImage> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    const fail = () => reject(new Error('Não consegui abrir esse vídeo neste navegador (tente MP4 H.264).'));
    v.addEventListener('error', fail, { once: true });
    v.addEventListener(
      'loadeddata',
      () => {
        v.removeEventListener('error', fail);
        resolve({ src: v, w: v.videoWidth, h: v.videoHeight, video: v });
      },
      { once: true },
    );
    v.src = url;
    v.load();
  });
}
