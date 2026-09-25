/**
 * Genera `lib/data/poiSnapshot.generated.json`: un snapshot estático de POIs
 * para las propiedades del catálogo manual, consultando Overpass por adelantado.
 * También genera `lib/data/mapSnapshot.generated.json`, con la geometría del
 * sector (calles, parques y agua) que dibuja el mapa de la landing compartible.
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
const MAP_OUT_PATH = join(root, 'lib', 'data', 'mapSnapshot.generated.json');
const FORCE = process.argv.includes('--force');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const SEARCH_RADIUS_M = 1500;

// ═══ Geometría del sector para el mapa de la landing ═══
//
// La landing no pide nada en línea: dibuja el barrio desde este snapshot.
// Solo lo que sirve para dibujar — miles de nodos de calle pesan, así que se
// descarta lo que aporta ruido (vías propuestas, pasos desnivelados, enlaces)
// y se redondean las coordenadas a 5 decimales (~1 m), que es la precisión que
// aguanta un anillo de 15 minutos en un lienzo de ~1.200 unidades.
const KEEP_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'residential', 'unclassified', 'living_street', 'pedestrian',
  'footway', 'path', 'cycleway', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

/** Superficies que hacen que el mapa se lea como un lugar de verdad. */
const AREA_QUERIES = [
  { k: 'water', q: '["natural"="water"]' },
  { k: 'park', q: '["leisure"~"park|garden"]' },
];

/** Redondeo común de la geometría (≈1 m). */
const n5 = (v) => Math.round(v * 100000) / 100000;

// ═══ Simplificación y recorte ═══
//
// Una celda densa trae ~2.000 vías con miles de nodos: sin filtrar, el SVG de la
// landing pesaría cientos de KB. Con dos operaciones (offline, sin volver a
// consultar Overpass) el resultado se ve igual y pesa una fracción:
//
// 1. **Recorte al encuadre**: lo que queda fuera del marco del mapa no se paga.
//    Las vías largas (una avenida que atraviesa la celda) traen nodos kilómetros
//    más allá de lo que se dibuja. El recorte deja una pequeña holgura porque
//    el centro visible es el punto difuminado (hasta 230 m de este).
// 2. **Douglas-Peucker** con tolerancia en metros: elimina nodos cuyo aporte es
//    invisible a la escala del mapa (~1,8 m por unidad del lienzo).
//
// Además cada vía guarda su `name` (cuando lo tiene): es lo que permite rotular
// las calles en el SVG. Sin él el mapa sale mudo y no hay forma de recuperar los
// nombres sin volver a consultar Overpass.
const SIMPLIFY_TOLERANCE_M = 5;
// Encuadre del mapa (viewBox 800×750; el anillo fija la escala por el lado
// corto → 1 unidad ≈ 3,58 m): medio ancho visible ≈ 1.434 m, medio alto ≈
// 1.343 m. El recorte cubre eso más el desplazamiento del punto difuminado
// (230 m) para que las calles lleguen a los bordes: con el valor anterior
// (1.080) el contenido se cortaba a ~1,330 m y los laterales del lienzo
// quedaban en beige, que es lo que hacía que el mapa se viera lejano.
const VIEW_HALF_M = { x: 1200, y: 1350 };
const BLUR_MARGIN_M = 250;

/** Distancia perpendicular de un punto a un segmento, en metros. */
function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker iterativo: devuelve los **índices** que se conservan. */
function simplifyIndices(points, tolerance) {
  if (points.length <= 2) return points.map((_, i) => i);

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = perpendicularDistance(points[i], points[first], points[last]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const indices = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) indices.push(i);
  return indices;
}

/**
 * A metros locales (x este, y norte) respecto del centro de la celda.
 * Corrige por latitud en el eje X para que la escala sea igual en ambos ejes.
 */
function toMeters(ring, centerLat, centerLng) {
  const cos = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  return ring.map(([lat, lng]) => [
    (lng - centerLng) * cos * 111320,
    (lat - centerLat) * 111320,
  ]);
}

/**
 * Recorta al encuadre del mapa y simplifica. Devuelve **tramos**: una vía que
 * entra y sale del marco se convierte en varias, que es lo que `groupRoadPaths`
 * ya espera (subtrazas dentro de un mismo `d`).
 */
