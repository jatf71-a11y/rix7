/**
 * Tests del registro local de sesiones.
 *
 * Lo que se protege acá es que el registro sea **tolerante** (un archivo de
 * estado local nunca puede tumbar un arranque: si falta, está roto o tiene
 * basura, se lee como vacío) y que el PID sea la única verdad sobre qué está
 * vivo. También que dar de alta dos veces el mismo proceso no duplique filas y
 * que escribir sea atómico: los wrappers de dev y build escriben el mismo
 * archivo, así que un lector no puede encontrarlo a medias.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_DIST_DIR } from './next-paths.mjs';
import {
  REGISTRY_VERSION,
  formatAge,
  formatSlots,
  isProcessAlive,
  listSlots,
  normalizeEntry,
  parseRegistry,
  parseSlotsArgs,
  partitionLive,
  registerSlot,
  registryPath,
  renderTable,
  serializeRegistry,
  unregisterSlot,
} from './slots.mjs';

/** `fs` en memoria: prueba la lógica de archivo sin tocar el disco. */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    existsSync: (path: string) => files.has(path),
    readFileSync: (path: string) => {
      const value = files.get(path);
      if (value === undefined) {
        const error = Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        throw error;
      }
      return value;
    },
    writeFileSync: (path: string, data: string) => {
      files.set(path, String(data));
    },
    renameSync: (from: string, to: string) => {
      const value = files.get(from);
      if (value === undefined) {
        const error = Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
        throw error;
      }
      files.delete(from);
      files.set(to, value);
    },
    mkdirSync: () => {},
  };
}

/** Entrada válida con overrides, para no repetir seis campos en cada caso. */
const entry = (overrides: Record<string, unknown> = {}) => ({
  port: 3111,
  pid: 4242,
  mode: 'dev',
  distDir: '.freebuff/rix7-next-3111',
  startedAt: '2026-10-02T10:00:00.000Z',
  ...overrides,
});

/** La forma normalizada que `partitionLive` consume. */
type SlotEntry = NonNullable<ReturnType<typeof normalizeEntry>>;
const normalizeAll = (raw: Record<string, unknown>[]): SlotEntry[] =>
  raw.map((item) => normalizeEntry(item)).filter((item): item is SlotEntry => item !== null);

describe('normalizeEntry', () => {
  it('exige un PID positivo: sin él no se puede juzgar si está vivo', () => {
    expect(normalizeEntry({ pid: undefined })).toBeNull();
    expect(normalizeEntry({ pid: 0 })).toBeNull();
    expect(normalizeEntry({ pid: -3 })).toBeNull();
    expect(normalizeEntry({ pid: 'no-numero' })).toBeNull();
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry([])).toBeNull();
  });

  it('acepta un PID como número o como texto', () => {
    expect(normalizeEntry({ pid: 4242 })?.pid).toBe(4242);
    expect(normalizeEntry({ pid: '4242' })?.pid).toBe(4242);
  });

  it('un puerto inválido queda como «sin puerto», no como NaN', () => {
    expect(normalizeEntry({ pid: 1, port: 'abc' })?.port).toBeNull();
    expect(normalizeEntry({ pid: 1, port: 0 })?.port).toBeNull();
    expect(normalizeEntry({ pid: 1, port: '3939' })?.port).toBe(3939);
  });

  it('un modo desconocido cae a `dev` en vez de propagarse', () => {
    expect(normalizeEntry({ pid: 1, mode: 'hackeado' })?.mode).toBe('dev');
    expect(normalizeEntry({ pid: 1, mode: 'build' })?.mode).toBe('build');
  });

  it('rellena distDir y startedAt para que la tabla nunca muestre vacíos', () => {
    const filled = normalizeEntry({ pid: 1, distDir: '  ' }, { now: Date.parse('2026-10-02T12:00:00Z') });
    expect(filled?.distDir).toBe(DEFAULT_DIST_DIR);
    expect(filled?.startedAt).toBe('2026-10-02T12:00:00.000Z');

    const badDate = normalizeEntry({ pid: 1, startedAt: 'ayer' });
    expect(Number.isFinite(Date.parse(badDate?.startedAt ?? ''))).toBe(true);
  });
});

describe('parseRegistry', () => {
  it('un JSON roto no lanza: se lee como vacío y avisado', () => {
    const result = parseRegistry('{ no es json');
    expect(result.slots).toEqual([]);
    expect(result.corrupt).toBe(true);
  });

  it('acepta el formato con envoltorio y el array pelado', () => {
    const withWrapper = parseRegistry(JSON.stringify({ version: 1, slots: [entry()] }));
    expect(withWrapper.slots).toHaveLength(1);
    const bare = parseRegistry(JSON.stringify([entry()]));
    expect(bare.slots).toHaveLength(1);
  });

  it('descarta las entradas inválidas sin perder las buenas', () => {
    const result = parseRegistry(JSON.stringify({ slots: [entry(), { pid: 0 }, 'basura'] }));
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].pid).toBe(4242);
  });

  it('un objeto sin `slots` es un registro vacío, no un error', () => {
    expect(parseRegistry('{}').slots).toEqual([]);
    expect(parseRegistry('{}').corrupt).toBe(false);
  });
});

