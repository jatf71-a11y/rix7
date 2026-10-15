/**
 * Tests del SQL que se pega en el editor del dashboard.
 *
 * Lo que no puede fallar en silencio: el **orden** (una migración que depende de
 * otra no puede ir antes), que cada migración quede registrada en el libro
 * pegada a su contenido, y que todo vaya en una transacción — porque este camino
 * existe justo para cuando no hay token y nadie puede mirar la base después.
 */
import { describe, expect, it } from 'vitest';

import { applyPlan, renderApplySql } from './db-apply-sql.mjs';
import { fingerprint, ledgerInsertSql, MIGRATION_FILE, migrationSql } from './db-push.mjs';

const file = (fileName: string, content: string) => ({ fileName, content });

const TRES = [
  file('0001_extension_postgis.sql', 'CREATE EXTENSION IF NOT EXISTS postgis;\n'),
  file('0002_partners.sql', 'CREATE TABLE IF NOT EXISTS public.partners (id TEXT PRIMARY KEY);\n'),
  file('0003_properties.sql', "CREATE TABLE IF NOT EXISTS public.properties (id UUID);\n"),
];

describe('applyPlan', () => {
  it('ordena por número, aunque los archivos lleguen desordenados', () => {
    const { steps } = applyPlan([TRES[2], TRES[0], TRES[1]]);
    expect(steps.map((step) => step.version)).toEqual(['0001', '0002', '0003']);
  });

  it('registra cada migración con su huella del contenido del archivo', () => {
    const { steps } = applyPlan(TRES);
    // La huella tiene que ser la misma que usa `db:push`: si difiere, el próximo
    // `db:status` creería que la base quedó editada y volvería a aplicar todo.
    expect(steps[1].record).toContain(
      `'${fingerprint(TRES[1].content)}'`,
    );
    expect(steps[1].record).toBe(
      ledgerInsertSql({
        version: '0002',
        name: 'partners',
        fileName: '0002_partners.sql',
        checksum: fingerprint(TRES[1].content),
      }),
    );
  });

  it('entrega el contenido del archivo tal cual (normalizado a \\n)', () => {
    const withCrlf = file('0004_leads.sql', 'SELECT 1;\r\nSELECT 2;\r\n');
    const { steps } = applyPlan([withCrlf]);
    expect(steps[0].sql).toBe(migrationSql({ version: '0004' }, withCrlf.content));
    expect(steps[0].sql).not.toContain('\r');
  });

  it('no inventa migraciones ni pierde archivos', () => {
    const { steps } = applyPlan(TRES);
    expect(steps.map((step) => step.fileName)).toEqual(TRES.map((f) => f.fileName));
    expect(steps.every((step) => MIGRATION_FILE.test(step.fileName))).toBe(true);
  });

  it('reporta los nombres que no siguen la convención en vez de aplicarlos', () => {
    const { errors, steps } = applyPlan([...TRES, file('migracion-final.sql', 'SELECT 1;\n')]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/migracion-final\.sql/);
    expect(steps).toHaveLength(3);
  });
});

describe('renderApplySql', () => {
  const sql = renderApplySql(TRES, { ref: 'vsqkjimpssdvlvdwrtnh' });

  it('va en una transacción: o entra todo, o no entra nada', () => {
    expect(sql.indexOf('BEGIN;')).toBeGreaterThan(-1);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('CREATE EXTENSION'));
  });

  it('crea el libro antes de la primera migración', () => {
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS public.rix7_migrations')).toBeLessThan(
      sql.indexOf('CREATE EXTENSION'),
    );
  });

  it('respeta el orden de las migraciones', () => {
    const positions = ['0001_extension_postgis', '0002_partners', '0003_properties'].map((name) =>
      sql.indexOf(name),
    );
    expect(positions.every((position) => position > -1)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });

  it('registra cada migración justo después de su contenido', () => {
    // El registro de 0002 tiene que estar después del CREATE TABLE de 0002 y
    // antes del encabezado de 0003: así, si algo falla a mitad, el libro dice la
    // verdad sobre lo que se aplicó.
    const createPartners = sql.indexOf('CREATE TABLE IF NOT EXISTS public.partners');
    const recordPartners = sql.indexOf("VALUES ('0002'");
    const nextMigration = sql.indexOf('-- ── 0003_properties');

    expect(recordPartners).toBeGreaterThan(createPartners);
    expect(recordPartners).toBeLessThan(nextMigration);
  });

  it('marca el proyecto destino y termina leyendo el libro', () => {
    expect(sql).toContain('vsqkjimpssdvlvdwrtnh');
    expect(sql).toContain('SELECT version, name, checksum FROM public.rix7_migrations');
  });

  it('se niega a generar algo con nombres inválidos', () => {
    expect(() => renderApplySql([...TRES, file('otra.sql', 'SELECT 1;\n')])).toThrow(
      /migracion|convención|problemas/i,
    );
  });

  it('se niega a generar un archivo vacío', () => {
    expect(() => renderApplySql([])).toThrow(/No hay migraciones/);
  });

  it('no anuncia proyecto cuando no se le pasa ninguno', () => {
    expect(renderApplySql(TRES)).toContain('dashboard');
  });
});
