/**
 * Tests del aplicador de migraciones.
 *
 * Hay dos partes bien distintas:
 *
 * 1. **El núcleo** (ordenar, validar, decidir qué falta, aplicar con la red
 *    inyectada): errores acá harían que el script dijera «al día» con migraciones
 *    sin aplicar, que es justo el pendiente que existe para eliminar.
 * 2. **Los archivos reales** de `supabase/migrations/`: que estén numerados y que
 *    sean idempotentes. Es la parte que importa a largo plazo — la garantía de
 *    «aplicar dos veces no rompe nada» deja de depender de que alguien se
 *    acuerde al escribir el próximo archivo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  applyMigrations,
  diffAgainstLedger,
  fingerprint,
  formatStatus,
  ledgerBootstrapSql,
  ledgerInsertSql,
  migrationSql,
  parseMigrationName,
  planMigrations,
  queryEndpoint,
  runQuery,
  type Migration,
} from './db-push.mjs';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');

/** Los archivos que se van a aplicar de verdad, no un ejemplo. */
const realFiles = readdirSync(MIGRATIONS_DIR)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()
  .map((fileName) => ({
    fileName,
    content: readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf8'),
  }));

const migration = (version: string, name: string, checksum = 'x'): Migration => ({
  version,
  name,
  fileName: `${version}_${name}.sql`,
  checksum,
});