function clipAndSimplify(ring, centerLat, centerLng) {
  const meters = toMeters(ring, centerLat, centerLng);
  const maxX = VIEW_HALF_M.x + BLUR_MARGIN_M;
  const maxY = VIEW_HALF_M.y + BLUR_MARGIN_M;
  const inside = (p) => Math.abs(p[0]) <= maxX && Math.abs(p[1]) <= maxY;

  const runs = [];
  let current = [];
  for (let i = 0; i < meters.length; i++) {
    if (inside(meters[i])) {
      current.push(i);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  const out = [];
  for (const run of runs) {
    const runPoints = run.map((i) => meters[i]);
    const kept = simplifyIndices(runPoints, SIMPLIFY_TOLERANCE_M);
    if (kept.length < 2) continue;
    out.push(kept.map((k) => ring[run[k]]));
  }

  return out;
}

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

/**
 * Nombre rotulable de una vía, o `''` si no tiene.
 *
 * OSM a veces guarda varias alternativas separadas por `;`
 * ("Autopista Central;AP"): en el mapa va una sola, la primera.
 */
export function streetNameFromTags(tags) {
  const raw = tags?.name;
  if (typeof raw !== 'string') return '';
  return raw.split(';')[0].trim();
}

async function fetchMapCell(lat, lng) {
  // Una sola consulta para todo el sector: calles + superficies, con `out geom`
  // para traer los nodos (sin eso Overpass devuelve solo los ids).
  const queries = [
    `way["highway"](around:${SEARCH_RADIUS_M},${lat},${lng});`,
    ...AREA_QUERIES.map(({ q }) => `way${q}(around:${SEARCH_RADIUS_M},${lat},${lng});`),
  ];
  const query = `[out:json][timeout:25];(${queries.join('\n')});out geom;`;
  const data = await fetchOverpass(query);

  const roads = [];
  const areas = [];

  for (const element of data.elements || []) {
    if (element.type !== 'way' || !Array.isArray(element.geometry)) continue;

    const tags = element.tags || {};
    const nodes = [];
    let last = null;
    for (const node of element.geometry) {
      if (typeof node?.lat !== 'number' || typeof node?.lon !== 'number') continue;
      const coord = [n5(node.lat), n5(node.lon)];
      // Dos nodos casi superpuestos no cambian la línea y sí pesan.
      if (last && Math.abs(last[0] - coord[0]) < 1e-5 && Math.abs(last[1] - coord[1]) < 1e-5) continue;
      nodes.push(coord);
      last = coord;
    }
    if (nodes.length < 2) continue;

    if (tags.highway && KEEP_HIGHWAY.has(tags.highway)) {
      // Una vía puede rendir varios tramos al recortarla al encuadre
      const name = streetNameFromTags(tags);
      for (const run of clipAndSimplify(nodes, lat, lng)) {
        roads.push(name ? { c: tags.highway, n: run, name } : { c: tags.highway, n: run });
      }
    } else {
      const area = AREA_QUERIES.find(({ k }) =>
        k === 'water' ? tags.natural === 'water' : tags.leisure === 'park' || tags.leisure === 'garden'
      );
      if (area) {
        for (const run of clipAndSimplify(nodes, lat, lng)) {
          areas.push({ k: area.k, n: run });
        }
      }
    }
  }

  return { roads, areas };
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

  // Snapshots previos: conservar celdas ya generadas salvo --force
  const snapshot = existsSync(OUT_PATH) && !FORCE
    ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    : { generated_at: null, cells: {} };
  const mapSnapshot = existsSync(MAP_OUT_PATH) && !FORCE
    ? JSON.parse(readFileSync(MAP_OUT_PATH, 'utf8'))
    : { generated_at: null, cells: {} };

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let mapOk = 0;
  let mapFailed = 0;

  for (const [key, cell] of cells) {
    const needsPois = !snapshot.cells[key];
    // `named` marca las celdas guardadas con nombres de calle: las celdas
    // antiguas se reconsultan una vez para poder rotular el mapa del sector.
    const needsMap = !mapSnapshot.cells[key] || !mapSnapshot.cells[key].named;
    if (!needsPois && !needsMap) {
      skipped += 1;
      continue;
    }

    process.stdout.write(`[poi-snapshot] celda ${key} (${cell.properties.join(', ')})... `);

    // POIs
    if (needsPois) {
      try {
        const pois = await fetchCell(cell.lat, cell.lng);
        // Un espejo degradado puede responder 200 con 0 elementos; guardar esa
        // celda envenenaría el snapshot con "no hay POIs aquí". Solo guardamos
        // celdas con datos reales — las vacías cuentan como fallidas.
        if (pois.length === 0) {
          failed += 1;
          console.log('✗ 0 POIs (respuesta no confiable, no se guarda)');
        } else {
          snapshot.cells[key] = { lat: cell.lat, lng: cell.lng, pois };
          ok += 1;
          console.log(`✓ ${pois.length} POIs`);
        }
      } catch (err) {
        failed += 1;
        console.log(`✗ POIs: ${err.message}`);
      }
      // Cortesía con Overpass: pausa entre consultas
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Geometría del mapa (misma celda, otra consulta)
    if (needsMap) {
      try {
        const { roads, areas } = await fetchMapCell(cell.lat, cell.lng);
        if (roads.length === 0) {
          mapFailed += 1;
          console.log('  ✗ 0 calles (respuesta no confiable, no se guarda)');
        } else {
          mapSnapshot.cells[key] = { lat: cell.lat, lng: cell.lng, roads, areas, named: true };
          mapOk += 1;
          console.log(`  ✓ ${roads.length} vías, ${areas.length} superficies`);
        }
      } catch (err) {
        mapFailed += 1;
        console.log(`  ✗ mapa: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Solo escribir si hubo celdas nuevas: en un job programado (CI) es normal
  // que Overpass esté caído — reescribir el JSON con un `generated_at` fresco
  // produciría un commit de ruido diario sin datos.
  if (ok > 0) {
    snapshot.generated_at = new Date().toISOString();
    writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2));
  } else {
    console.log('[poi-snapshot] sin celdas nuevas de POIs: el archivo no se modifica.');
  }
  if (mapOk > 0) {
    mapSnapshot.generated_at = new Date().toISOString();
    writeFileSync(MAP_OUT_PATH, JSON.stringify(mapSnapshot));
  } else {
    console.log('[poi-snapshot] sin celdas nuevas de mapa: el archivo no se modifica.');
  }

  console.log(`\n[poi-snapshot] POIs: ${ok} nuevas, ${failed} fallidas → ${OUT_PATH}`);
  console.log(`[poi-snapshot] mapa: ${mapOk} nuevas, ${mapFailed} fallidas → ${MAP_OUT_PATH}`);
  console.log(`[poi-snapshot] ${skipped} celdas ya completas`);
  if (failed > 0 || mapFailed > 0) {
    console.log('[poi-snapshot] re-ejecutar más tarde completa las celdas faltantes (Overpass caído hoy).');
    process.exitCode = 1; // señal útil en CI, no rompe el build local
  }
}

/**
 * Modo `--simplify`: recorta y simplifica un snapshot de mapa ya generado,
 * **sin red**.
 *
 * Existe porque la geometría cruda pesa una fracción más de lo razonable para
 * un HTML que se sirve completo, y aplicarle el filtro no requiere volver a
 * consultar Overpass: es un transformado local sobre el archivo que ya está.
 * También permite aplicar una mejora del filtro a todo el snapshot sin gastar
 * cuota del mirror.
 */
async function simplifyExisting() {
  if (!existsSync(MAP_OUT_PATH)) {
    console.log('[poi-snapshot] --simplify: no hay snapshot de mapa todavía.');
    return;
  }

  const snapshot = JSON.parse(readFileSync(MAP_OUT_PATH, 'utf8'));
  let beforeNodes = 0;
  let afterNodes = 0;
  let cells = 0;

  const transform = (entries, lat, lng) => {
    const out = [];
    for (const entry of entries || []) {
      beforeNodes += entry.n.length;
      for (const run of clipAndSimplify(entry.n, lat, lng)) {
        afterNodes += run.length;
        out.push({ ...entry, n: run });
      }
    }
    return out;
  };

  for (const key of Object.keys(snapshot.cells)) {
    const cell = snapshot.cells[key];
    cells += 1;
    cell.roads = transform(cell.roads, cell.lat, cell.lng);
    cell.areas = transform(cell.areas, cell.lat, cell.lng);
  }

  writeFileSync(MAP_OUT_PATH, JSON.stringify(snapshot));
  const pct = beforeNodes > 0 ? Math.round((1 - afterNodes / beforeNodes) * 100) : 0;
  console.log(
    `[poi-snapshot] --simplify: ${cells} celdas, ${beforeNodes} → ${afterNodes} nodos (-${pct}%)`
  );
}

// Solo ejecuta el barrido si el script se corre directamente — así los tests
// pueden importar `categorize`, `rawType` y `TYPE_INDEX` sin lanzar consultas.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv.includes('--simplify') ? simplifyExisting() : main();
  run.catch((err) => {
    console.error('[poi-snapshot] error fatal:', err);
    process.exit(1);
  });
}