describe('serializeRegistry', () => {
  it('ordena por puerto y luego por PID: el mismo estado da el mismo texto', () => {
    const text = serializeRegistry([
      { schema: 1, port: null, pid: 20, mode: 'build', distDir: '.next', startedAt: '' },
      { schema: 1, port: 3939, pid: 10, mode: 'dev', distDir: '.freebuff/x', startedAt: '' },
      { schema: 1, port: 3111, pid: 30, mode: 'dev', distDir: '.freebuff/y', startedAt: '' },
    ]);
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(REGISTRY_VERSION);
    // Sin puerto primero (0), después 3111 y 3939.
    expect(parsed.slots.map((slot: { pid: number }) => slot.pid)).toEqual([20, 30, 10]);
  });

  it('sobrevive a un viaje de ida y vuelta', () => {
    const original = parseRegistry(serializeRegistry([entry()]));
    expect(original.slots[0].pid).toBe(4242);
    expect(original.slots[0].mode).toBe('dev');
  });
});

describe('isProcessAlive', () => {
  it('está vivo si `kill(pid, 0)` no lanza', () => {
    expect(isProcessAlive(1234, { kill: () => true })).toBe(true);
  });

  it('un EPERM cuenta como vivo: el proceso existe pero no es nuestro', () => {
    const kill = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    };
    expect(isProcessAlive(1234, { kill })).toBe(true);
  });

  it('un ESRCH es la única respuesta que permite limpiar', () => {
    const kill = () => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    };
    expect(isProcessAlive(1234, { kill })).toBe(false);
  });

  it('un PID inválido ni siquiera se pregunta', () => {
    let called = 0;
    const kill = () => {
      called += 1;
      return true;
    };
    expect(isProcessAlive(0, { kill })).toBe(false);
    expect(isProcessAlive(NaN, { kill })).toBe(false);
    expect(called).toBe(0);
  });
});

describe('partitionLive', () => {
  const entries = normalizeAll([entry({ pid: 1 }), entry({ pid: 2 }), entry({ pid: 3 })]);

  it('separa vivas de obsoletas por PID', () => {
    const { live, stale } = partitionLive(entries, { isAlive: (pid) => pid !== 2 });
    expect(live.map((slot) => slot.pid)).toEqual([1, 3]);
    expect(stale.map((slot) => slot.pid)).toEqual([2]);
  });

  it('sin ninguna viva, todo es obsoleto', () => {
    expect(partitionLive(entries, { isAlive: () => false }).live).toEqual([]);
  });
});

describe('formatAge', () => {
  const t0 = Date.parse('2026-10-02T10:00:00Z');

  it('elige la unidad según el tiempo transcurrido', () => {
    expect(formatAge('2026-10-02T10:00:00Z', t0 + 3_000)).toBe('3s');
    expect(formatAge('2026-10-02T10:00:00Z', t0 + 5 * 60_000)).toBe('5 min');
    expect(formatAge('2026-10-02T10:00:00Z', t0 + 90 * 60_000)).toBe('1 h 30 min');
    expect(formatAge('2026-10-02T10:00:00Z', t0 + 50 * 3600_000)).toBe('2 d');
  });

  it('una fecha ilegible o futura no rompe la tabla', () => {
    expect(formatAge('ayer', t0)).toBe('—');
    expect(formatAge('2026-10-03T10:00:00Z', t0)).toBe('—');
  });
});

describe('formatSlots', () => {
  const now = Date.parse('2026-10-02T10:10:00Z');
  const session = normalizeEntry(entry({ pid: 5880 }), { now })!;
  const stale = normalizeEntry(entry({ pid: 9999, mode: 'build', port: null }), { now })!;

  it('sin nada vivo lo dice explícitamente', () => {
    expect(formatSlots({ live: [] })).toContain('No hay sesiones locales vivas');
  });

  it('nombra puerto, modo, PID y distDir de cada sesión', () => {
    const text = formatSlots({ live: [session] }, { now });
    expect(text).toContain('3111');
    expect(text).toContain('dev');
    expect(text).toContain('5880');
    expect(text).toContain('.freebuff/rix7-next-3111');
    expect(text).toContain('PUERTO');
  });

  it('una build sin puerto se muestra con guion, no vacío', () => {
    const build = normalizeEntry(entry({ pid: 7, mode: 'build', port: null }), { now })!;
    expect(formatSlots({ live: [build] }, { now })).toContain('—');
  });

  it('reporta las obsoletas y el registro ilegible', () => {
    const text = formatSlots({ live: [], stale: [stale], corrupt: true }, { now });
    expect(text).toContain('ilegible');
    expect(text).toContain('Entradas obsoletas (1)');
    expect(text).toContain('9999');
  });
});

