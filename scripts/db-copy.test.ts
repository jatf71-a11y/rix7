/**
 * Tests de la copia del catálogo entre proyectos.
 *
 * Lo que no puede fallar en silencio: que el SQL generado respete el orden
 * (partners antes de properties, por la clave foránea), que los tipos se
 * traduzcan sin inventar nada —sobre todo la columna geográfica, que si se
 * copia como texto deja la propiedad sin ubicación— y que el borrado solo
 * ocurra con `--replace`.
 */
import { describe, expect, it } from 'vitest';

import {
  copySql,
  fetchRows,
  foreignStorageUrls,
  insertSql,
  normalizeRows,
  projectRefFromUrl,
  readCatalog,
  readEnvFile,
  resolveTables,
  sqlLiteral,
  TABLES,
} from './db-copy.mjs';

/** Respuesta de fetch falsa, con la forma que usan los tests. */
const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('sqlLiteral', () => {
  it('traduce los tipos simples', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(undefined)).toBe('NULL');
    expect(sqlLiteral(true)).toBe('TRUE');
    expect(sqlLiteral(false)).toBe('FALSE');
    expect(sqlLiteral(1234.5)).toBe('1234.5');
    expect(sqlLiteral('Vitacura')).toBe("'Vitacura'");
    expect(sqlLiteral('O"Higgins')).toBe("'O\"Higgins'");
  });

  it('escapa comillas simples en vez de romper el SQL', () => {
    expect(sqlLiteral("Depto d'Azur")).toBe("'Depto d''Azur'");
  });

  it('convierte arreglos a TEXT[]', () => {
    expect(sqlLiteral(['a', 'b'])).toBe("ARRAY['a', 'b']::text[]");
    expect(sqlLiteral([])).toBe("'{}'::text[]");
  });

  it('reconstruye la ubicación desde EWKB y desde GeoJSON', () => {
    // EWKB real de PostgREST (SRID 4326 incluido).
    const ewkb = '0101000020E610000083C0CAA145A651C06DE7FBA9F1B240C0';
    expect(sqlLiteral(ewkb, 'location')).toBe(`ST_GeogFromWKB(decode('${ewkb}', 'hex'))`);
    expect(sqlLiteral({ type: 'Point', coordinates: [-70.6, -33.4] }, 'location')).toBe(
      'ST_SetSRID(ST_MakePoint(-70.6, -33.4), 4326)::geography',
    );
  });

  it('se niega a inventar lo que no entiende', () => {
    expect(() => sqlLiteral({ a: 1 })).toThrow(/valor compuesto/);
    expect(() => sqlLiteral('no-es-hex', 'location')).toThrow(/location/);
    expect(() => sqlLiteral(['a', null])).toThrow(/arreglo con nulos/);
  });
});

describe('insertSql', () => {
  it('arma un INSERT con todas las filas y sin duplicar ids', () => {
    const sql = insertSql({
      table: 'partners',
      rows: [
        { id: 'catedral', name: 'Catedral Propiedades' },
        { id: 'cbre', name: 'CBRE Chile' },
      ],
    });

    expect(sql).toContain('INSERT INTO public.partners ("id", "name")');
    expect(sql).toContain("('catedral', 'Catedral Propiedades')");
    expect(sql).toContain("('cbre', 'CBRE Chile')");
    expect(sql.endsWith('ON CONFLICT ("id") DO NOTHING;')).toBe(true);
  });

  it('devuelve vacío si no hay filas', () => {
    expect(insertSql({ table: 'properties', rows: [] })).toBe('');
  });
});

describe('copySql', () => {
  const data = {
    partners: [{ id: 'catedral' }],
    properties: [{ id: 'p1', title: 'Casa' }],
  };

  it('inserta partners antes que properties', () => {
    const sql = copySql({ data });
    expect(sql.indexOf('public.partners')).toBeLessThan(sql.indexOf('public.properties'));
  });

  it('no borra nada salvo que se pida', () => {
    expect(copySql({ data })).not.toContain('DELETE');
    const withReplace = copySql({ data, replace: true });
    expect(withReplace).toContain('DELETE FROM public.partners;');
    expect(withReplace).toContain('DELETE FROM public.properties;');
    // El borrado va antes de las inserciones y en orden inverso a ellas: si no,
    // borrar `partners` con `properties` apuntándole rompe la clave foránea.
    expect(withReplace.indexOf('DELETE FROM public.properties')).toBeLessThan(
      withReplace.indexOf('DELETE FROM public.partners'),
    );
    expect(withReplace.indexOf('DELETE FROM public.partners')).toBeLessThan(withReplace.indexOf('INSERT'));
  });
});

describe('fetchRows', () => {
  it('pagina hasta que una página llega incompleta', async () => {
    const pages = [
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'c' }],
    ];
    let call = 0;
    const fetchImpl = async () => jsonResponse(pages[call++]);

    const rows = await fetchRows({
      url: 'https://ejemplo.supabase.co',
      key: 'k',
      table: 'properties',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pageSize: 2,
    });

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(call).toBe(2);
  });

  it('falla con el motivo del servidor en vez de devolver una lista vacía', async () => {
    const fetchImpl = async () =>
      jsonResponse({ message: 'relation does not exist' }, 404) as unknown as Response;

    await expect(
      fetchRows({
        url: 'https://ejemplo.supabase.co',
        key: 'k',
        table: 'properties',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404.*relation does not exist/);
  });
});

