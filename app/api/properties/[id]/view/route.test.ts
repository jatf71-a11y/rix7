/**
 * @vitest-environment node
 *
 * Tests de `POST /api/properties/[id]/view`.
 *
 * Es el único endpoint del proyecto que no exigía ni sesión ni admin y sí
 * contaba escrituras, y no tenía cobertura. Lo que importa acá:
 *
 * - Un id inválido se rechaza antes de tocar el store.
 * - `counted: true` suma; `counted: false` solo lee (recargar no debe inflar).
 * - Con la IP pasada del cupo se deja de sumar pero **se responde igual** el
 *   total, para que el velocímetro nunca muestre un error.
 * - `persisted` viaja en ambas ramas: el velocímetro lo usa para no mostrar un
 *   conteo de prueba (sin Supabase) como si fuera real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getPropertyViews, recordPropertyView } = vi.hoisted(() => ({
  getPropertyViews: vi.fn(),
  recordPropertyView: vi.fn(),
}));

vi.mock('@/lib/data/propertyViewsStore', () => ({ getPropertyViews, recordPropertyView }));

// La route guarda el rate limit en estado de módulo: cada test parte del cero.
let route: typeof import('./route');

const post = (body: unknown, ip = '1.2.3.4') =>
  new Request('http://localhost/api/properties/scl-depto-marco-polo/view', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  }) as any;

const ctx = (id = 'scl-depto-marco-polo') => ({ params: { id } });

beforeEach(async () => {
  vi.resetModules();
  route = await import('./route');
  getPropertyViews.mockReset().mockResolvedValue({ views: 7, persisted: true });
  recordPropertyView.mockReset().mockResolvedValue({ views: 8, persisted: true });
});

describe('POST /api/properties/[id]/view', () => {
  it('rechaza un id de propiedad inválido sin tocar el store', async () => {
    const res = await route.POST(post({ counted: true }), ctx('../../etc/passwd'));

    expect(res.status).toBe(400);
    expect(recordPropertyView).not.toHaveBeenCalled();
    expect(getPropertyViews).not.toHaveBeenCalled();
  });

  it('cuenta la visita por defecto y responde 202', async () => {
    const res = await route.POST(post({}), ctx());
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.counted).toBe(true);
    expect(body.views).toBe(8);
    expect(body.persisted).toBe(true);
    expect(recordPropertyView).toHaveBeenCalledWith('scl-depto-marco-polo');
  });

  it('propaga persisted:false cuando el conteo no sobrevive al reinicio', async () => {
    recordPropertyView.mockResolvedValue({ views: 3, persisted: false });

    const res = await route.POST(post({}), ctx());
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.views).toBe(3);
    expect(body.persisted).toBe(false);
  });

  it('con counted:false solo lee el total y no suma', async () => {
    const res = await route.POST(post({ counted: false }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.counted).toBe(false);
    expect(body.views).toBe(7);
    expect(body.persisted).toBe(true);
    expect(getPropertyViews).toHaveBeenCalledWith('scl-depto-marco-polo');
    expect(recordPropertyView).not.toHaveBeenCalled();
  });

  it('la lectura sin Supabase también informa persisted:false', async () => {
    getPropertyViews.mockResolvedValue({ views: 2, persisted: false });

    const res = await route.POST(post({ counted: false }), ctx());
    const body = await res.json();

    expect(body.views).toBe(2);
    expect(body.persisted).toBe(false);
  });

  it('un cuerpo no-JSON se trata como visita nueva, no como error', async () => {
    const res = await route.POST(post('{roto'), ctx());

    expect(res.status).toBe(202);
    expect(recordPropertyView).toHaveBeenCalled();
  });

  it('pasada la ráfaga deja de sumar pero sigue devolviendo el total', async () => {
    let noContadas = 0;
    for (let i = 0; i < 130; i++) {
      const res = await route.POST(post({ counted: true }, '9.9.9.9'), ctx());
      const body = await res.json();
      if (body.counted === false) {
        noContadas += 1;
        expect(res.status).toBe(200);
      }
    }

    expect(noContadas).toBeGreaterThan(0);
    // El cupo acota cuántas veces se escribió de verdad.
    expect(recordPropertyView.mock.calls.length).toBeLessThan(130);
    // Y cuando se dejó de contar, se leyó el total para poder mostrarlo.
    expect(getPropertyViews).toHaveBeenCalled();
  });
});
