import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

// The service worker downloads the whole app when it installs, so the installed
// app opens with no signal. This fills in its file list and per-build cache name.
function precacheList(): Plugin {
  let outDir = 'dist';
  return {
    name: 'brownie-precache',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(path.relative(outDir, full).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const skip = /^(sw\.js|version\.json)$|-512\.png$|cyrillic|vietnamese|greek|\.map$/; // not needed to open the app
      const list = ['./', ...files.filter((f) => !skip.test(f)).map((f) => './' + f)];
      const sw = path.join(outDir, 'sw.js');
      const src = readFileSync(sw, 'utf8')
        .replace("const BUILD = 'dev';", `const BUILD = '${BUILD_ID}';`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list)};`);
      if (!src.includes(BUILD_ID)) throw new Error('sw.js placeholders not found');
      writeFileSync(sw, src);
    },
  };
}

// Relative base so the same build works at the GitHub Pages sub-path
// (https://<user>.github.io/browniepoints/) and at the root locally.
export default defineConfig({
  base: './',
  plugins: [react(), versionFile(), precacheList()],
  define: { __APP_VERSION__: JSON.stringify(BUILD_ID) },
  server: { port: 5173 },
  // supabase-js is most of the bundle (~155 kB gzipped in total); that's expected
  build: { chunkSizeWarningLimit: 700 },
});