describe('parseMigrationName', () => {
  it('separa el número y el nombre', () => {
    expect(parseMigrationName('0010_signups.sql')).toEqual({ version: '0010', name: 'signups' });
    // Los nombres usan guiones y guiones bajos indistintamente.
    expect(parseMigrationName('0002_properties_rls-y-storage.sql')).toEqual({
      version: '0002',
      name: 'properties_rls-y-storage',
    });
  });

  it('rechaza lo que no sigue la convención', () => {
    // El orden de aplicación depende del número: un archivo sin número no se
    // puede ordenar ni registrar.
    expect(parseMigrationName('signups.sql')).toBeNull();
    expect(parseMigrationName('10_signups.sql')).toBeNull();
    expect(parseMigrationName('0010_signups.SQL')).toBeNull();
    expect(parseMigrationName('0010_Signups.sql')).toBeNull();
    expect(parseMigrationName('0010_sign ups.sql')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('ignora los finales de línea: el repo se usa en Windows y en CI', () => {
    expect(fingerprint('SELECT 1;\r\n')).toBe(fingerprint('SELECT 1;\n'));
  });

  it('cambia si cambia el contenido', () => {
    expect(fingerprint('SELECT 1;')).not.toBe(fingerprint('SELECT 2;'));
  });

  it('no explota sin contenido', () => {
    expect(fingerprint(undefined)).toBe(fingerprint(''));
  });
});

describe('planMigrations', () => {
  it('ordena por número, no por nombre de archivo', () => {
    const plan = planMigrations([
      { fileName: '0010_b.sql', content: 'b' },
      { fileName: '0002_a.sql', content: 'a' },
    ]);

    expect(plan.errors).toEqual([]);
    expect(plan.migrations.map((m) => m.version)).toEqual(['0002', '0010']);
  });

  it('reporta un archivo fuera de la convención sin aplicarlo', () => {
    const plan = planMigrations([{ fileName: 'cosas.sql', content: 'a' }]);

    expect(plan.migrations).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('cosas.sql');
  });

  it('reporta una versión repetida', () => {
    const plan = planMigrations([
      { fileName: '0001_a.sql', content: 'a' },
      { fileName: '0001_b.sql', content: 'b' },
    ]);

    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('repetida');
    expect(plan.migrations.map((m) => m.name)).toEqual(['a']);
  });

  it('avisa de un hueco en la numeración', () => {
    const plan = planMigrations([
      { fileName: '0001_a.sql', content: 'a' },
      { fileName: '0003_c.sql', content: 'c' },
    ]);

    expect(plan.errors).toEqual([]);
    expect(plan.gaps[0]).toContain('0002');
  });
});

describe('diffAgainstLedger', () => {
  const migrations = [migration('0001', 'a', 'h1'), migration('0002', 'b', 'h2')];

  it('deja pendiente lo que no está registrado', () => {
    const diff = diffAgainstLedger(migrations, []);

    expect(diff.pending.map((m) => m.version)).toEqual(['0001', '0002']);
    expect(diff.alreadyApplied).toEqual([]);
  });

  it('no repite lo ya aplicado con la misma huella', () => {
    const diff = diffAgainstLedger(migrations, [{ version: '0001', checksum: 'h1' }]);

    expect(diff.pending.map((m) => m.version)).toEqual(['0002']);
    expect(diff.drifted).toEqual([]);
  });

  it('vuelve a aplicar una migración editada después de aplicarse', () => {
    // La promesa es que la base quede como los archivos. Si el archivo cambió,
    // la base está desactualizada aunque el número ya esté registrado.
    const diff = diffAgainstLedger(migrations, [{ version: '0001', checksum: 'vieja' }]);

    expect(diff.drifted.map((m) => m.version)).toEqual(['0001']);
    expect(diff.pending.map((m) => m.version)).toEqual(['0002']);
  });

  it('avisa de versiones registradas que ya no tienen archivo', () => {
    const diff = diffAgainstLedger(migrations, [
      { version: '0001', checksum: 'h1' },
      { version: '0002', checksum: 'h2' },
      { version: '0009', checksum: 'h9' },
    ]);

    expect(diff.missingFiles).toEqual(['0009']);
  });

  it('no se rompe si el registro viene raro', () => {
    expect(diffAgainstLedger(migrations, undefined as never).pending).toHaveLength(2);
  });
});

describe('SQL del registro', () => {
  it('el registro se crea de forma idempotente y sin quedar público', () => {
    const sql = ledgerBootstrapSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('registrar una migración también actualiza su huella', () => {
    const sql = ledgerInsertSql(migration('0003', 'properties', 'abc'));

    expect(sql).toContain("'0003'");
    expect(sql).toContain("'abc'");
    expect(sql).toContain('ON CONFLICT (version) DO UPDATE');
    expect(sql).toContain('RETURNING version');
  });

  it('normaliza los finales de línea del archivo que se aplica', () => {
    expect(migrationSql(migration('0001', 'a'), 'SELECT 1;\r\n')).toBe('SELECT 1;\n');
  });
});

describe('runQuery', () => {
  it('manda la consulta a la API de administración con el token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 201 }));
    const result = await runQuery({
      ref: 'abcdefghij',
      token: 'tok',
      query: 'SELECT 1;',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(queryEndpoint('abcdefghij')).toBe(
      'https://api.supabase.com/v1/projects/abcdefghij/database/query'
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/projects/abcdefghij/database/query');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body)).query).toBe('SELECT 1;');
  });

  it('devuelve el error del servidor en vez de tirarlo', async () => {
    const fetchImpl = vi.fn(async () => new Response('relation does not exist', { status: 400 }));
    const result = await runQuery({
      ref: 'r',
      token: 't',
      query: 'SELECT 1;',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('relation does not exist');
  });

  it('sobrevive a una caída de red', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('sin red');
    });
    const result = await runQuery({
      ref: 'r',
      token: 't',
      query: 'SELECT 1;',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('sin red');
  });
});

describe('applyMigrations', () => {
  const contents = new Map([
    ['0001_a.sql', 'SELECT 1;'],
    ['0002_b.sql', 'SELECT 2;'],
  ]);

  it('aplica en orden y registra cada una', async () => {
    const queries: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      queries.push(JSON.parse(String(init.body)).query);
      return new Response('[]', { status: 201 });
    });

    const result = await applyMigrations({
      ref: 'r',
      token: 't',
      migrations: [migration('0001', 'a', 'h1'), migration('0002', 'b', 'h2')],
      contents,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.failed).toBeNull();
    expect(result.applied.map((s) => s.version)).toEqual(['0001_a', '0002_b']);
    // Cada migración son dos consultas: el SQL y su registro.
    expect(queries).toHaveLength(4);
    expect(queries[0]).toBe('SELECT 1;');
    expect(queries[1]).toContain("'0001'");
  });

  it('se detiene en el primer fallo: lo siguiente puede depender de eso', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body));
      return query === 'SELECT 2;'
        ? new Response('boom', { status: 400 })
        : new Response('[]', { status: 201 });
    });

    const result = await applyMigrations({
      ref: 'r',
      token: 't',
      migrations: [migration('0001', 'a', 'h1'), migration('0002', 'b', 'h2')],
      contents,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.applied).toHaveLength(1);
    expect(result.failed?.version).toBe('0002_b');
    expect(result.failed?.error).toContain('boom');
  });

  it('no dice que registró algo que no pudo registrar', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body));
      return query.includes('INSERT INTO') ? new Response('nope', { status: 500 }) : new Response('[]', { status: 201 });
    });

    const result = await applyMigrations({
      ref: 'r',
      token: 't',
      migrations: [migration('0001', 'a', 'h1')],
      contents,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.applied).toEqual([]);
    expect(result.failed?.error).toContain('no se pudo registrar');
  });
});

