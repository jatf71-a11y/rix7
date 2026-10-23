/**
 * @vitest-environment node
 *
 * El alta pública de una solicitud tiene una trampa de RLS: insertar con
 * `.select()` exige permiso de lectura, y quien envía el formulario es anónimo.
 * Este test fija que el store genera el id e inserta sin volver a leer la fila.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insert, from, isSupabaseConfigured, sessionFrom, chain } = vi.hoisted(() => ({
  insert: vi.fn(),
  from: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  sessionFrom: vi.fn(),
  // Encadenado de `update(...).eq(...).select(...).maybeSingle()`.
  chain: { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() },
}));

vi.mock('@/lib/supabase/config', () => ({ isSupabaseConfigured }));
vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: async () => ({ from }),
  createClient: async () => ({ from: sessionFrom }),
}));

import {
  countSolicitudesNuevas,
  createSolicitud,
  listSolicitudes,
  updateSolicitudStatus,
} from './solicitudesStore';

const SOLICITUD = {
  kind: 'propuestas' as const,
  name: 'Ana Pérez',
  email: 'ana@example.cl',
  phone: '+56 9 1234 5678',
  company: null,
  message: null,
  payload: {
    operation: 'sale',
    property_type: 'apartment',
    region: 'Región Metropolitana de Santiago',
    commune: 'Providencia',
    expected_price: 120_000_000,
    address: null,
  },
  consent: true as const,
};

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  from.mockReset().mockReturnValue({ insert });
  isSupabaseConfigured.mockReturnValue(true);

  chain.update.mockReset().mockReturnValue(chain);
  chain.eq.mockReset().mockReturnValue(chain);
  chain.select.mockReset().mockReturnValue(chain);
  chain.maybeSingle.mockReset();
  sessionFrom.mockReset().mockReturnValue(chain);
});

describe('countSolicitudesNuevas', () => {
  it('pide el total con una consulta head y solo de las nuevas', async () => {
    const select = vi.fn();
    const eq = vi.fn();
    const countChain = { select, eq };
    sessionFrom.mockReturnValue(countChain);
    select.mockReturnValue(countChain);
    eq.mockResolvedValue({ count: 4, error: null });

    const result = await countSolicitudesNuevas();

    expect(result).toEqual({ count: 4, source: 'supabase', persistent: true });
    expect(sessionFrom).toHaveBeenCalledWith('solicitudes');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(eq).toHaveBeenCalledWith('status', 'nueva');
  });

  it('si la base falla no inventa el número: cuenta la copia en memoria', async () => {
    isSupabaseConfigured.mockReturnValue(false);

    const before = await countSolicitudesNuevas();
    const created = await createSolicitud(SOLICITUD);
    const afterCreate = await countSolicitudesNuevas();

    expect(before.persistent).toBe(false);
    expect(afterCreate.count).toBe(before.count + 1);

    // Revisar una solicitud la saca del contador: solo se cuentan las «nuevas».
    await updateSolicitudStatus(String(created.id), 'contactada');
    const afterReview = await countSolicitudesNuevas();
    expect(afterReview.count).toBe(before.count);
  });
});

describe('createSolicitud', () => {
  it('genera el id e inserta sin volver a leer la fila', async () => {
    const result = await createSolicitud(SOLICITUD);

    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(from).toHaveBeenCalledWith('solicitudes');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.id,
        kind: 'propuestas',
        consent: true,
        payload: expect.objectContaining({ expected_price: 120_000_000 }),
      })
    );
  });

  it('no finge un alta exitosa cuando la base rechaza el INSERT', async () => {
    insert.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });

    const result = await createSolicitud(SOLICITUD);

    expect(result).toMatchObject({
      ok: false,
      persisted: true,
      error: 'new row violates row-level security policy',
    });
  });
});

describe('updateSolicitudStatus', () => {
  const FILA = {
    id: 's1',
    kind: 'propuestas',
    name: 'Ana Pérez',
    email: 'ana@example.cl',
    phone: '+56 9 1234 5678',
    company: null,
    message: null,
    payload: { commune: 'Providencia' },
    consent: true,
    status: 'contactada',
    created_at: '2026-10-21T12:00:00Z',
  };

  it('actualiza con la sesión y devuelve la fila como la ve el panel', async () => {
    chain.maybeSingle.mockResolvedValue({ data: FILA, error: null });

    const result = await updateSolicitudStatus('s1', 'contactada');

    expect(result).toMatchObject({ ok: true, found: true, persisted: true });
    expect(result.solicitud).toMatchObject({ id: 's1', status: 'contactada' });
    expect(chain.update).toHaveBeenCalledWith({ status: 'contactada' });
    expect(chain.eq).toHaveBeenCalledWith('id', 's1');
    // Sin `.select()` no se distingue «actualicé» de «no toqué ninguna fila».
    expect(chain.select).toHaveBeenCalled();
    // La escritura va con la sesión del admin, no con el cliente público.
    expect(sessionFrom).toHaveBeenCalledWith('solicitudes');
  });

  it('una fila que no existe (o que la RLS no deja ver) es «no encontrada»', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await updateSolicitudStatus('s9', 'cerrada');

    expect(result).toMatchObject({ ok: false, found: false });
  });

  it('no finge el cambio cuando la base responde con error', async () => {
    chain.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    });

    const result = await updateSolicitudStatus('s1', 'cerrada');

    expect(result).toMatchObject({ ok: false, found: true, persisted: true });
    expect(result.error).toBe('new row violates row-level security policy');
  });

  it('en desarrollo sin Supabase actualiza la copia en memoria y lo dice', async () => {
    isSupabaseConfigured.mockReturnValue(false);
    const created = await createSolicitud(SOLICITUD);

    const result = await updateSolicitudStatus(String(created.id), 'en_revision');

    expect(result).toMatchObject({ ok: true, found: true, persisted: false });
    expect(result.solicitud?.status).toBe('en_revision');

    const { solicitudes } = await listSolicitudes();
    expect(solicitudes.find((s) => s.id === created.id)?.status).toBe('en_revision');
    // El cliente de sesión no se toca cuando no hay Supabase.
    expect(sessionFrom).not.toHaveBeenCalled();
  });
});
