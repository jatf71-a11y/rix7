// Copies Leaflet's default marker icons into public/leaflet/.
//
// PropertyMapLeaflet.tsx apunta el ícono por defecto de Leaflet a estas copias
// locales. Antes venían de cdnjs.cloudflare.com, que no estaba en el `img-src`
// del CSP: el navegador las bloqueaba en producción (en local se veían, porque
// los headers de vercel.json solo se aplican en Vercel). Servirlas desde el
// propio dominio borra la dependencia externa y el permiso que hacía falta.
//
// Run automatically on `postinstall`; run manually after bumping leaflet.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'leaflet', 'dist', 'images');
const dest = join(root, 'public', 'leaflet');

// Solo las que usa el marcador por defecto: `layers*.png` es del control de capas.
const files = ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png'];

mkdirSync(dest, { recursive: true });

for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
  console.log(`[sync-leaflet-icons] ${file} -> public/leaflet/`);
}
