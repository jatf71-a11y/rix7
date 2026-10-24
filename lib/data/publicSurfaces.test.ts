/**
 * @vitest-environment node
 *
 * Tests de `revalidatePublicationSurfaces`: qué se invalida cuando el panel
 * guarda. Lo que se cuida acá es lo que se rompe en silencio —las páginas
 * públicas se sirven con ISR, así que una invalidación que falta no se ve como
 * un error, se ve como una página vieja— y el caso que ya sorprendió una vez:
 * el id de una corredora **no** es su slug (`.ficha-historica`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { revalidatePath, getPartnerById } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getPartnerById: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('./partners-store', () => ({ getPartnerById }));

import { revalidatePublicationSurfaces } from './publicSurfaces';

beforeEach(() => {
  vi.clearAllMocks();
  getPartnerById.mockResolvedValue({ id: 'inelbrok', slug: 'inelbrok' });
});

describe('revalidatePublicationSurfaces', () => {
  it('invalida la página de la corredora, su ficha y su landing', async () => {
    const paths = await revalidatePublicationSurfaces('inelbrok', 'p1');

    expect(getPartnerById).toHaveBeenCalledWith('inelbrok');
    expect(paths).toEqual(['/empresas/inelbrok', '/properties/p1', '/compartir/p1']);
    expect(revalidatePath).toHaveBeenCalledWith('/empresas/inelbrok');
    expect(revalidatePath).toHaveBeenCalledWith('/properties/p1');
    expect(revalidatePath).toHaveBeenCalledWith('/compartir/p1');
  });

  it('invalida por slug y no por id: `.ficha-historica` no es una URL', async () => {
    getPartnerById.mockResolvedValue({
      id: '.ficha-historica',
      slug: 'ficha-historica',
    });

    const paths = await revalidatePublicationSurfaces('.ficha-historica', 'p1');

    expect(paths).toContain('/empresas/ficha-historica');
    expect(paths).not.toContain('/empresas/.ficha-historica');
  });

  it('sin ficha que invalidar (alta sin id) tira solo la página de empresa', async () => {
    const paths = await revalidatePublicationSurfaces('inelbrok');

    expect(paths).toEqual(['/empresas/inelbrok']);
  });

  it('si no se puede resolver el slug, invalida el segmento completo', async () => {
    getPartnerById.mockResolvedValue(undefined);

    const paths = await revalidatePublicationSurfaces('corredora-fantasma', 'p1');

    expect(paths).toEqual(['/empresas/[slug]', '/properties/p1', '/compartir/p1']);
    expect(revalidatePath).toHaveBeenCalledWith('/empresas/[slug]', 'page');
  });

  it('una base caída no deja la ficha vieja ni rompe la escritura', async () => {
    getPartnerById.mockRejectedValue(new Error('base caída'));

    const paths = await revalidatePublicationSurfaces('inelbrok', 'p1');

    expect(paths).toEqual(['/empresas/[slug]', '/properties/p1', '/compartir/p1']);
    expect(revalidatePath).toHaveBeenCalledWith('/empresas/[slug]', 'page');
  });

  it('nunca propaga el fallo de la invalidación: la publicación ya está guardada', async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error('fuera de una petición');
    });

    await expect(revalidatePublicationSurfaces('inelbrok', 'p1')).resolves.toEqual([]);
  });
});
