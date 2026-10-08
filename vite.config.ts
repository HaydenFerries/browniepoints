import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works at the GitHub Pages sub-path
// (https://<user>.github.io/browniepoints/) and at the root locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
