/**
 * Genera `lib/data/poiSnapshot.generated.json`: un snapshot estático de POIs
 * para las propiedades del catálogo manual, consultando Overpass por adelantado.
 *
 * Uso:
 *   npm run snapshot:pois                                (solo celdas faltantes)
 *   npm run snapshot:pois -- --force                     (regenera todas)
 *
 * Se ejecuta manualmente (o en CI programado), NO dentro de `next build`:
 * meter Overpass en cada build haría el deploy lento y frágil. El JSON queda
 * versionado y la route `/api/pois` lo sirve como fallback de última instancia
 * cuando Overpass y la caché de servidor no están disponibles. Los datos son
 * estáticos (pueden tener días/semanas), pero para "atractivos del sector"
 * es preferible a un mapa vacío.
 *
 * Celdas de ~11 m (4 decimales), igual granularidad que la caché runtime.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(root, 'lib', 'data', 'poiSnapshot.generated.json');
const FORCE = process.argv.includes('--force');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const SEARCH_RADIUS_M = 1500;

// ═══ Categorías: espejo mínimo del módulo TS (este script corre en Node puro) ═══
const CATEGORY_QUERIES = {
  education: ['["amenity"~"school|kindergarten|university|college"]'],
  health: ['["amenity"~"clinic|hospital|pharmacy|doctors"]'],
  transport: ['["railway"~"station|halt"]', '["railway"="subway_entrance"]', '["highway"="bus_stop"]', '["highway"="motorway_junction"]'],
  shopping: ['["shop"~"supermarket|convenience|mall|department_store|bakery|greengrocer"]', '["amenity"="marketplace"]'],
  sports: ['["leisure"~"fitness_centre|sports_centre|stadium|sports_club"]'],
  park: ['["leisure"~"park|garden|dog_park"]', '["place"="square"]'],
  safety: ['["amenity"~"police|fire_station"]'],
  leisure: ['["amenity"~"restaurant|cafe|fast_food|food_court|arts_centre|community_centre"]'],
  services: ['["amenity"~"bank|atm|townhall|courthouse|post_office"]', '["office"~"government|notary|financial"]'],
};

// Selectores Overpass → subtipo OSM + categoría (para categorizar sin importar TS)
const TYPE_INDEX = [];
for (const [category, selectors] of Object.entries(CATEGORY_QUERIES)) {
  for (const sel of selectors) {
    const m = sel.match(/^"(?:\w+)"~"([^"]+)"$|^"(?:\w+)"="([^"]+)"$/);
    if (!m) continue;
    const values = (m[1] || m[2]).split('|');
    const key = sel.match(/^"(\w+)"/)[1];
    for (const v of values) TYPE_INDEX.push({ category, tagKey: key, value: v });
  }
}

function categorize(tags) {
  for (const { category, tagKey, value } of TYPE_INDEX) {
    if (tags[tagKey] === value) return category;
  }
  return null;
}

function rawType(tags) {
  return tags.amenity || tags.shop || tags.leisure || tags.railway || tags.highway || tags.office || '';
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return await res.json();
      lastError = new Error(`${res.status} en ${endpoint}`);
      console.warn(`  [warn] ${res.status} en ${endpoint}`);
    } catch (err) {
      lastError = err;
      console.warn(`  [warn] ${err.message} en ${endpoint}`);
    }
  }
  throw lastError ?? new Error('Overpass no disponible');
}

async function fetchCell(lat, lng) {
  const queries = Object.entries(CATEGORY_QUERIES).flatMap(([key, selectors]) =>
    selectors.map((q) => `node${q}(around:${SEARCH_RADIUS_M},${lat},${lng});`)
  );
  const query = `[out:json][timeout:15];(${queries.join('\n')});out body;`;
  const data = await fetchOverpass(query);
  const seen = new Set();
  const pois = [];
  for (const element of data.elements || []) {
    if (!element.tags || seen.has(element.id)) continue;
    seen.add(element.id);
    const category = categorize(element.tags);
    if (!category) continue;
    pois.push({
      id: element.id,
      lat: element.lat,
      lng: element.lon,
      name: element.tags.name || '',
      type: rawType(element.tags),
      category,
    });
  }
  return pois;
}

// ═══ Coordenadas del catálogo (ALL_PROPERTIES, en línea para no depender de TS) ═══
// Lee las coords directamente del módulo transpilado en memoria: el catálogo
// vive en TS, así que importamos con el loader de Node >= 20.6 vía tsx si está,
// y si no, parseamos el texto con una regex tolerante.
async function loadPropertyCoords() {
  const coords = [];
  const seenIds = new Set();
  // Solo propertyCatalog.ts (propiedades con corredora real). El catálogo
  // generado (sampleProperties.ts, ~4k propiedades demo) se excluye a
  // propósito: serían miles de consultas a Overpass sin valor de producto.
  // Anclado a inicio de línea para no confundir `id:` con `partner_id:`.
  const objectRe = /(?:^|\n)\s+"?id"?:\s*['"]([^'"]+)['"][\s\S]*?"?lat"?:\s*(-?\d+(?:\.\d+)?),\s*\n\s*"?lng"?:\s*(-?\d+(?:\.\d+)?)/g;
  const text = readFileSync(join(root, 'lib', 'data', 'propertyCatalog.ts'), 'utf8');
  let m;
  while ((m = objectRe.exec(text)) !== null) {
    const [, id, lat, lng] = m;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    coords.push({ id, lat: parseFloat(lat), lng: parseFloat(lng) });
  }
  return coords;
}

async function main() {
  const coords = await loadPropertyCoords();
  console.log(`[poi-snapshot] ${coords.length} propiedades en el catálogo`);

  // Celdas únicas de ~11 m
  const cells = new Map();
  for (const p of coords) {
    const key = `${p.lat.toFixed(4)}_${p.lng.toFixed(4)}`;
    if (!cells.has(key)) cells.set(key, { lat: p.lat, lng: p.lng, properties: [] });
    cells.get(key).properties.push(p.id);
  }
  console.log(`[poi-snapshot] ${cells.size} celdas únicas`);

  // Snapshot previo: conservar celdas ya generadas salvo --force
  const snapshot = existsSync(OUT_PATH) && !FORCE
    ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    : { generated_at: null, cells: {} };

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const [key, cell] of cells) {
    if (snapshot.cells[key]) {
      skipped += 1;
      continue;
    }
    process.stdout.write(`[poi-snapshot] celda ${key} (${cell.properties.join(', ')})... `);
    try {
      const pois = await fetchCell(cell.lat, cell.lng);
      // Un espejo degradado puede responder 200 con 0 elementos; guardar esa
      // celda envenenaría el snapshot con "no hay POIs aquí". Solo guardamos
      // celdas con datos reales — las vacías cuentan como fallidas.
      if (pois.length === 0) {
        failed += 1;
        console.log('✗ 0 POIs (respuesta no confiable, no se guarda)');
        continue;
      }
      snapshot.cells[key] = { lat: cell.lat, lng: cell.lng, pois };
      ok += 1;
      console.log(`✓ ${pois.length} POIs`);
      // Cortesía con Overpass: pausa entre consultas
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      failed += 1;
      console.log(`✗ ${err.message}`);
    }
  }

  snapshot.generated_at = new Date().toISOString();
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\n[poi-snapshot] listo: ${ok} nuevas, ${skipped} existentes, ${failed} fallidas → ${OUT_PATH}`);
  if (failed > 0) {
    console.log('[poi-snapshot] re-ejecutar más tarde completa las celdas faltantes (Overpass caído hoy).');
    process.exitCode = 1; // señal útil en CI, no rompe el build local
  }
}

main().catch((err) => {
  console.error('[poi-snapshot] error fatal:', err);
  process.exit(1);
});
