import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Every build gets an id. It's baked into the app and also published as
// version.json, so an open copy of the app can tell a newer one is live.
const BUILD_ID = String(Date.now());

function versionFile(): Plugin {
  return {
    name: 'brownie-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: BUILD_ID }) });
    },
  };
}

// Relative base so the same build works at the GitHub Pages sub-path
// (https://<user>.github.io/browniepoints/) and at the root locally.
export default defineConfig({
  base: './',
  plugins: [react(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(BUILD_ID) },
  server: { port: 5173 },
  // supabase-js is most of the bundle (~155 kB gzipped in total); that's expected
  build: { chunkSizeWarningLimit: 700 },
});
