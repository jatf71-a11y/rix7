/**
 * @vitest-environment node
 *
 * La búsqueda de una propiedad por id, que comparten la landing de `/compartir`
 * y su tarjeta de Open Graph.
 *
 * Lo que se fija acá es la política de caché del último respaldo, y no es un
 * detalle: `/compartir/[id]` se prerenderiza con `revalidate = 60`, así que un
 * `fetch` con `no-store` dentro de ese render hace que Next lo rechace en
 * producción con «Page changed from static to dynamic at runtime». El síntoma
 * era un 500 en toda URL de un id que no existe (ni en el catálogo ni en
 * Supabase), justo el caso en que el respaldo por API corre.
 *
 * Los dos primeros pasos (catálogo, Supabase) no se ejercitan acá: el catálogo
 * estático se prueba con un id que sí está, y Supabase queda fuera porque sin
 * variables de entorno configuradas el módulo lo salta solo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPropertyById } from './propertyLookup';

const realFetch = global.fetch;

interface Call {
  url: string;
  init?: RequestInit & { next?: { revalidate?: number } };
}

/** Reemplaza `fetch` y deja constancia de con qué se llamó. */
function stubFetch(response: Response | (() => never)): Call[] {
  const calls: Call[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: Call['init']) => {
    calls.push({ url: String(input), init });
    if (typeof response === 'function') response();
    return response as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe('fetchPropertyById · respaldo por API', () => {
  it('pide la API con revalidate y sin no-store', async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ success: false, error: 'Propiedad no encontrada' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await fetchPropertyById('no-existe');

    expect(result).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/properties\/no-existe$/);
    // El motivo del test: un `no-store` acá devuelve 500 en producción.
    expect(calls[0].init).not.toHaveProperty('cache');
    expect(calls[0].init?.next).toEqual({ revalidate: 60 });
  });

  it('devuelve la propiedad cuando la API la encuentra', async () => {
    const property = { id: 'abc', title: 'Departamento', price: 1000 };
    stubFetch(
      new Response(JSON.stringify({ success: true, data: property }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(fetchPropertyById('abc')).resolves.toMatchObject({ id: 'abc' });
  });

  it('no sale a la red cuando el id está en el catálogo estático', async () => {
    const calls = stubFetch(new Response('', { status: 500 }));

    const property = await fetchPropertyById('scl-depto-marco-polo');

    expect(property?.id).toBe('scl-depto-marco-polo');
    expect(calls).toHaveLength(0);
  });

  it('devuelve null si la API falla en vez de propagar el error', async () => {
    stubFetch(() => {
      throw new Error('ECONNRESET');
    });

    await expect(fetchPropertyById('otro')).resolves.toBeNull();
  });
});
