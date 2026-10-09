/**
 * @vitest-environment node
 *
 * Tests de `/api/properties` con la fuente Supabase simulada.
 *
 * Es la fuente real del portal (producción responde `source: 'supabase'`), y
 * era la rama con menos cobertura y más defectos: ignoraba región y comuna
 * (el selector de ubicación movía el mapa pero no filtraba nada), contaba la
 * operación no activa como 0 ("Arrendar 0" con 2 arriendos reales), perdía
 * el tipo `vip` de la base fuera de los chips de la UI, y cualquier filtro
 * sin resultados caía al catálogo demo con 4.186 propiedades inventadas.
 *
 * Los tests fijan el contrato que la UI asume: mismas reglas que el catálogo
 * del build, contadores honestos y respuesta vacía sin caer al demo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc }),
}));

/** Fila con la forma que devuelve el RPC (NUMERIC como string, tipos de la base). */
function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    title: 'Propiedad',
    description: '',
    price: '500000000',
    property_type: 'apartment',
    status: 'for_sale',
    bedrooms: 2,
    bathrooms: '2',
    area_sqm: '80',
    parking_spots: 1,
    year_built: 2024,
    address: 'Calle Falsa 123',
    city: 'Providencia',
    state: 'Región Metropolitana de Santiago',
    zip_code: '',
    images: [],
    features: [],
    lat: '-33.42',
    lng: '-70.61',
    agent_name: '',
    agent_email: '',
    agent_phone: '',
    agent_avatar: '',
    partner_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Catálogo simulado con los mismos patrones que la base real: tipos vip,
// varias regiones y ambas operaciones.
const CATALOG = [
  row({ id: 'rm-vip-1', property_type: 'vip', city: 'Vitacura', price: '890000000' }),
  row({ id: 'rm-apt-1', city: 'Las Condes', price: '650000000' }),
  row({ id: 'rm-house-1', property_type: 'house', city: 'Lo Barnechea', price: '1200000000' }),
  row({ id: 'rm-parcel-1', property_type: 'parcel', city: 'Colina', price: '185000000' }),
  row({ id: 'rm-apt-2', city: 'Providencia', status: 'for_rent', price: '650000' }),
  row({ id: 'v-apt-1', city: 'Viña del Mar', state: 'Valparaíso', price: '420000000' }),
  row({ id: 'v-vip-1', property_type: 'vip', city: 'Zapallar', state: 'Valparaíso', price: '980000000' }),
  row({ id: 'v-parcel-1', property_type: 'parcel', city: 'Olmué', state: 'Valparaíso', price: '210000000' }),
  row({ id: 'c-apt-1', city: 'La Serena', state: 'Coquimbo', price: '300000000' }),
  row({ id: 'ar-vip-1', property_type: 'vip', city: 'Pucón', state: 'La Araucanía', price: '750000000' }),
  row({ id: 'l-parcel-1', property_type: 'parcel', city: 'Puerto Varas', state: 'Los Lagos', price: '250000000' }),
  row({ id: 'a-apt-1', city: 'Antofagasta', state: 'Antofagasta', status: 'for_rent', price: '450000' }),
];

let route: typeof import('./route');

