/**
 * @vitest-environment node
 *
 * Tests del store de publicaciones del socio: en desarrollo el CRUD vive en
 * memoria (y no se pide de verdad), y con proyecto configurado cada operación
 * va acotada por `partner_id` — el filtro que, junto a la RLS de la migración
 * 0014, hace que un socio jamás vea ni toque publicaciones ajenas.
 *
 * El cliente de Supabase se reemplaza por uno falso encadenable, y el estado
 * en memoria del módulo se limpia con `vi.resetModules()` + import dinámico
 * (mismo patrón que `partners-store.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeError {
  message: string;
  code?: string;
}

const { sb } = vi.hoisted(() => {
  const state: {
    rows: Record<string, unknown>[];
    error: FakeError | null;
    ops: string[];
    lastInsert: Record<string, unknown> | null;
    lastPatch: Record<string, unknown> | null;
  } = { rows: [], error: null, ops: [], lastInsert: null, lastPatch: null };

  function builder() {
    const result = (): { data: unknown; error: FakeError | null } =>
      state.error
        ? { data: null, error: state.error }
        : { data: state.rows, error: null };

    const one = (): { data: unknown; error: FakeError | null } =>
      state.error
        ? { data: null, error: state.error }
        : { data: state.rows[0] ?? null, error: null };

    const b: Record<string, unknown> = {};
    b.select = (columns?: string) => {
      state.ops.push(`select:${columns ?? '*'}`);
      return b;
    };
    b.insert = (row: Record<string, unknown>) => {
      state.ops.push('insert');
      state.lastInsert = row;
      return b;
    };
    b.update = (patch: Record<string, unknown>) => {
      state.ops.push('update');
      state.lastPatch = patch;
      return b;
    };
    b.delete = () => {
      state.ops.push('delete');
      return b;
    };
    b.eq = (column: string, value: unknown) => {
      state.ops.push(`eq:${column}=${String(value)}`);
      return b;
    };
    b.order = () => b;
    b.limit = () => Promise.resolve(result());
    b.single = () => Promise.resolve(one());
    b.maybeSingle = () => Promise.resolve(one());
    b.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return b;
  }

  return {
    sb: {
      state,
      client: {
        from: (table: string) => {
          state.ops.push(`from:${table}`);
          return builder();
        },
      },
      reset(rows: Record<string, unknown>[] = [], error: FakeError | null = null) {
        state.rows = rows;
        state.error = error;
        state.ops = [];
        state.lastInsert = null;
        state.lastPatch = null;
      },
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: () => sb.client,
  createClient: () => sb.client,
}));

const CONFIGURED_URL = 'https://proyecto-real.supabase.co';

/** Deja el entorno como "proyecto Supabase real" (url + anon key). */
function configureSupabase(): void {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', CONFIGURED_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
}

const INPUT = {
  title: 'Departamento en Providencia',
  description: 'Calle tranquila, cerca del metro.',
  price: 85_000_000,
  property_type: 'apartment' as const,
  status: 'for_sale' as const,
  bedrooms: 2,
  bathrooms: 2,
  area_sqm: 68,
  parking_spots: 1,
  year_built: 2019,
  address: 'Av. Providencia 1234',
  city: 'Providencia',
  state: 'Región Metropolitana',
  zip_code: undefined,
  images: ['https://images.unsplash.com/photo-1'],
  features: ['Balcón'],
  lat: -33.42,
  lng: -70.61,
  agent_name: 'Camila',
  agent_email: 'camila@rix7.cl',
  agent_phone: '+56 9 1234 5678',
};

let store: typeof import('./propertiesStore');

