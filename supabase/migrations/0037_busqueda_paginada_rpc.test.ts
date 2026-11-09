/**
 * @vitest-environment node
 *
 * La migración 0037 es plpgsql puro: filtra, cuenta por categoría/operación/
 * comuna y pagina dentro de la base. Esta máquina no puede correr Docker ni
 * Supabase local (virtualización deshabilitada en el firmware), así que este
 * test ejecuta el SQL de la migración en un Postgres embebido (PGlite) sobre
 * una `get_properties_filtered` simulada.
 *
 * Qué valida: el contrato del RPC —contadores, paginación, orden, filtros y
 * normalización de texto—. Qué no valida: PostgREST, la ruta HTTP ni las
 * políticas de la base; eso sigue siendo `route.integration.test.ts` contra
 * Supabase.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '0037_busqueda_paginada_rpc.sql'),
  'utf8'
);

const PARTNER_ID = 'itest-rix7';

/**
 * Mismas filas que el fixture de la suite de integración, con `created_at`
 * distintos: el RPC ordena por fecha y cinco filas insertadas a la vez
 * compartirían timestamp, lo que haría indeterminado el reparto entre páginas.
 */
const ROWS = [
  {
    id: 'apt-sale',
    title: 'ITEST Departamento en Providencia',
    price: 300000000,
    property_type: 'apartment',
    status: 'for_sale',
    bedrooms: 2,
    bathrooms: 2,
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    address: 'Avenida Providencia 1234',
    year_built: 2020,
    created_at: '2026-01-05T12:00:00Z',
  },
  {
    id: 'apt-rent',
    title: 'ITEST Arriendo en Providencia',
    price: 500000,
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 1,
    bathrooms: 1,
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    address: 'Manuel Montt 567',
    year_built: 2020,
    created_at: '2026-01-04T12:00:00Z',
  },
  {
    id: 'premium',
    title: 'ITEST Premium en Vitacura',
    price: 900000000,
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 4,
    bathrooms: 3,
    city: 'Vitacura',
    state: 'Región Metropolitana de Santiago',
    address: 'Nueva Costanera 3900',
    year_built: 2020,
    created_at: '2026-01-03T12:00:00Z',
  },
  {
    id: 'house',
    title: 'ITEST Casa en Viña del Mar',
    price: 500000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 3,
    bathrooms: 2,
    city: 'Viña del Mar',
    state: 'Valparaíso',
    address: 'Av. Argentina 200',
    year_built: 2020,
    created_at: '2026-01-02T12:00:00Z',
  },
  {
    id: 'parcel',
    title: 'ITEST Parcela en Zapallar',
    price: 800000,
    property_type: 'parcel',
    status: 'for_rent',
    bedrooms: 0,
    bathrooms: 1,
    city: 'Zapallar',
    state: 'Valparaíso',
    address: 'Ruta 5 Km 120',
    year_built: 2020,
    created_at: '2026-01-01T12:00:00Z',
  },
].map((row) => ({ ...row, partner_id: PARTNER_ID }));

interface CatalogPage {
  data: Array<Record<string, unknown>>;
  total: number;
  catalog_size: number;
  category_counts: Record<string, number>;
  operation_counts: { for_sale: number; for_rent: number };
  commune_counts: Record<string, number>;
}

type SearchParams = Record<string, string | number | null>;

const DEFAULT_PARAMS: SearchParams = {
  p_operation: 'all',
  p_property_type: 'all',
  p_search: '',
  p_region: '',
  p_commune: '',
  p_min_price: null,
  p_max_price: null,
  p_min_bedrooms: null,
  p_min_bathrooms: null,
  p_min_privates: null,
  p_new_property_type: null,
  p_partner_id: PARTNER_ID,
  p_page: 1,
  p_limit: 50,
};

let db: PGlite;

/** Llama al RPC con los defaults de la ruta y devuelve el JSON de la página. */
async function search(overrides: SearchParams = {}): Promise<CatalogPage> {
  const params = { ...DEFAULT_PARAMS, ...overrides };
  const keys = Object.keys(params);
  const named = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
  const result = await db.query<{ page: CatalogPage }>(
    `SELECT public.search_properties_catalog(${named}) AS page`,
    keys.map((key) => params[key])
  );
  return result.rows[0].page;
}

