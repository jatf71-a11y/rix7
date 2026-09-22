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

// Overpass bloquea clientes anónimos: la política de OSM exige identificarse.
const OVERPASS_USER_AGENT =
  'Rix7Inmobiliaria/1.0 (portal inmobiliario; contacto: dev@rix7.cl)';

// ═══ Categorías: espejo mínimo del módulo TS (este script corre en Node puro) ═══
export const CATEGORY_QUERIES = {
  education: ['["amenity"~"school|kindergarten|university|college"]'],
  health: ['["amenity"~"clinic|hospital|pharmacy|doctors"]'],
  transport: ['["railway"~"station|halt"]', '["railway"="subway_entrance"]', '["highway"="bus_stop"]', '["highway"="motorway_junction"]'],
  shopping: ['["shop"~"supermarket|convenience|mall|department_store|bakery|greengrocer"]', '["amenity"="marketplace"]'],
  sports: ['["leisure"~"fitness_centre|sports_centre|stadium|sports_club"]'],
  park: ['["leisure"~"park|garden|dog_park"]', '["place"="square"]'],
  safety: [
    '["amenity"~"police|fire_station"]',
    '["name"~"Carabinero|Comisar|Subcomisar|Tenencia|Retén|Bomberos|Policía de Investigaciones|PDI|Seguridad Ciudadana|Paz Ciudadana",i]',
    '["operator"~"Carabineros|Bomberos|Policía de Investigaciones|Seguridad Ciudadana",i]',
  ],
  leisure: ['["amenity"~"restaurant|cafe|fast_food|food_court|arts_centre|community_centre"]'],
  services: ['["amenity"~"bank|atm|townhall|courthouse|post_office"]', '["office"~"government|notary|financial"]'],
};

// Selectores Overpass → subtipo OSM + categoría (para categorizar sin importar TS).
// Los selectores vienen entre corchetes (["amenity"~"a|b"]), así que la regex
// debe contemplarlos; los que llevan modificador ("...",i) no describen un
// tag concreto y quedan fuera a propósito (se resuelven por nombre más abajo).
export const TYPE_INDEX = [];
for (const [category, selectors] of Object.entries(CATEGORY_QUERIES)) {
  for (const sel of selectors) {
    const m = sel.match(/^\[\s*"([\w:]+)"\s*(?:~|=)\s*"([^"]+)"\s*\]$/);
    if (!m) continue;
    const [, key, values] = m;
    for (const v of values.split('|')) TYPE_INDEX.push({ category, tagKey: key, value: v });
  }
}

// Espejo de safetySubtypeFromTags (lib/data/poiCategories.ts): la PDI y la
// seguridad ciudadana municipal casi nunca llevan `amenity`, así que se
// derivan del nombre/operador.
export function safetySubtype(tags) {
  const name = `${tags.name || ''} ${tags['name:es'] || ''} ${tags.operator || ''} ${tags.official_name || ''}`;

  const isPdi = /polic[ií]a\s+de\s+investigaciones|\bPDI\b/i.test(name);
  const isMunicipal =
    /seguridad\s+ciudadana|paz\s+ciudadana|inspecci[oó]n\s+municipal|seguridad\s+municipal|direcci[oó]n\s+de\s+seguridad/i.test(name);
  // `\b` para no capturar a "Jardín Infantil Entreteniños" (contiene "reten")
  const isFire = /\bbomberos?\b|\bbombas?\b|cuerpo\s+de\s+bomberos/i.test(name);
  const isPolice =
    /carabinero|comisar[ií]a|subcomisar[ií]a|\btenencia\b|\bret[eé]n\b|prefectura|polic[ií]a/i.test(name);

  if (tags.amenity === 'fire_station') return isPdi ? 'pdi' : 'fire_station';
  if (tags.amenity === 'police') {
    if (isPdi) return 'pdi';
    if (isMunicipal) return 'municipal_security';
    return 'police';
  }

  // Sin tag de tipo de seguridad nos apoyamos en el nombre/operador, pero solo
  // si el elemento no pertenece claramente a otra categoría (si no, un
  // "Restaurante La Comisaría" o una "Panadería La Tenencia" caerían acá).
  // `highway`/`railway`: un paradero o estación llamados "Bomberos" o
  // "Carabineros" (muy comunes, se nombran por el hito cercano) son transporte
  if (tags.shop || tags.leisure || tags.tourism || tags.craft || tags.healthcare) return null;
  if (tags.highway || tags.railway) return null;
  if (tags.amenity) return null;
  if (tags.office && !['government', 'police', 'security'].includes(tags.office)) return null;

  if (isPdi) return 'pdi';
  if (isMunicipal) return 'municipal_security';
  if (isFire) return 'fire_station';
  if (isPolice) return 'police';
  return null;
}