beforeEach(async () => {
  vi.resetModules();
  sb.reset();
  // Sin Supabase: arranca en modo desarrollo (memoria).
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  store = await import('./propertiesStore');
  // El respaldo vive en globalThis (sobrevive a recompilaciones en dev), así
  // que `resetModules` ya no lo limpia: lo vacía el propio módulo.
  store.resetDevPublications();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('modo desarrollo (sin Supabase)', () => {
  it('crea, lista y marca la escritura como no persistente', async () => {
    const created = await store.createPublication(
      { ...INPUT, rol: '15234-67' },
      { partnerId: 'catedral', userId: null }
    );

    expect(created.ok).toBe(true);
    expect(created.persisted).toBe(false);
    expect(created.property?.partner_id).toBe('catedral');
    expect(created.property?.rol).toBe('15234-67');
    expect(created.property?.id).toBeTruthy();

    const list = await store.listPartnerPublications('catedral');
    expect(list.source).toBe('dev');
    expect(list.persistent).toBe(false);
    expect(list.properties).toHaveLength(1);
    expect(list.properties[0].title).toBe(INPUT.title);
    // El ROL viaja al panel: es su identificación.
    expect(list.properties[0].rol).toBe('15234-67');
  });

  it('el listado acota por corredora: lo de otra no aparece', async () => {
    await store.createPublication(INPUT, { partnerId: 'catedral', userId: null });
    const other = await store.listPartnerPublications('otra-corredora');
    expect(other.properties).toHaveLength(0);
  });

  it('edita lo propio y no encuentra lo ajeno', async () => {
    const created = await store.createPublication(INPUT, {
      partnerId: 'catedral',
      userId: null,
    });
    const id = created.property!.id;

    const mine = await store.updatePublication(id, 'catedral', { price: 99_000_000 });
    expect(mine.ok).toBe(true);
    expect(mine.property?.price).toBe(99_000_000);

    const foreign = await store.updatePublication(id, 'otra-corredora', { price: 1 });
    expect(foreign.ok).toBe(false);
    expect(foreign.reason).toBe('not_found');
  });

  it('borra lo propio y no encuentra lo ajeno', async () => {
    const created = await store.createPublication(INPUT, {
      partnerId: 'catedral',
      userId: null,
    });
    const id = created.property!.id;

    const foreign = await store.deletePublication(id, 'otra-corredora');
    expect(foreign.ok).toBe(false);
    expect(foreign.reason).toBe('not_found');

    const mine = await store.deletePublication(id, 'catedral');
    expect(mine.ok).toBe(true);
    expect((await store.listPartnerPublications('catedral')).properties).toHaveLength(0);
  });
});

describe('con proyecto configurado', () => {
  it('el alta escribe partner_id, user_id, location en WKT y el ROL/video', async () => {
    configureSupabase();
    sb.reset([
      {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        ...INPUT,
        location: { type: 'Point', coordinates: [INPUT.lng, INPUT.lat] },
        partner_id: 'catedral',
      },
    ]);

    const created = await store.createPublication(
      { ...INPUT, rol: '15234-67', video_url: 'https://cdn.example/promo.mp4' },
      { partnerId: 'catedral', userId: 'uuid-del-usuario' }
    );

    expect(created.ok).toBe(true);
    expect(created.persisted).toBe(true);
    expect(sb.state.ops).toContain('from:properties');
    expect(sb.state.ops).toContain('insert');
    expect(sb.state.lastInsert).toMatchObject({
      partner_id: 'catedral',
      user_id: 'uuid-del-usuario',
      title: INPUT.title,
      rol: '15234-67',
      video_url: 'https://cdn.example/promo.mp4',
      // PostGIS: longitud primero, como exige POINT(lng lat).
      location: `POINT(${INPUT.lng} ${INPUT.lat})`,
    });

    // La fila devuelta trae location GeoJSON: se convierte a lat/lng planos.
    expect(created.property?.lat).toBe(INPUT.lat);
    expect(created.property?.lng).toBe(INPUT.lng);
  });

  it('rol o video vacío viaja como NULL (para poder borrarlos desde la edición)', async () => {
    configureSupabase();
    sb.reset([{ id: 'p1', location: { type: 'Point', coordinates: [0, 0] } }]);

    await store.updatePublication('p1', 'catedral', { rol: '', video_url: '' });

    expect(sb.state.lastPatch).toMatchObject({ rol: null, video_url: null });
  });

  it('crear sin ROL ni video no incluye esas columnas (base previa a 0015)', async () => {
    configureSupabase();
    sb.reset([{ id: 'p1', location: { type: 'Point', coordinates: [0, 0] } }]);

    await store.createPublication(INPUT, { partnerId: 'catedral', userId: null });

    expect(sb.state.lastInsert).not.toHaveProperty('rol');
    expect(sb.state.lastInsert).not.toHaveProperty('video_url');
  });

  it('el listado va filtrado por partner_id además de la sesión', async () => {
    configureSupabase();
    sb.reset([
      {
        id: 'p1',
        title: 'X',
        price: 1,
        location: { type: 'Point', coordinates: [-70.6, -33.4] },
      },
    ]);

    const list = await store.listPartnerPublications('catedral');

    expect(list.source).toBe('supabase');
    expect(list.persistent).toBe(true);
    expect(sb.state.ops).toContain('eq:partner_id=catedral');
    expect(list.properties).toHaveLength(1);
  });

  it('editar y borrar acotan por id Y por corredora', async () => {
    configureSupabase();
    sb.reset([{ id: 'p1', price: 100, location: { type: 'Point', coordinates: [0, 0] } }]);

    await store.updatePublication('p1', 'catedral', { price: 200 });
    expect(sb.state.ops).toContain('eq:id=p1');
    expect(sb.state.ops).toContain('eq:partner_id=catedral');
    expect(sb.state.lastPatch).toMatchObject({ price: 200 });

    sb.reset([{ id: 'p1' }]);
    await store.deletePublication('p1', 'catedral');
    expect(sb.state.ops).toContain('delete');
    expect(sb.state.ops).toContain('eq:id=p1');
    expect(sb.state.ops).toContain('eq:partner_id=catedral');
  });

  it('sin fila que coincida responde not_found (no un éxito vacío)', async () => {
    configureSupabase();
    sb.reset([]);

    const updated = await store.updatePublication('p1', 'catedral', { price: 2 });
    expect(updated.ok).toBe(false);
    expect(updated.reason).toBe('not_found');

    const deleted = await store.deletePublication('p1', 'catedral');
    expect(deleted.ok).toBe(false);
    expect(deleted.reason).toBe('not_found');
  });

  it('un error de la base se reporta como database, no como éxito', async () => {
    configureSupabase();
    sb.reset([], { message: 'column "partner_id" does not exist' });

    const created = await store.createPublication(INPUT, {
      partnerId: 'catedral',
      userId: null,
    });
    expect(created.ok).toBe(false);
    expect(created.reason).toBe('database');
    expect(created.persisted).toBe(true);
  });
});

describe('rowToPublication', () => {
  it('lee la ubicación desde GeoJSON (lo que devuelven los RPC)', () => {
    const property = store.rowToPublication({
      id: 'p1',
      price: '90000000',
      bathrooms: '2.5',
      location: { type: 'Point', coordinates: [-70.587, -33.419] },
    });

    expect(property.lng).toBe(-70.587);
    expect(property.lat).toBe(-33.419);
    expect(property.price).toBe(90_000_000);
    expect(property.bathrooms).toBe(2.5);
    expect(property.images).toEqual([]);
    expect(property.features).toEqual([]);
  });

  it('lee la ubicación desde el EWKB en hex, que es lo que devuelve la base', () => {
    // Hex tal cual lo devolvió PostgREST para una ficha de Pucón: EWKB de un
    // Point con SRID 4326. Es el caso que dejaba toda ficha de la base en 0,0.
    const property = store.rowToPublication({
      id: 'p2',
      location: '0101000020E6100000D9CEF753E3FD51C01904560E2DA243C0',
    });

    expect(property.lng).toBeCloseTo(-71.967, 6);
    expect(property.lat).toBeCloseTo(-39.267, 6);
  });

  it('tolera location en WKT y ausente', () => {
    const wkt = store.rowToPublication({ id: 'a', location: 'POINT(-70.6 -33.4)' });
    expect(wkt.lng).toBe(-70.6);
    expect(wkt.lat).toBe(-33.4);

    const missing = store.rowToPublication({ id: 'b' });
    expect(missing.lat).toBe(0);
    expect(missing.lng).toBe(0);
  });

  it('no inventa coordenadas cuando el valor no es un punto legible', () => {
    // Texto suelto, hex truncado y una geometría que no es un Point: los tres
    // tienen que quedar en 0,0 en vez de dejar pasar un NaN a la ficha.
    for (const location of ['', 'no-es-un-punto', '0101000020E6100000', '0102000020E6100000']) {
      const property = store.rowToPublication({ id: 'x', location });
      expect([property.lat, property.lng], `location: ${location}`).toEqual([0, 0]);
    }
  });
});