describe('informes', () => {
  it('no promete que hay cambios cuando no hay nada pendiente', () => {
    const text = formatStatus({
      migrations: [migration('0001', 'a')],
      errors: [],
      gaps: [],
      pending: [],
      drifted: [],
      alreadyApplied: [migration('0001', 'a')],
      missingFiles: [],
    });

    expect(text).toContain('al día');
    expect(text).not.toContain('npm run db:push');
  });

  it('dice cómo aplicar cuando sí hay pendientes', () => {
    const text = formatStatus({
      migrations: [migration('0002', 'b')],
      errors: [],
      gaps: [],
      pending: [migration('0002', 'b')],
      drifted: [],
      alreadyApplied: [],
      missingFiles: [],
    });

    expect(text).toContain('Pendientes (1)');
    expect(text).toContain('npm run db:push');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Los archivos reales
// ═════════════════════════════════════════════════════════════════════════════

describe('supabase/migrations (archivos reales)', () => {
  it('hay migraciones y todas siguen la convención', () => {
    const plan = planMigrations(realFiles);

    expect(realFiles.length).toBeGreaterThan(0);
    expect(plan.errors).toEqual([]);
    expect(plan.gaps).toEqual([]);
  });

  it('ninguna está vacía', () => {
    for (const file of realFiles) {
      // Solo comentarios significa que el archivo no hace nada: se aplicó por
      // error o se quedó a medias.
      const statements = file.content
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('')
        .trim();

      expect(statements.length, file.fileName).toBeGreaterThan(0);
    }
  });

  it('toda creación es idempotente', () => {
    for (const file of realFiles) {
      expect(file.content, file.fileName).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
      expect(file.content, file.fileName).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
      expect(file.content, file.fileName).not.toMatch(/CREATE UNIQUE INDEX (?!IF NOT EXISTS)/);
    }
  });

  it('toda política se descarta antes de crearse', () => {
    // Fue el defecto real del schema.sql monolítico: cuatro políticas de
    // `properties` y dos de Storage se creaban sin DROP, así que la segunda
    // ejecución del archivo fallaba a mitad de camino.
    const allCreated: string[] = [];

    for (const file of realFiles) {
      // `Array.from` y no spread: el `target` del proyecto es es5 y un spread de
      // un iterador no compila sin `downlevelIteration`.
      const created = Array.from(
        file.content.matchAll(/CREATE POLICY\s+"([^"]+)"/g),
        (m) => m[1]
      );
      const dropped = new Set(
        Array.from(file.content.matchAll(/DROP POLICY IF EXISTS\s+"([^"]+)"/g), (m) => m[1])
      );

      for (const policy of created) {
        expect(dropped.has(policy), `${file.fileName}: la política "${policy}" no se descarta antes`).toBe(true);
      }
      allCreated.push(...created);
    }

    // Sin esto el test pasaría si un día se dejaran de crear políticas.
    expect(allCreated.length).toBeGreaterThan(0);
  });

  it('nada borra datos: solo se sueltan políticas', () => {
    for (const file of realFiles) {
      const drops = Array.from(file.content.matchAll(/DROP\s+(\w+)/g), (m) => m[1].toUpperCase());
      for (const object of drops) {
        expect(object, `${file.fileName}: DROP ${object}`).toBe('POLICY');
      }
      expect(file.content, file.fileName).not.toMatch(/\bTRUNCATE\b/i);
      expect(file.content, file.fileName).not.toMatch(/\bDELETE FROM\b/i);
    }
  });

  it('crea las corredoras antes que las propiedades, que las referencian', () => {
    // El schema.sql monolítico creaba `properties` con FK a `public.partners`
    // antes de crear esa tabla: una base vacía no se podía crear de cero.
    const partnersAt = realFiles.findIndex(
      (f) => f.content.includes('CREATE TABLE IF NOT EXISTS public.partners')
    );
    const propertiesAt = realFiles.findIndex((f) =>
      f.content.includes('CREATE TABLE IF NOT EXISTS public.properties')
    );

    expect(partnersAt).toBeGreaterThanOrEqual(0);
    expect(propertiesAt).toBeGreaterThan(partnersAt);
    expect(realFiles[propertiesAt].content).toContain('REFERENCES public.partners(id)');
  });
});
