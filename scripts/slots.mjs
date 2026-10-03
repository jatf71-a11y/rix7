#!/usr/bin/env node
/**
 * Registro local de sesiones vivas sobre este checkout.
 *
 * El aislamiento por slot (ver `next-paths.mjs`) resuelve que dos dev servers no
 * se pisen los artefactos, pero no responde la pregunta que uno se hace **antes**
 * de arrancar: «¿qué está corriendo ya?». Sin eso, el síntoma se descubre tarde
 * —el puerto ocupado, la build que alguien más está midiendo, el `.freebuff/`
 * que crece sin dueño— o, peor, se lanza sin querer un segundo escritor sobre un
 * recurso de un solo escritor.
 *
 * Este módulo mantiene `.freebuff/slots.json`: una entrada por proceso, con
 * puerto (si lo hay), PID, modo (`dev`, `build` o `serve`) y distDir. Lo escriben
 * los wrappers `dev.mjs` y `build.mjs` —no hay estado inventado— y lo lee
 * `npm run slots`, que además limpia las entradas cuyo PID ya no existe.
 *
 * El registro es **una ayuda, no un candado**: si el archivo falta o está roto,
 * todo sigue funcionando (se lee como vacío); nadie bloquea un arranque por no
 * poder leer un JSON de estado local. El PID es la única verdad: una entrada se
 * considera viva si su proceso responde a la señal 0, y se limpia sola cuando
 * muere aunque el proceso nunca llegara a despedirse.
 *
 * Como todo el estado local, vive en `.freebuff/` (ignorado por git y excluido
 * de la copia del deploy) y se escribe de forma atómica: dos procesos pueden
 * registrar a la vez sin dejar un archivo a medias.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DIST_DIR, SLOT_ROOT } from './next-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** El archivo del registro, relativo a la raíz del proyecto. */
export const SLOTS_FILE = `${SLOT_ROOT}/slots.json`;

/** Versión del formato: si cambia la forma, se puede migrar sin adivinar. */
export const REGISTRY_VERSION = 1;

/** Los modos que sabe distinguir el registro. */
export const MODES = ['dev', 'build', 'serve'];

const DEFAULT_FS = { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync };

/**
 * Una sesión registrada.
 *
 * @typedef {object} SlotEntry
 * @property {number} schema
 * @property {number | null} port  puerto de escucha; `null` para una build
 * @property {number} pid
 * @property {string} mode         `dev`, `build` o `serve`
 * @property {string} distDir
 * @property {string} startedAt    ISO 8601
 */

// ═════════════════════════════════════════════════════════════════════════════
// Núcleo puro (probado en slots.test.ts)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Convierte un objeto crudo en una entrada válida, o `null` si no lo es.
 *
 * Tolerante a propósito: el registro es un archivo de estado local que cualquiera
 * puede editar o dejar a medias, así que una entrada sin un PID entero positivo
 * —lo único sin lo cual no se puede juzgar si sigue viva— se descarta en vez de
 * propagar `NaN` por toda la tabla.
 *
 * @param {unknown} raw
 * @param {{ now?: number }} [options]
 * @returns {SlotEntry | null}
 */
export function normalizeEntry(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = /** @type {Record<string, unknown>} */ (raw);

  const pid = Number(record.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const rawPort = Number(record.port);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : null;

  const mode = MODES.includes(String(record.mode)) ? String(record.mode) : 'dev';
  const distDir =
    typeof record.distDir === 'string' && record.distDir.trim() !== '' ? record.distDir : DEFAULT_DIST_DIR;
  const startedAt =
    typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt))
      ? record.startedAt
      : new Date(now).toISOString();

  return { schema: REGISTRY_VERSION, port, pid, mode, distDir, startedAt };
}

/**
 * Lee el texto del registro sin confiar en él.
 *
 * Devuelve `corrupt: true` cuando el JSON no se puede parsear; el llamador lo
 * reporta pero sigue como si estuviera vacío. Un archivo de estado roto no puede
 * tumbar el arranque de un servidor.
 *
 * @param {string} text
 * @param {{ now?: number }} [options]
 * @returns {{ version: number, slots: SlotEntry[], corrupt: boolean }}
 */
export function parseRegistry(text, { now = Date.now() } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { version: REGISTRY_VERSION, slots: [], corrupt: true };
  }

  const raw = Array.isArray(data) ? data : Array.isArray(data?.slots) ? data.slots : [];
  const slots = [];
  for (const item of raw) {
    const entry = normalizeEntry(item, { now });
    if (entry) slots.push(entry);
  }
  return { version: REGISTRY_VERSION, slots, corrupt: false };
}