export function categorize(tags) {
  // Seguridad primero: puede venir sin tag de tipo (PDI, seguridad ciudadana) o
  // con uno que otra categoría también usa (`office=government`), y sus propios
  // guards descartan los lugares que pertenecen a otra categoría.
  if (safetySubtype(tags)) return 'safety';
  for (const { category, tagKey, value } of TYPE_INDEX) {
    if (tags[tagKey] === value) return category;
  }
  return null;
}

export function rawType(tags) {
  return (
    tags.amenity ||
    tags.shop ||
    tags.leisure ||
    tags.railway ||
    tags.highway ||
    // Antes de `office`: "PDI" describe mejor el lugar que "government"
    safetySubtype(tags) ||
    tags.office ||
    ''
  );
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass rechaza (406) a clientes sin User-Agent identificable
          'User-Agent': OVERPASS_USER_AGENT,
        },
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
  // `nwr` incluye ways/relations (comisarías, cuarteles y locales suelen ser
  // polígonos del edificio) y `out center` da su centroide.
  const queries = Object.entries(CATEGORY_QUERIES).flatMap(([key, selectors]) =>
    selectors.map((q) => `nwr${q}(around:${SEARCH_RADIUS_M},${lat},${lng});`)
  );
  const query = `[out:json][timeout:25];(${queries.join('\n')});out center;`;
  const data = await fetchOverpass(query);
  const seen = new Set();
  const pois = [];
  for (const element of data.elements || []) {
    if (!element.tags || seen.has(element.id)) continue;
    seen.add(element.id);
    const category = categorize(element.tags);
    if (!category) continue;
    const center = element.center || element;
    if (typeof center.lat !== 'number' || typeof center.lon !== 'number') continue;
    const name = element.tags.name || '';
    // Evita contar dos veces el mismo lugar (nodo + polígono del edificio)
    const duplicate = pois.some(
      (p) =>
        p.category === category &&
        p.name === name &&
        Math.abs(p.lat - center.lat) < 0.0004 &&
        Math.abs(p.lng - center.lon) < 0.0004
    );
    if (duplicate) continue;
    pois.push({
      id: element.id,
      lat: center.lat,
      lng: center.lon,
      name,
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

  // Solo escribir si hubo celdas nuevas: en un job programado (CI) es normal
  // que Overpass esté caído — reescribir el JSON con un `generated_at` fresco
  // produciría un commit de ruido diario sin datos.
  if (ok > 0) {
    snapshot.generated_at = new Date().toISOString();
    writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2));
  } else {
    console.log('[poi-snapshot] sin celdas nuevas: el archivo no se modifica.');
  }
  console.log(`\n[poi-snapshot] listo: ${ok} nuevas, ${skipped} existentes, ${failed} fallidas → ${OUT_PATH}`);
  if (failed > 0) {
    console.log('[poi-snapshot] re-ejecutar más tarde completa las celdas faltantes (Overpass caído hoy).');
    process.exitCode = 1; // señal útil en CI, no rompe el build local
  }
}

// Solo ejecuta el barrido si el script se corre directamente — así los tests
// pueden importar `categorize`, `rawType` y `TYPE_INDEX` sin lanzar consultas.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[poi-snapshot] error fatal:', err);
    process.exit(1);
  });
}
