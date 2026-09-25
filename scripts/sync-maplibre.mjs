// Copies the installed maplibre-gl worker + its shared chunk into public/.
// MapContainerInner.tsx overrides setWorkerUrl('/maplibre-gl-worker.mjs'),
// and that worker imports './maplibre-gl-shared.mjs' — both files MUST come
// from the same installed version or the browser 404s / mixes builds.
// Run automatically on `postinstall`; run manually if you bump maplibre-gl.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'maplibre-gl', 'dist');
const dest = join(root, 'public');

const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
  console.log(`[sync-maplibre] ${file} -> public/`);
}