describe('readCatalog', () => {
  it('lee exactamente las tablas declaradas', async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string) => {
      seen.push(String(input).replace(/^.*\/rest\/v1\//, '').split('?')[0]);
      return jsonResponse([]) as unknown as Response;
    };

    const data = await readCatalog({
      url: 'https://ejemplo.supabase.co',
      key: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(seen).toEqual(TABLES.map((t) => t.name));
    expect(Object.keys(data)).toEqual(TABLES.map((t) => t.name));
  });

  it('lee las tablas opcionales que se le piden', async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string) => {
      seen.push(String(input).replace(/^.*\/rest\/v1\//, '').split('?')[0]);
      return jsonResponse([]) as unknown as Response;
    };

    const { tables } = resolveTables('leads') as { tables: { name: string; pk: string[] }[] };
    await readCatalog({
      url: 'https://ejemplo.supabase.co',
      key: 'k',
      tables,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(seen).toEqual(['partners', 'properties', 'leads']);
  });
});

describe('helpers', () => {
  it('deduce el ref del proyecto desde la URL', () => {
    expect(projectRefFromUrl('https://vsqkjimpssdvlvdwrtnh.supabase.co')).toBe('vsqkjimpssdvlvdwrtnh');
    expect(projectRefFromUrl('https://ejemplo.com')).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });

  it('lee un .env con comentarios y comillas', () => {
    const env = readEnvFile(['# comentario', 'A=1', 'B="dos"', "C='tres'", ''].join('\n'));
    expect(env).toEqual({ A: '1', B: 'dos', C: 'tres' });
  });
});

describe('normalizeRows', () => {
  it('traduce el vocabulario viejo y lo cuenta', () => {
    const { rows, notes } = normalizeRows({
      table: 'properties',
      rows: [{ id: 'p1', property_type: 'vip' }, { id: 'p2', property_type: 'apartment' }],
    });

    expect(rows.map((row) => row.property_type)).toEqual(['premium', 'apartment']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/1 fila · property_type: vip → premium/);
  });

  it('omite user_id, que cuelga de auth.users, y lo informa solo si venía con valor', () => {
    const withUser = normalizeRows({
      table: 'properties',
      rows: [{ id: 'p1', user_id: 'b1f0-uuid' }, { id: 'p2', user_id: null }],
    });

    expect(withUser.rows.every((row) => !('user_id' in row))).toBe(true);
    // Solo una fila tenía cuenta: la otra no aporta nada al informe.
    expect(withUser.notes).toHaveLength(1);
    expect(withUser.notes[0]).toMatch(/1 fila · user_id/);
  });

  it('respeta --keep-user-id cuando el destino ya tiene esas cuentas', () => {
    const { rows, notes } = normalizeRows({
      table: 'properties',
      rows: [{ id: 'p1', user_id: 'b1f0-uuid' }],
      keepUserId: true,
    });

    expect(rows[0].user_id).toBe('b1f0-uuid');
    expect(notes).toEqual([]);
  });

  it('no toca tablas sin traducciones', () => {
    const { rows, notes } = normalizeRows({ table: 'partners', rows: [{ id: 'catedral' }] });
    expect(rows).toEqual([{ id: 'catedral' }]);
    expect(notes).toEqual([]);
  });
});

describe('resolveTables', () => {
  it('por defecto copia el catálogo, en orden de claves foráneas', () => {
    const { tables } = resolveTables(null) as { tables: { name: string }[] };
    expect(tables.map((table) => table.name)).toEqual(TABLES.map((table) => table.name));
  });

  it('suma tablas opcionales detrás del catálogo, sin desordenarlo', () => {
    const { tables } = resolveTables('signups,leads') as { tables: { name: string; pk: string[] }[] };
    expect(tables.map((table) => table.name)).toEqual(['partners', 'properties', 'leads', 'signups']);
  });

  it('explica por qué no copia lo que cuelga de auth.users', () => {
    const result = resolveTables('favorites') as { error: string };
    expect(result.error).toMatch(/favorites/);
    expect(result.error).toMatch(/auth\.users/);
  });

  it('rechaza tablas que no conoce, listando las que sí', () => {
    const result = resolveTables('inventada') as { error: string };
    expect(result.error).toMatch(/no conozco esa tabla/);
    expect(result.error).toMatch(/properties/);
  });
});

describe('insertSql con clave compuesta', () => {
  it('usa la clave que se le pasa, no siempre «id»', () => {
    const sql = insertSql({
      table: 'share_views',
      rows: [{ property_id: 'p1', day: '2026-10-14', count: 3 }],
      pk: ['property_id', 'day'],
    });
    expect(sql).toContain('ON CONFLICT ("property_id", "day") DO NOTHING;');
  });
});

describe('foreignStorageUrls', () => {
  const data = {
    properties: [
      {
        id: 'p1',
        images: [
          'https://wcx.supabase.co/storage/v1/object/public/properties-media/a.jpg',
          'https://images.unsplash.com/photo-1',
        ],
      },
      { id: 'p2', images: ['https://wcx.supabase.co/storage/v1/object/public/properties-media/a.jpg'] },
    ],
  };

  it('encuentra las imágenes que viven en el storage del origen, con su cuenta', () => {
    const found = foreignStorageUrls(data, 'https://wcx.supabase.co/');
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
    expect(found[0].url).toMatch(/properties-media\/a\.jpg$/);
  });

  it('no inventa nada cuando las imágenes son de terceros', () => {
    expect(foreignStorageUrls(data, 'https://otro.supabase.co')).toEqual([]);
    expect(foreignStorageUrls(data, '')).toEqual([]);
  });
});
