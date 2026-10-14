import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mcpBridge } from './bridge/vite-mcp-bridge';

// Caminhos relativos no build: funciona em qualquer subpasta (ex.: GitHub Pages em /mockup-3d/).
// No desenvolvimento só escuta na própria máquina.
export default defineConfig({
  base: './',
  plugins: [react(), mcpBridge()],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
