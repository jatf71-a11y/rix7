/**
 * @vitest-environment node
 *
 * Tests de `GET /api/admin/share-events`.
 *
 * Son datos de personas: el único camino es la sesión con rol admin. El store y
 * el guard se mockean; lo que se prueba es la puerta, el límite de filas y que
 * el panel reciba si el registro persiste.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { listShareEvents, requireAdmin } = vi.hoisted(() => ({
  listShareEvents: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/data/shareEventsStore', () => ({ listShareEvents }));
vi.mock('@/lib/supabase/auth-guard', () => ({ requireAdmin }));

import { GET } from './route';

function requestOf(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/share-events${query}`);
}

beforeEach(() => {
  listShareEvents.mockReset().mockResolvedValue({
    events: [{ id: 's1', name: 'Ana Prueba', channel: 'copy' }],
    source: 'supabase',
    persistent: true,
  });
  requireAdmin.mockReset().mockResolvedValue({ ok: true, role: 'admin', devBypass: false });
});

describe('GET /api/admin/share-events', () => {
  it('responde 403 cuando el guard rechaza y no lee nada', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ success: false }), { status: 403 }),
    });

    const response = await GET(requestOf());
    expect(response.status).toBe(403);
    expect(listShareEvents).not.toHaveBeenCalled();
  });

  it('devuelve los compartidos con su origen y si persisten', async () => {
    const response = await GET(requestOf());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      source: 'supabase',
      persistent: true,
      data: [{ id: 's1' }],
    });
    // Sin query usa el tope por defecto del panel.
    expect(listShareEvents).toHaveBeenCalledWith(200);
  });

  it('acepta un límite y lo acota al máximo', async () => {
    await GET(requestOf('?limit=25'));
    expect(listShareEvents).toHaveBeenLastCalledWith(25);

    await GET(requestOf('?limit=100000'));
    expect(listShareEvents).toHaveBeenLastCalledWith(500);

    await GET(requestOf('?limit=basura'));
    expect(listShareEvents).toHaveBeenLastCalledWith(200);
  });
});