/**
 * Serializa el registro de forma estable: ordenado por puerto y luego por PID,
 * así dos escritores consecutivos producen el mismo texto (y un diff de estado
 * local no aparece por reordenamientos).
 *
 * @param {Array<Record<string, unknown>>} entries
 */
export function serializeRegistry(entries) {
  const slots = [...entries].sort(
    (a, b) => (Number(a.port) || 0) - (Number(b.port) || 0) || Number(a.pid) - Number(b.pid)
  );
  return `${JSON.stringify({ version: REGISTRY_VERSION, slots }, null, 2)}\n`;
}

/**
 * ¿Sigue vivo el proceso de esa entrada?
 *
 * La señal 0 no envía nada: solo pregunta si el proceso existe. Un `EPERM`
 * significa «existe pero no es mío» —típico en Windows o entre usuarios— y
 * cuenta como vivo; un `ESRCH` es la única respuesta que permite limpiar.
 *
 * `kill` se inyecta para poder probar la clasificación sin depender de PIDs
 * reales.
 *
 * @param {number} pid
 * @param {{ kill?: (pid: number, signal: number | string) => boolean }} [options]
 */
export function isProcessAlive(pid, { kill = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error) && /** @type {{ code?: string }} */ (error).code === 'EPERM';
  }
}

/**
 * Separa las entradas vivas de las obsoletas.
 *
 * @param {SlotEntry[]} entries
 * @param {{ isAlive?: (pid: number) => boolean, now?: number }} [options]
 * @returns {{ live: SlotEntry[], stale: SlotEntry[], now: number }}
 */
export function partitionLive(entries, { isAlive = isProcessAlive, now = Date.now() } = {}) {
  const live = [];
  const stale = [];
  for (const entry of entries) {
    (isAlive(Number(entry.pid)) ? live : stale).push(entry);
  }
  return { live, stale, now };
}

/**
 * «hace cuánto» en una forma corta y legible.
 *
 * @param {string} startedAt
 * @param {number} [now]
 */