describe('renderTable', () => {
  it('alinea las columnas al ancho mayor', () => {
    const [header, first] = renderTable(['A', 'LARGA'], [['x', 'y']]);
    expect(header).toBe('A  LARGA');
    expect(first).toBe('x  y');
  });
});

describe('parseSlotsArgs', () => {
  it('reconoce --json y --all', () => {
    expect(parseSlotsArgs(['--json', '--all'])).toEqual({ json: true, all: true, help: false });
    expect(parseSlotsArgs([]).json).toBe(false);
  });

  it('reconoce --help y -h', () => {
    expect(parseSlotsArgs(['--help']).help).toBe(true);
    expect(parseSlotsArgs(['-h']).help).toBe(true);
  });
});

describe('acceso al archivo', () => {
  const FILE = '/repo/.freebuff/slots.json';

  it('un archivo que no existe es un registro vacío, no un error', () => {
    const fs = memoryFs();
    const result = listSlots({ file: FILE, fsImpl: fs as never, isAlive: () => true });
    expect(result.live).toEqual([]);
    expect(result.corrupt).toBe(false);
  });

  it('registrar escribe con temporal y rename: nadie ve un archivo a medias', () => {
    const fs = memoryFs();
    registerSlot(entry({ pid: 1 }), { file: FILE, fsImpl: fs as never });
    expect(fs.existsSync(FILE)).toBe(true);
    expect(fs.files.has(`${FILE}.${process.pid}.tmp`)).toBe(false);
    const written = JSON.parse(fs.readFileSync(FILE));
    expect(written.slots[0].pid).toBe(1);
  });

  it('registrar el mismo PID reemplaza, no duplica', () => {
    const fs = memoryFs();
    registerSlot(entry({ pid: 5, port: 3111 }), { file: FILE, fsImpl: fs as never });
    registerSlot(entry({ pid: 5, port: 3939 }), { file: FILE, fsImpl: fs as never });
    const { slots } = parseRegistry(fs.readFileSync(FILE));
    expect(slots).toHaveLength(1);
    expect(slots[0].port).toBe(3939);
  });

  it('dar de baja devuelve false si no había nada que quitar', () => {
    const fs = memoryFs();
    expect(unregisterSlot(5, { file: FILE, fsImpl: fs as never })).toBe(false);
    registerSlot(entry({ pid: 5 }), { file: FILE, fsImpl: fs as never });
    expect(unregisterSlot(5, { file: FILE, fsImpl: fs as never })).toBe(true);
    expect(fs.existsSync(FILE)).toBe(true);
    expect(unregisterSlot(6, { file: FILE, fsImpl: fs as never })).toBe(false);
  });

  it('listar limpia del archivo las entradas cuyo PID murió', () => {
    const fs = memoryFs();
    registerSlot(entry({ pid: 1 }), { file: FILE, fsImpl: fs as never });
    registerSlot(entry({ pid: 2, port: 3939 }), { file: FILE, fsImpl: fs as never });

    const result = listSlots({ file: FILE, fsImpl: fs as never, isAlive: (pid) => pid === 1 });
    expect(result.live.map((slot) => slot.pid)).toEqual([1]);
    expect(result.stale.map((slot) => slot.pid)).toEqual([2]);

    // El archivo quedó limpio: el siguiente hilo ya no ve la entrada muerta.
    const onDisk = parseRegistry(fs.readFileSync(FILE));
    expect(onDisk.slots.map((slot) => slot.pid)).toEqual([1]);
  });

  it('con `prune: false` informa las obsoletas sin tocar el archivo', () => {
    const fs = memoryFs();
    registerSlot(entry({ pid: 2 }), { file: FILE, fsImpl: fs as never });
    const result = listSlots({ file: FILE, fsImpl: fs as never, isAlive: () => false, prune: false });
    expect(result.stale).toHaveLength(1);
    expect(parseRegistry(fs.readFileSync(FILE)).slots).toHaveLength(1);
  });

  it('registryPath resuelve contra la raíz indicada', () => {
    const root = process.cwd();
    expect(registryPath({ root })).toBe(join(root, '.freebuff', 'slots.json'));
  });

  it('contra disco real: alta, listado y baja de ida y vuelta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rix7-slots-'));
    const file = join(dir, 'slots.json');
    try {
      registerSlot(entry({ pid: process.pid }), { file });
      const live = listSlots({ file, isAlive: () => true });
      expect(live.live).toHaveLength(1);
      expect(live.live[0].pid).toBe(process.pid);

      unregisterSlot(process.pid, { file });
      expect(listSlots({ file }).live).toEqual([]);
      expect(readFileSync(file, 'utf8')).toContain('"slots": []');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
