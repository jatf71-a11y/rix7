/**
 * @vitest-environment node
 *
 * Tests de integración de `/api/properties` contra una base Supabase REAL.
 *
 * Los tests de `route.test.ts` mockean el RPC: prueban que la ruta aplica las
 * reglas del pipeline compartido sobre las filas que recibe, pero no pueden
 * responder si esas reglas siguen coincidiendo con lo que la base devuelve de
 * verdad —el RPC usa PostGIS, serializa NUMERIC a string y corre SECURITY
 * DEFINER—. Este archivo cierra esa brecha hablando con una base de prueba.
 *
 *   npm run test:integration:supabase
 *
 * Necesita una base de prueba con las migraciones aplicadas y expone tres
 * variables (en el entorno o en `.env.local`):
 *
 *   SUPABASE_TEST_URL           URL del proyecto de prueba
 *   SUPABASE_TEST_ANON_KEY      llave pública (la que usa la ruta)
 *   SUPABASE_TEST_SERVICE_KEY   llave service_role (para sembrar y limpiar)
 *
 * Sirve tanto el stack local (`supabase start`, donde `supabase status` imprime
 * las tres) como un proyecto aparte en la nube. Sin esas variables el archivo
 * se salta entero — no es un fallo: el resto de la suite corre sin base.
 *
 * Dos salvaguardas, aprendidas del incidente del integration «sin Supabase»
 * que escribía en producción:
 *
 * 1. **Anti-producción**: si `SUPABASE_TEST_URL` coincide con el
 *    `NEXT_PUBLIC_SUPABASE_URL` del entorno o de `.env.local`, el beforeAll
 *    aborta antes de tocar nada. El fixture inserta filas y eso, en
 *    producción, es escribir datos de mentira en la base real.
 * 2. **Aislamiento por corredora**: todo el fixture se siembra con
 *    `partner_id = 'itest-rix7'` y TODAS las peticiones llevan `partnerId`,
 *    así el catálogo real que haya en la base de prueba no contamina ni un
 *    contador. El marker también permite limpiar lo que una corrida anterior
 *    haya dejado a medias.
 *
 * Lo único que se mockea es `next/headers`: la ruta llama a `createClient()`,
 * que lee `cookies()`, y esa API de Next solo existe dentro de un request real.
 * El cliente de Supabase, la red, PostgREST y el RPC son los de verdad.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Contexto de cookies vacío: suficiente para que `createServerClient` monte el
// cliente, y sin esto la ruta revienta fuera de un request de Next.
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

import { readEnvContent } from '../../../scripts/check-auth-config.mjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/lib/types/property';

// ═══ Configuración ═══

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function readEnv(key: string): string {
  if (process.env[key]) return process.env[key] as string;
  if (!existsSync(ENV_FILE)) return '';
  const fromFile = readEnvContent(readFileSync(ENV_FILE, 'utf8'));
  return fromFile[key] ?? '';
}

const TEST_URL = readEnv('SUPABASE_TEST_URL');
const ANON_KEY = readEnv('SUPABASE_TEST_ANON_KEY');
const SERVICE_KEY = readEnv('SUPABASE_TEST_SERVICE_KEY');
const isConfigured = Boolean(TEST_URL && ANON_KEY && SERVICE_KEY);

/** Corredora ficticia que marca todo el fixture: aísla y permite limpiar. */
const PARTNER_ID = 'itest-rix7';

const describeIf = isConfigured ? describe : describe.skip;

if (!isConfigured) {
  // Se avisa en la salida para que un «pasó» nunca se lea como «probado».
  console.log(
    '[route.integration] sin SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_KEY: suite saltada.'
  );
}

// ═══ Fixture ═══
// Cinco propiedades que cubren los ejes de los bugs corregidos: dos
// comunas de una región y otra región, ambas operaciones, tipo premium
// (vocabulario de la migración 0013) y precios que solo ordenan bien si se
// comparan como números.

const FIXTURE: Array<Record<string, unknown>> = [
  {
    title: 'ITEST Departamento en Providencia',
    price: 300000000,
    property_type: 'apartment',
    status: 'for_sale',
    bedrooms: 2,
    bathrooms: 2,
    area_sqm: 65,
    address: 'Avenida Providencia 1234',
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    location: 'POINT(-70.6100 -33.4250)',
  },
  {
    title: 'ITEST Arriendo en Providencia',
    price: 500000,
    property_type: 'apartment',
    status: 'for_rent',
    bedrooms: 1,
    bathrooms: 1,
    area_sqm: 40,
    address: 'Manuel Montt 567',
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    location: 'POINT(-70.6050 -33.4300)',
  },
  {
    title: 'ITEST Premium en Vitacura',
    price: 900000000,
    property_type: 'premium',
    status: 'for_sale',
    bedrooms: 4,
    bathrooms: 3,
    area_sqm: 220,
    address: 'Nueva Costanera 3900',
    city: 'Vitacura',
    state: 'Región Metropolitana de Santiago',
    location: 'POINT(-70.5450 -33.4050)',
  },
  {
    title: 'ITEST Casa en Viña del Mar',
    price: 500000000,
    property_type: 'house',
    status: 'for_sale',
    bedrooms: 3,
    bathrooms: 2,
    area_sqm: 150,
    address: 'Av. Argentina 200',
    city: 'Viña del Mar',
    state: 'Valparaíso',
    location: 'POINT(-71.5500 -33.0200)',
  },
  {
    title: 'ITEST Parcela en Zapallar',
    price: 800000,
    property_type: 'parcel',
    status: 'for_rent',
    bedrooms: 0,
    bathrooms: 1,
    area_sqm: 5000,
    address: 'Ruta 5 Km 120',
    city: 'Zapallar',
    state: 'Valparaíso',
    location: 'POINT(-71.4600 -32.5500)',
  },
].map((row) => ({ ...row, partner_id: PARTNER_ID }));

