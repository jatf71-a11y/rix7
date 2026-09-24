/**
 * @vitest-environment node
 *
 * Tests del store de corredoras: la base manda, el catálogo es el respaldo y el
 * modo de desarrollo sin Supabase se marca como no persistente.
 *
 * El cliente de Supabase se reemplaza por uno falso encadenable (`from().select()
 * .eq()...`) para poder ejercitar la ruta de base de datos sin una base real —
 * que es justamente donde no se puede probar a mano en este entorno.
 *
 * El store guarda el respaldo en memoria a nivel de módulo, así que cada test
 * parte limpio con `vi.resetModules()` + import dinámico.
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
    b.select = () => b;
    b.order = () => Promise.resolve(result());
    b.eq = (column: string, value: unknown) => {
      state.ops.push(`eq:${column}=${String(value)}`);
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

/**
 * Deja el entorno como "proyecto Supabase real".
 *
 * Hacen falta las dos variables: `isSupabaseConfigured()` exige url **y** anon
 * key, porque con la url sola el cliente no puede hablar con la base.
 */
function configureSupabase(): void {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', CONFIGURED_URL);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-prueba');
}

const rowCbre = {
  id: 'cbre',
  slug: 'cbre',
  name: 'CBRE Chile',
  logo: '/logos/cbre.png',
  description: 'La consultora inmobiliaria más grande del mundo',
  website: 'https://www.cbre.com',
  color: '#0050AA',
  contact_phone: '+56 2 2000 0003',
  contact_whatsapp: '+56 9 0000 0003',
  contact_email: 'contacto@cbre.com',
  sort_order: 2,
};

let store: typeof import('./partners-store');

