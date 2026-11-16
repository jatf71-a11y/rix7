import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  compareWithManifest,
  dumpFileName,
  isDumpable,
  manifestEntry,
  parseArgs,
  readDump,
  sha256,
} from './db-backup.mjs';

describe('parseArgs', () => {
  it('sin argumentos exporta', () => {
    expect(parseArgs([])).toEqual({
      verify: null,
      restore: null,
      into: null,
      key: null,
      yes: false,
      allowSame: false,
      help: false,
    });
  });

  it('--restore exige destino y confirmación explícita', () => {
    expect(parseArgs(['--restore', '.backups/x']).error).toContain('--into');
    expect(parseArgs(['--restore', '.backups/x', '--into', 'https://x.supabase.co']).error).toContain(
      '--yes'
    );
  });

  it('con --yes y destino queda listo', () => {
    const args = parseArgs([
      '--restore',
      '.backups/x',
      '--into',
      'https://x.supabase.co',
      '--key',
      'k',
      '--yes',
    ]);
    expect(args.error).toBeUndefined();
    expect(args.restore).toBe('.backups/x');
  });

  it('una opción desconocida corta antes de escribir nada', () => {
    expect(parseArgs(['--forzar']).error).toContain('--forzar');
  });
});

describe('manifestEntry + compareWithManifest', () => {
  const bytes = gzipSync(Buffer.from('{"id":1}\n'));
  const entry = manifestEntry({ table: 'leads', pk: 'id', rows: 1, buffer: bytes });

  it('la entrada guarda filas y checksum', () => {
    expect(entry).toMatchObject({ name: 'leads', pk: 'id', rows: 1, bytes: bytes.length });
    expect(entry.sha256).toBe(sha256(bytes));
  });

  it('una copia íntegra no devuelve problemas', () => {
    expect(compareWithManifest({ tables: [entry] }, { leads: { bytes, rows: 1 } })).toEqual([]);
  });

  it('detecta un archivo alterado', () => {
    const other = gzipSync(Buffer.from('{"id":2}\n'));
    expect(compareWithManifest({ tables: [entry] }, { leads: { bytes: other, rows: 1 } })).toContain(
      'leads: checksum distinto'
    );
  });

  it('detecta un archivo faltante y uno sobrante', () => {
    const problems = compareWithManifest({ tables: [entry] }, {});
    expect(problems).toContain('falta leads');
    const extra = compareWithManifest({ tables: [] }, { leads: { bytes, rows: 1 } });
    expect(extra).toContain('leads: archivo sin entrada en el manifiesto');
  });

  it('detecta filas de menos', () => {
    expect(compareWithManifest({ tables: [entry] }, { leads: { bytes, rows: 0 } })).toContain(
      'leads: 0 filas en disco, 1 en el manifiesto'
    );
  });
});

describe('readDump', () => {
  it('devuelve las filas de un JSONL comprimido', () => {
    const buffer = gzipSync(Buffer.from('{"id":1}\n{"id":2}\n'));
    const { rows, data } = readDump(buffer);
    expect(rows).toBe(2);
    expect(data[1]).toEqual({ id: 2 });
  });

  it('una tabla vacía son cero filas, no un error', () => {
    expect(readDump(gzipSync(Buffer.from(''))).rows).toBe(0);
  });
});

describe('isDumpable', () => {
  it('deja fuera los catálogos de PostGIS', () => {
    expect(isDumpable('spatial_ref_sys')).toBe(false);
    expect(isDumpable('geometry_columns')).toBe(false);
  });

  it('incluye las tablas del proyecto', () => {
    expect(isDumpable('leads')).toBe(true);
    expect(isDumpable('email_log')).toBe(true);
  });
});

describe('dumpFileName', () => {
  it('un archivo por tabla', () => {
    expect(dumpFileName('email_log')).toBe('email_log.jsonl.gz');
  });
});
