import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Sem StrictMode: ele montaria o motor duas vezes e criaria dois contextos WebGL.
createRoot(document.getElementById('root')!).render(<App />);