beforeAll(async () => {
  db = new PGlite();

  // El RPC real lee del RPC geoespacial de Supabase; acá alcanza con una
  // función que devuelva las filas del fixture con las columnas que 0037 usa.
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;

    CREATE TABLE public.properties (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      price NUMERIC NOT NULL,
      property_type TEXT NOT NULL,
      status TEXT NOT NULL,
      bedrooms INTEGER NOT NULL,
      bathrooms NUMERIC NOT NULL,
      city TEXT,
      state TEXT,
      address TEXT,
      year_built INTEGER,
      partner_id TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE OR REPLACE FUNCTION public.get_properties_filtered(
      min_lng DOUBLE PRECISION,
      min_lat DOUBLE PRECISION,
      max_lng DOUBLE PRECISION,
      max_lat DOUBLE PRECISION
    )
    RETURNS TABLE (
      id TEXT,
      title TEXT,
      price NUMERIC,
      property_type TEXT,
      status TEXT,
      bedrooms INTEGER,
      bathrooms NUMERIC,
      city TEXT,
      state TEXT,
      address TEXT,
      year_built INTEGER,
      partner_id TEXT,
      created_at TIMESTAMPTZ
    )
    LANGUAGE sql
    STABLE
    AS $$
      SELECT p.id, p.title, p.price, p.property_type, p.status, p.bedrooms,
             p.bathrooms, p.city, p.state, p.address, p.year_built,
             p.partner_id, p.created_at
      FROM public.properties p
    $$;
  `);

  for (const row of ROWS) {
    await db.query(
      `INSERT INTO public.properties
         (id, title, price, property_type, status, bedrooms, bathrooms,
          city, state, address, year_built, partner_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.id,
        row.title,
        row.price,
        row.property_type,
        row.status,
        row.bedrooms,
        row.bathrooms,
        row.city,
        row.state,
        row.address,
        row.year_built,
        row.partner_id,
        row.created_at,
      ]
    );
  }

  // La migración tal como se versiona: si el archivo cambia, este test cambia.
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db?.close();
});

describe('search_properties_catalog (migración 0037) · Postgres embebido', () => {
  it('cuenta el catálogo, las categorías, las operaciones y las comunas', async () => {
    const page = await search();

    expect(page.catalog_size).toBe(ROWS.length);
    expect(page.total).toBe(ROWS.length);
    expect(page.category_counts).toMatchObject({
      all: 5,
      apartment: 2,
      house: 1,
      premium: 1,
      parcel: 1,
      office: 0,
      land: 0,
      parking: 0,
      local: 0,
      warehouse: 0,
    });
    expect(page.operation_counts).toEqual({ for_sale: 3, for_rent: 2 });
    expect(page.commune_counts).toMatchObject({
      Providencia: 2,
      Vitacura: 1,
      'Viña del Mar': 1,
      Zapallar: 1,
    });
  });

  it('pagina de a dos sin duplicados y en orden de publicación', async () => {
    const pages: string[][] = [];
    for (const number of [1, 2, 3]) {
      const page = await search({ p_page: number, p_limit: 2 });
      expect(page.total).toBe(5);
      expect(page.data).toHaveLength(number === 3 ? 1 : 2);
      pages.push(page.data.map((row) => row.id as string));
    }

    expect(pages).toEqual([['apt-sale', 'apt-rent'], ['premium', 'house'], ['parcel']]);
    expect(new Set(pages.flat()).size).toBe(ROWS.length);
  });

  it('una página fuera de rango devuelve vacío sin mover el total', async () => {
    const page = await search({ p_page: 99, p_limit: 2 });

    expect(page.total).toBe(5);
    expect(page.catalog_size).toBe(5);
    expect(page.data).toEqual([]);
  });

  it('pagina con el filtro de comuna y mantiene el stock de las demás comunas', async () => {
    const first = await search({ p_commune: 'providencia', p_page: 1, p_limit: 1 });
    const second = await search({ p_commune: 'providencia', p_page: 2, p_limit: 1 });

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.data[0].city).toBe('Providencia');
    expect(second.data[0].city).toBe('Providencia');
    expect(first.data[0].id).not.toBe(second.data[0].id);
    // El dropdown de comuna se cuenta sin la ubicación elegida.
    expect(first.commune_counts).toMatchObject({ Providencia: 2, Vitacura: 1, Zapallar: 1 });
  });

  it('los contadores de categoría respetan la operación activa', async () => {
    const page = await search({ p_operation: 'for_rent' });

    expect(page.total).toBe(2);
    expect(page.category_counts).toMatchObject({
      all: 2,
      apartment: 1,
      parcel: 1,
      house: 0,
      premium: 0,
    });
    expect(page.operation_counts).toEqual({ for_sale: 3, for_rent: 2 });
  });

  it('busca sin tildes ni mayúsculas', async () => {
    const page = await search({ p_search: 'VINA' });

    expect(page.total).toBe(1);
    expect(page.data[0].city).toBe('Viña del Mar');
  });
});
