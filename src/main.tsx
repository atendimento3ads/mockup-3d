import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles-v2.css';

// Pele da interface (só aparência): a versão em /v2/ é gerada com VITE_SKIN=v2; localmente dá para testar com ?skin=v2.
document.documentElement.dataset.skin = new URLSearchParams(location.search).get('skin') ?? import.meta.env.VITE_SKIN ?? 'v1';

// Sem StrictMode: ele montaria o motor duas vezes e criaria dois contextos WebGL.
createRoot(document.getElementById('root')!).render(<App />);
