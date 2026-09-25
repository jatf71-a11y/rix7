// Parchea un bug de Next que impide usar `next/og` con el runtime Node en Windows.
//
// vercel/next.js#77164: `@vercel/og/index.node.js` arma la ruta de sus assets (la
// fuente Noto Sans y los wasm de yoga y resvg) con `join(import.meta.url, "../…")`.
// En Windows `join` convierte el `file:` URL en la ruta relativa `.\file:\C:\…` y
// `fileURLToPath` revienta con `ERR_INVALID_URL` **al importar el módulo**: la
// imagen no falla al dibujar, no llega a cargarse.
//
// Hace falta porque las tarjetas de `/compartir/[id]` no caben en el runtime edge:
// el plan Hobby de Vercel limita cada Edge Function a 1 MB y `next/og` (satori +
// resvg) ya pesa 1.05 MB —medido por Vercel al desplegar—, así que el runtime Node
// es la única opción. Y sin este arreglo, Node no funciona en Windows, que es
// donde se desarrolla y se verifica.
//
// El reemplazo es el que propone el propio issue: `new URL(…, import.meta.url)`
// resuelve igual en las dos plataformas. Los assets están **al lado** del archivo
// compilado, así que la ruta relativa es `./` (el `join(…, "../x")` funcionaba por
// accidente: `path.join` trata el último segmento del URL como un directorio).
//
// Corre en `postinstall` porque `npm install` reescribe el archivo. Es idempotente
// y no tumba la instalación si Next cambia el archivo: avisa.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(
  root,
  'node_modules',
  'next',
  'dist',
  'compiled',
  '@vercel',
  'og',
  'index.node.js'
);

const ASSETS = ['noto-sans-v27-latin-regular.ttf', 'yoga.wasm', 'resvg.wasm'];

let source;
try {
  source = readFileSync(target, 'utf8');
} catch {
  console.warn('[patch-next-og] no está el @vercel/og compilado de Next; nada que hacer');
  process.exit(0);
}

const broken = (asset) => `fileURLToPath(join(import.meta.url, "../${asset}"))`;
const pending = ASSETS.filter((asset) => source.includes(broken(asset)));

if (pending.length === 0) {
  // Puede ser que ya esté aplicado o que Next haya cambiado el archivo. Las dos
  // cosas son motivo para no tocar nada, pero conviene que se lea en el log.
  console.log('[patch-next-og] ya aplicado, o Next cambió el archivo: sin cambios');
  process.exit(0);
}

let patched = source;
for (const asset of pending) {
  patched = patched
    .split(broken(asset))
    .join(`fileURLToPath(new URL("./${asset}", import.meta.url))`);
}

writeFileSync(target, patched);
console.log(`[patch-next-og] ruta de assets de next/og arreglada (${pending.length}) para Windows`);
