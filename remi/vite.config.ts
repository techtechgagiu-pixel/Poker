import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const version = `${pkg.version}+${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2020', cssCodeSplit: true, sourcemap: false, reportCompressedSize: true,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'zustand'] } } },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  test: { include: ['test/**/*.test.ts'] },
} as any);