export function formatAge(startedAt, now = Date.now()) {
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d`;
}

/** Reparte filas en columnas alineadas; sin dependencias ni ancho de terminal. */
export function renderTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...rows.map((row) => String(row[index] ?? '').length))
  );
  const line = (row) =>
    row
      .map((cell, index) => String(cell ?? '').padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)];
}

/**
 * El informe legible para la consola.
 *
 * @param {{ live: SlotEntry[], stale?: SlotEntry[], corrupt?: boolean }} input
 * @param {{ now?: number }} [options]
 */
export function formatSlots({ live, stale = [], corrupt = false }, { now = Date.now() } = {}) {
  const lines = [''];

  if (corrupt) {
    lines.push('⚠ El registro estaba ilegible (JSON roto); se ignora y se reescribe.', '');
  }

  if (live.length === 0) {
    lines.push('No hay sesiones locales vivas.');
  } else {
    lines.push(`Sesiones locales vivas (${live.length}):`, '');
    lines.push(
      ...renderTable(
        ['PUERTO', 'MODO', 'PID', 'DISTDIR', 'ARRANQUE'],
        live.map((slot) => [
          slot.port ? String(slot.port) : '—',
          slot.mode,
          String(slot.pid),
          String(slot.distDir),
          formatAge(String(slot.startedAt), now),
        ])
      )
    );
  }

  if (stale.length > 0) {
    lines.push(
      '',
      `Entradas obsoletas (${stale.length}) — PID muerto: ${stale
        .map((slot) => `${slot.mode} ${slot.pid}`)
        .join(', ')}`
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Interpreta los argumentos de `npm run slots`.
 *
 * @param {string[]} argv
 * @returns {{ json: boolean, all: boolean, help: boolean }}
 */
export function parseSlotsArgs(argv) {
  const args = { json: false, all: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

// ═════════════════════════════════════════════════════════════════════════════
// Acceso al archivo (el `fs` se inyecta para poder probar sin disco)
// ═════════════════════════════════════════════════════════════════════════════

/** Ruta absoluta del registro, con la raíz inyectable. */
export function registryPath({ root = ROOT, file = SLOTS_FILE } = {}) {
  return resolve(root, file);
}

/**
 * Lee el registro. Nunca lanza: un archivo ausente o ilegible es un registro
 * vacío con la marca de corrupción, no un error de arranque.
 *
 * @param {{ file?: string, fsImpl?: typeof DEFAULT_FS, now?: number }} [options]
 */
export function readRegistry({ file, fsImpl = DEFAULT_FS, now = Date.now() } = {}) {
  const path = file ?? registryPath();
  if (!fsImpl.existsSync(path)) return { version: REGISTRY_VERSION, slots: [], corrupt: false };
  try {
    return parseRegistry(fsImpl.readFileSync(path, 'utf8'), { now });
  } catch {
    return { version: REGISTRY_VERSION, slots: [], corrupt: true };
  }
}

/**
 * Escribe el registro de forma atómica: primero un temporal y después un
 * `rename`, así un lector nunca ve un archivo a medio escribir si dos procesos
 * coinciden.
 *
 * @param {SlotEntry[]} entries
 * @param {{ file?: string, fsImpl?: typeof DEFAULT_FS }} [options]
 */
export function writeRegistry(entries, { file, fsImpl = DEFAULT_FS } = {}) {
  const path = file ?? registryPath();
  fsImpl.mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  fsImpl.writeFileSync(tmp, serializeRegistry(entries));
  fsImpl.renameSync(tmp, path);
  return entries;
}

/**
 * Da de alta una sesión. Reemplaza por PID (un proceso tiene una sola entrada),
 * así reintentar el registro no duplica filas.
 *
 * @param {Record<string, unknown>} entry
 * @param {{ file?: string, fsImpl?: typeof DEFAULT_FS, now?: number }} [options]
 */
export function registerSlot(entry, { file, fsImpl = DEFAULT_FS, now = Date.now() } = {}) {
  const normalized = normalizeEntry(entry, { now });
  if (!normalized) throw new Error('registro inválido: hace falta un pid entero positivo');
  const current = readRegistry({ file, fsImpl, now }).slots.filter((slot) => slot.pid !== normalized.pid);
  current.push(normalized);
  writeRegistry(current, { file, fsImpl });
  return normalized;
}

/**
 * Da de baja una sesión por PID. Devuelve `false` si no había nada que quitar.
 *
 * @param {number} pid
 * @param {{ file?: string, fsImpl?: typeof DEFAULT_FS }} [options]
 */
export function unregisterSlot(pid, { file, fsImpl = DEFAULT_FS } = {}) {
  const path = file ?? registryPath();
  const { slots } = readRegistry({ file: path, fsImpl });
  const rest = slots.filter((slot) => slot.pid !== pid);
  if (rest.length === slots.length) return false;
  writeRegistry(rest, { file: path, fsImpl });
  return true;
}

/**
 * El estado actual: qué está vivo, qué quedó obsoleto y si el archivo estaba
 * roto. Con `prune` (por defecto) reescribe el registro sin las entradas muertas,
 * de modo que `npm run slots` es también la limpieza.
 *
 * @param {{ file?: string, fsImpl?: typeof DEFAULT_FS, isAlive?: (pid: number) => boolean, now?: number, prune?: boolean }} [options]
 * @returns {{ live: SlotEntry[], stale: SlotEntry[], corrupt: boolean }}
 */
export function listSlots({ file, fsImpl = DEFAULT_FS, isAlive = isProcessAlive, now = Date.now(), prune = true } = {}) {
  const path = file ?? registryPath();
  const { slots, corrupt } = readRegistry({ file: path, fsImpl, now });
  const { live, stale } = partitionLive(slots, { isAlive, now });
  if (prune && stale.length > 0) writeRegistry(live, { file: path, fsImpl });
  return { live, stale, corrupt };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI
// ═════════════════════════════════════════════════════════════════════════════

function usage() {
  console.log(
    [
      '',
      'Muestra qué sesiones de trabajo hay vivas sobre este checkout.',
      '',
      '  npm run slots',
      '  npm run slots -- --json     salida para máquinas',
      '  npm run slots -- --all      incluye las entradas obsoletas (no las limpia)',
      '',
      'Opciones:',
      '  --json    imprime JSON en vez de la tabla',
      '  --all     no limpia: muestra también los PID muertos',
      '  --help    esto',
      '',
      'El registro vive en .freebuff/slots.json y lo alimentan `npm run dev` y',
      '`npm run build`. Por defecto se limpian las entradas cuyo proceso murió.',
      '',
    ].join('\n')
  );
}

function main() {
  const args = parseSlotsArgs(process.argv.slice(2));
  if (args.help) return usage();

  const result = listSlots({ prune: !args.all });

  if (args.json) {
    console.log(JSON.stringify({ live: result.live, stale: result.stale }, null, 2));
    return;
  }

  console.log(formatSlots(result));
}

// Solo corre al ejecutarse: así los tests y los wrappers importan el núcleo.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