// ═══ Cliente y utilidades ═══

let admin: SupabaseClient;
let route: typeof import('./route');

/** Limpia lo que una corrida anterior (o esta) pueda haber dejado. */
async function cleanFixture() {
  await admin.from('properties').delete().eq('partner_id', PARTNER_ID);
  await admin.from('partners').delete().eq('id', PARTNER_ID);
}

/** Petición a la ruta, siempre acotada a la corredora del fixture. */
async function get(query: string) {
  const res = await route.GET(
    new Request(`http://localhost/api/properties?partnerId=${PARTNER_ID}&${query}`) as never
  );
  return res.json();
}

describeIf('GET /api/properties · integración con base Supabase real', () => {
  beforeAll(async () => {
    // Anti-producción: el fixture escribe, y en producción eso no es un test.
    const productionUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL');
    if (productionUrl && TEST_URL === productionUrl) {
      throw new Error(
        'SUPABASE_TEST_URL apunta a la base de producción. Este test siembra y borra filas: usá una base de prueba.'
      );
    }

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TEST_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_KEY);

    admin = createClient(TEST_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await cleanFixture();

    const { error: partnerError } = await admin
      .from('partners')
      .insert({ id: PARTNER_ID, slug: PARTNER_ID, name: 'Corredora de pruebas (ITEST)' });
    if (partnerError) {
      throw new Error(
        `no se pudo sembrar la corredora del fixture: ${partnerError.message}. ` +
          '¿La base de prueba tiene las migraciones aplicadas? (npm run db:push -- --ref <ref-de-prueba>)'
      );
    }

    const { error: rowsError } = await admin.from('properties').insert(FIXTURE);
    if (rowsError) {
      throw new Error(`no se pudieron sembrar las propiedades del fixture: ${rowsError.message}`);
    }

    route = await import('./route');
  }, 30000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (admin) await cleanFixture();
  }, 30000);

  it('responde desde Supabase y no desde el catálogo del build', async () => {
    const body = await get('operation=all&propertyType=all&page=1&limit=50');

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(FIXTURE.length);
    // Sin el partnerId la base real (con sus propias filas) contaminaría los
    // contadores: el aislamiento es parte del contrato del test.
    expect(
      body.data.every((p: Property) => p.partner_id === PARTNER_ID)
    ).toBe(true);
  });

  it('filtra por comuna con el mismo criterio que la UI', async () => {
    const body = await get('operation=all&propertyType=all&commune=providencia&page=1&limit=50');

    expect(body.total).toBe(2);
    expect(body.data.every((p: Property) => p.city === 'Providencia')).toBe(true);
  });

  it('filtra por región', async () => {
    const body = await get(
      'operation=all&propertyType=all&region=valpara%C3%ADso&page=1&limit=50'
    );

    expect(body.total).toBe(2);
    expect(body.data.every((p: Property) => p.state === 'Valparaíso')).toBe(true);
  });

  it('la operación no activa muestra su stock real, no 0', async () => {
    const body = await get('operation=for_sale&propertyType=all&page=1&limit=50');

    expect(body.total).toBe(3);
    expect(body.operationCounts).toEqual({ for_sale: 3, for_rent: 2 });
  });

  it('premium filtra las propiedades premium de la base', async () => {
    // Con la migración 0013 la base ya escribe el vocabulario de la UI; si
    // algún día volviera a aparecer vip, este test se enciende en rojo.
    const body = await get('operation=all&propertyType=premium&page=1&limit=50');

    expect(body.total).toBe(1);
    expect(body.data[0].property_type).toBe('premium');
    expect(body.data[0].city).toBe('Vitacura');
  });

  it('los contadores de comuna no colapsan al elegir una comuna', async () => {
    const body = await get('operation=all&propertyType=all&commune=providencia&page=1&limit=50');

    expect(body.total).toBe(2);
    expect(body.communeCounts['Providencia']).toBe(2);
    expect(body.communeCounts['Vitacura']).toBe(1);
    expect(body.communeCounts['Viña del Mar']).toBe(1);
    expect(body.communeCounts['Zapallar']).toBe(1);
  });

  it('un rango de precios compara números, no strings', async () => {
    // PostgREST serializa NUMERIC como string; con orden lexicográfico
    // "800000" > "900000000" y el filtro devolvería lo barato en vez de lo caro.
    const body = await get('operation=all&propertyType=all&minPrice=800000000&page=1&limit=50');

    expect(body.total).toBe(1);
    expect(body.data[0].title).toBe('ITEST Premium en Vitacura');
  });

  it('dormitorios con valor exacto, no como mínimo', async () => {
    const body = await get('operation=all&propertyType=all&minBedrooms=2&page=1&limit=50');

    // El RPC filtraría con >= (2, 3 y 4 dormitorios); la regla del negocio es
    // exacta salvo para 5+.
    expect(body.total).toBe(1);
    expect(body.data[0].bedrooms).toBe(2);
  });

  it('una comuna sin stock devuelve 0 sin caer al catálogo demo', async () => {
    const body = await get('operation=all&propertyType=all&commune=calama&page=1&limit=50');

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
    expect(body.totalCatalog).toBeUndefined();
  });
});
