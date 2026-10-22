/**
 * @vitest-environment node
 *
 * Tests del cargador perezoso del cliente de Supabase.
 *
 * Lo que se prueba es el contrato que sostiene el ahorro: **no crear nada hasta
 * que se pide** y crear una sola instancia para toda la página. Si el módulo
 * volviera a importar `@supabase/ssr` de forma estática, el SDK regresaría al
 * bundle inicial y estos tests no lo notarían; eso lo cubre el build, donde el
 * chunk con `GoTrueClient` deja de estar en las rutas públicas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createBrowserClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ id: 'cliente-de-prueba' })),
}));

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

import { loadClient, resetClientForTests } from './client';

beforeEach(() => {
  createBrowserClient.mockClear();
  resetClientForTests();
});

describe('loadClient', () => {
  it('no crea el cliente hasta que alguien lo pide', () => {
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it('comparte una sola instancia entre quienes lo piden a la vez', async () => {
    const [first, second] = await Promise.all([loadClient(), loadClient()]);

    expect(first).toBe(second);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });

  it('la reutiliza en pedidos posteriores', async () => {
    const first = await loadClient();
    const second = await loadClient();

    expect(second).toBe(first);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });
});