const get = (query: string) =>
  route.GET(new Request(`http://localhost/api/properties?${query}`) as never);

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  rpc.mockReset();
  rpc.mockResolvedValue({ data: CATALOG.map((r) => ({ ...r })), error: null });
  route = await import('./route');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/properties · rama Supabase', () => {
  it('filtra por comuna y no devuelve propiedades de otras ciudades', async () => {
    const res = await get('operation=all&propertyType=all&commune=providencia');
    const body = await res.json();

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(1);
    expect(body.data.map((p: { city: string }) => p.city)).toEqual(['Providencia']);
  });

  it('filtra por región', async () => {
    const res = await get('operation=all&propertyType=all&region=valparaíso');
    const body = await res.json();

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(3);
    expect(body.data.every((p: { state: string }) => p.state === 'Valparaíso')).toBe(true);
  });

  it('una comuna sin stock devuelve 0 y no cae al catálogo demo', async () => {
    const res = await get('operation=all&propertyType=all&commune=calama');
    const body = await res.json();

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
    // Antes caía al catálogo del build y devolvía miles de propiedades
    // inventadas de otras ciudades.
    expect(body.totalCatalog).toBeUndefined();
  });

  it('un rango de precios sin resultados tampoco cae al catálogo demo', async () => {
    const res = await get('operation=all&propertyType=all&maxPrice=100000');
    const body = await res.json();

    expect(body.source).toBe('supabase');
    expect(body.total).toBe(0);
  });

  it('cuenta la operación no activa con su stock real (no 0)', async () => {
    const res = await get('operation=for_sale&propertyType=all');
    const body = await res.json();

    // 10 en venta, 2 en arriendo: el chip "Arrendar" debe mostrar 2 aunque
    // la operación activa sea "Comprar". Antes mostraba 0 porque se contaba
    // sobre el set ya filtrado por operación.
    expect(body.operationCounts).toEqual({ for_sale: 10, for_rent: 2 });
    expect(body.total).toBe(10);
  });

  it('los contadores de operación respetan la ubicación seleccionada', async () => {
    const res = await get('operation=for_sale&propertyType=all&region=valparaíso');
    const body = await res.json();

    expect(body.operationCounts).toEqual({ for_sale: 3, for_rent: 0 });
  });

  it('traduce el tipo vip de la base al chip Premium de la UI', async () => {
    const res = await get('operation=all&propertyType=premium');
    const body = await res.json();

    // La base guarda "vip"; la UI filtra por "premium". Antes el filtro no
    // matcheaba nada y la respuesta caía al catálogo demo.
    expect(body.source).toBe('supabase');
    expect(body.total).toBe(3);
    expect(body.data.every((p: { property_type: string }) => p.property_type === 'premium')).toBe(true);
  });

  it('los contadores de categoría no pierden el tipo vip', async () => {
    const res = await get('operation=all&propertyType=all');
    const body = await res.json();

    expect(body.categoryCounts.premium).toBe(3);
    expect(body.categoryCounts.vip).toBeUndefined();
    expect(body.categoryCounts.all).toBe(12);
  });

  it('aplica dormitorios con valor exacto y no como mínimo', async () => {
    rpc.mockResolvedValue({
      data: [
        row({ id: 'b2', bedrooms: 2 }),
        row({ id: 'b3', bedrooms: 3 }),
        row({ id: 'b4', bedrooms: 4 }),
      ],
      error: null,
    });

    const res = await get('operation=all&propertyType=all&minBedrooms=2');
    const body = await res.json();

    // El RPC filtraría con >= (2, 3 y 4); la regla del negocio es valor
    // exacto salvo para 5+.
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe('b2');
  });

  it('aplica baños, que el RPC no conoce', async () => {
    rpc.mockResolvedValue({
      data: [row({ id: 'b1', bathrooms: '1' }), row({ id: 'b2', bathrooms: '3' })],
      error: null,
    });

    const res = await get('operation=all&propertyType=all&minBathrooms=3');
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe('b2');
  });

  it('devuelve el conteo por comuna sin el filtro de ubicación, para el dropdown', async () => {
    const res = await get('operation=for_sale&propertyType=all&commune=las+condes');
    const body = await res.json();

    // El usuario ve 1 resultado, pero el dropdown debe seguir mostrando el
    // stock real de las demás comunas: antes se contaba sobre el set ya
    // filtrado y todas quedaban en 0.
    expect(body.total).toBe(1);
    expect(body.communeCounts['Las Condes']).toBe(1);
    expect(body.communeCounts['Vitacura']).toBe(1);
    expect(body.communeCounts['Viña del Mar']).toBe(1);
    // Comunas sin stock en la operación activa no llevan clave (la UI
    // consulta con > 0): ausente equivale a 0.
    expect(body.communeCounts['Providencia'] ?? 0).toBe(0); // es for_rent
    expect(body.communeCounts['Antofagasta'] ?? 0).toBe(0); // también for_rent
  });

  it('normaliza los precios NUMERIC para que el rango compara números', async () => {
    const res = await get('operation=all&propertyType=all&minPrice=800000000');
    const body = await res.json();

    // Con price como string, "420000000" > "800000000" en orden lexicográfico
    // y el filtro devolvería lo barato en vez de lo caro.
    expect(body.total).toBe(3);
    expect(body.data.every((p: { price: number }) => p.price >= 800000000)).toBe(true);
  });

  it('si Supabase responde con error, cae al catálogo del build', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await get('operation=all&propertyType=all');
    const body = await res.json();

    expect(body.source).toBe('national_catalog');
    expect(body.totalCatalog).toBeGreaterThan(0);
  });

  it('si la base está vacía (0 filas), cae al catálogo del build', async () => {
    // Un portal sin propiedades es peor que uno con el catálogo del build.
    // La distinción clave: 0 filas SIN filtros = base vacía; 0 resultados CON
    // filtros sobre una base poblada = respuesta vacía honesta.
    rpc.mockResolvedValue({ data: [], error: null });

    const res = await get('operation=all&propertyType=all');
    const body = await res.json();

    expect(body.source).toBe('national_catalog');
    expect(body.totalCatalog).toBeGreaterThan(0);
  });
});
