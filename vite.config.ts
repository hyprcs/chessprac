import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export const ENGINE_FILE = 'stockfish-19-lite-single';

/** Serves the single-threaded lite Stockfish build from public/engine/ (works on any static host). */
function stockfishAssets(): Plugin {
  return {
    name: 'stockfish-assets',
    buildStart() {
      const pkg = dirname(require.resolve('stockfish/package.json'));
      mkdirSync('public/engine', { recursive: true });
      for (const ext of ['js', 'wasm']) copyFileSync(join(pkg, 'bin', `${ENGINE_FILE}.${ext}`), `public/engine/${ENGINE_FILE}.${ext}`);
      copyFileSync(join(pkg, 'Copying.txt'), 'public/engine/COPYING.txt');
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the site works from any GitHub Pages sub-path.
  base: './',
  plugins: [stockfishAssets()],
  // The opening book (~460 KB of JSON) is most of the bundle; it gzips to ~100 KB.
  build: { chunkSizeWarningLimit: 800 },
});