beforeEach(async () => {
  vi.resetModules();
  sb.reset();
  // Por defecto: sin Supabase (el caso de este checkout, que usa el placeholder).
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  store = await import('./partners-store');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('listPartners', () => {
  it('sin Supabase configurado usa el catálogo y avisa que no persistirá', async () => {
    const result = await store.listPartners();

    expect(result.source).toBe('catalog');
    expect(result.persistent).toBe(false);
    expect(result.partners.length).toBeGreaterThan(0);
    // No se tocó la base: no hay operaciones registradas.
    expect(sb.state.ops).toEqual([]);
  });

  it('con Supabase configurado lee las filas de la tabla, con su contacto', async () => {
    configureSupabase();
    sb.reset([rowCbre]);

    const result = await store.listPartners();

    expect(result.source).toBe('supabase');
    expect(result.persistent).toBe(true);
    expect(result.emptyTable).toBe(false);
    expect(result.partners).toEqual([
      expect.objectContaining({
        id: 'cbre',
        name: 'CBRE Chile',
        contact: {
          phone: '+56 2 2000 0003',
          whatsapp: '+56 9 0000 0003',
          email: 'contacto@cbre.com',
        },
      }),
    ]);
    expect(sb.state.ops).toContain('from:partners');
  });

  it('ordena por sort_order y, a igualdad, por nombre', async () => {
    configureSupabase();
    sb.reset([
      { ...rowCbre, id: 'z', name: 'Zeta', sort_order: 1 },
      { ...rowCbre, id: 'b', name: 'Beta', sort_order: 0 },
      { ...rowCbre, id: 'a', name: 'Alfa', sort_order: 0 },
    ]);

    const result = await store.listPartners();
    expect(result.partners.map((p) => p.id)).toEqual(['a', 'b', 'z']);
  });

  it('con la tabla vacía cae al catálogo pero marca que falta el seed', async () => {
    configureSupabase();
    sb.reset([]);

    const result = await store.listPartners();

    expect(result.source).toBe('catalog');
    expect(result.emptyTable).toBe(true);
    // Las escrituras sí van a la base: lo que falta es sembrarla.
    expect(result.persistent).toBe(true);
  });

  it('si la base falla, el portal sigue mostrando el catálogo', async () => {
    configureSupabase();
    sb.reset([], { message: 'connection refused' });

    const result = await store.listPartners();

    expect(result.source).toBe('catalog');
    expect(result.partners.length).toBeGreaterThan(0);
  });
});

describe('getPartnerById', () => {
  it('sin Supabase resuelve desde el catálogo, incluido el id con punto', async () => {
    const catedral = await store.getPartnerById('catedral');
    expect(catedral?.name).toBe('Catedral Propiedades');

    const portal = await store.getPartnerById('.portal-inmobiliario');
    expect(portal?.slug).toBe('portal-inmobiliario');
  });

  it('con Supabase devuelve la fila de la base', async () => {
    configureSupabase();
    sb.reset([rowCbre]);

    const partner = await store.getPartnerById('cbre');

    expect(partner?.name).toBe('CBRE Chile');
    expect(sb.state.ops).toContain('eq:id=cbre');
  });

  it('si la corredora no está en la base, cae al catálogo', async () => {
    configureSupabase();
    sb.reset([]); // la tabla no la tiene (por ejemplo, sin seed)

    const partner = await store.getPartnerById('catedral');
    expect(partner?.name).toBe('Catedral Propiedades');
  });

  it('un id vacío no consulta nada', async () => {
    expect(await store.getPartnerById('')).toBeUndefined();
    expect(sb.state.ops).toEqual([]);
  });
});

describe('getPartnerBySlug', () => {
  it('busca por slug, que es el que arma las URLs de /empresas', async () => {
    configureSupabase();
    sb.reset([rowCbre]);

    await store.getPartnerBySlug('cbre');
    expect(sb.state.ops).toContain('eq:slug=cbre');
  });

  it('sin Supabase resuelve desde el catálogo', async () => {
    const partner = await store.getPartnerBySlug('yapo');
    expect(partner?.name).toBe('Yapo.cl');
  });
});

describe('escrituras sin Supabase (modo desarrollo)', () => {
  const nueva = {
    id: 'nueva-corredora',
    slug: 'nueva-corredora',
    name: 'Nueva Corredora',
    logo: '/logos/x.png',
    description: 'Prueba',
    color: '#123456',
    contact: { phone: '2', whatsapp: '9', email: 'a@b.cl' },
  };

  it('crea en memoria y avisa que no persistió', async () => {
    const result = await store.createPartner(nueva);

    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(false);

    const listado = await store.listPartners();
    expect(listado.partners.some((p) => p.id === 'nueva-corredora')).toBe(true);
    expect(sb.state.ops).toEqual([]);
  });

  it('no permite duplicar el id', async () => {
    await store.createPartner(nueva);
    const repetida = await store.createPartner(nueva);

    expect(repetida.ok).toBe(false);
    expect(repetida.reason).toBe('duplicate');
  });

  it('actualiza y conserva los contactos que no venían en el cambio', async () => {
    const result = await store.updatePartner('catedral', { name: 'Catedral SpA' });

    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.partner?.name).toBe('Catedral SpA');
    expect(result.partner?.contact.phone).toBe('+56 2 2000 0001');
  });

  it('informa cuando la corredora no existe', async () => {
    const result = await store.updatePartner('no-existe', { name: 'X' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_found');

    const borrado = await store.deletePartner('no-existe');
    expect(borrado.ok).toBe(false);
    expect(borrado.reason).toBe('not_found');
  });

  it('elimina en memoria', async () => {
    const result = await store.deletePartner('yapo');
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(false);

    const listado = await store.listPartners();
    expect(listado.partners.some((p) => p.id === 'yapo')).toBe(false);
  });
});

describe('escrituras con Supabase configurado', () => {
  beforeEach(() => {
    configureSupabase();
  });

  it('inserta la corredora y devuelve la fila guardada con su contacto', async () => {
    sb.reset([rowCbre]);

    const result = await store.createPartner({
      id: 'cbre',
      slug: 'cbre',
      name: 'CBRE Chile',
      logo: '/logos/cbre.png',
      description: 'Consultora',
      color: '#0050AA',
      contact: { phone: 'a', whatsapp: 'b', email: 'c' },
    });

    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);
    expect(sb.state.lastInsert).toMatchObject({
      id: 'cbre',
      contact_phone: 'a',
      contact_whatsapp: 'b',
      contact_email: 'c',
    });
    expect(result.partner?.contact.whatsapp).toBe('+56 9 0000 0003');
  });

  it('traduce la clave duplicada de Postgres (23505) a un motivo legible', async () => {
    sb.reset([], { message: 'duplicate key value', code: '23505' });

    const result = await store.createPartner({
      id: 'cbre',
      slug: 'cbre',
      name: 'CBRE',
      logo: '',
      description: '',
      color: '#000000',
      contact: { phone: '', whatsapp: '', email: '' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  it('actualiza solo las claves enviadas: editar el nombre no borra los teléfonos', async () => {
    sb.reset([rowCbre]);

    const result = await store.updatePartner('cbre', { name: 'CBRE Chile SpA' });

    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);
    expect(sb.state.lastPatch).toEqual({ name: 'CBRE Chile SpA' });
  });

  it('devuelve not_found cuando la fila no existe en la base', async () => {
    sb.reset([]);

    const result = await store.updatePartner('cbre', { name: 'X' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_found');
    expect(result.persisted).toBe(true);
  });

  it('elimina la fila y distingue el borrado real de la ausencia', async () => {
    sb.reset([{ id: 'cbre' }]);
    const borrado = await store.deletePartner('cbre');
    expect(borrado.ok).toBe(true);
    expect(sb.state.ops).toContain('delete');

    sb.reset([]);
    const ausente = await store.deletePartner('cbre');
    expect(ausente.ok).toBe(false);
    expect(ausente.reason).toBe('not_found');
  });

  it('un error de la base no se disfraza de éxito', async () => {
    sb.reset([], { message: 'permission denied for table partners' });

    const result = await store.updatePartner('cbre', { name: 'X' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('database');
    expect(result.error).toMatch(/permission denied/);
  });
});
