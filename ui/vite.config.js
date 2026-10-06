import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({ root: 'ui', plugins: [preact()], build: { outDir: 'dist', emptyOutDir: true }, server: { host: '127.0.0.1', port: 5173 } });
