import { revalidatePath } from 'next/cache';
import { getPartnerById } from './partners-store';

/**
 * Lo público que hay que tirar cuando el panel guarda una publicación.
 *
 * Las páginas públicas se generan con ISR: `/empresas/[slug]` revalida a los
 * 300 s y la ficha y la landing compartible a los 60. Sin invalidación por
 * demanda, una corredora publicaba desde su panel y **su propia página de
 * empresa seguía mostrando el listado anterior** hasta cinco minutos — con el
 * portal y su panel ya al día, y sin ninguna señal de que algo faltaba.
 *
 * Qué se invalida, y por qué cada una:
 *
 * 1. **`/empresas/<slug>`** — el listado de la corredora dueña. El slug **no**
 *    siempre es el id (el catálogo tuvo fichas con punto en el id), así que se
 *    resuelve con la misma fuente que usa la página. Si el slug no se puede
 *    resolver —base caída, id desconocido— se invalida el segmento entero
 *    (`/empresas/[slug]`): regenerar una página de más cuesta una consulta;
 *    dejar la vieja cuesta la confianza en el dato.
 * 2. **`/properties/<id>`** y **`/compartir/<id>`** — la ficha y el enlace que
 *    la corredora manda a sus clientes. Una edición tiene que verse ahí, y una
 *    baja tiene que dejar de servirlos: si el aviso se elimina, el enlace que
 *    ya circuló no puede seguir mostrándolo.
 *
 * Es **total**: no lanza nunca. La publicación ya está guardada cuando esto
 * corre, y devolver un error por no haber podido limpiar una caché haría que la
 * persona reintente y publique dos veces. El peor caso —no invalidar— lo cubre
 * el `revalidate` de cada página, que es el motivo por el que existe.
 *
 * Devuelve las rutas efectivamente invalidadas, para poder probarlo.
 */
export async function revalidatePublicationSurfaces(
  partnerId: string,
  propertyId?: string
): Promise<string[]> {
  const invalidated: string[] = [];

  try {
    const slug = await resolveSlug(partnerId);

    // Sin slug resoluble, se tira el segmento completo en vez de adivinar.
    if (slug) {
      if (purge(`/empresas/${slug}`)) invalidated.push(`/empresas/${slug}`);
    } else if (purge('/empresas/[slug]', 'page')) {
      invalidated.push('/empresas/[slug]');
    }

    if (propertyId) {
      for (const path of [`/properties/${propertyId}`, `/compartir/${propertyId}`]) {
        if (purge(path)) invalidated.push(path);
      }
    }
  } catch {
    // Nada de acá puede impedir que la escritura se reporte como buena.
  }

  return invalidated;
}

/** El slug de la corredora, o `undefined` si no se pudo averiguar. */
async function resolveSlug(partnerId: string): Promise<string | undefined> {
  try {
    return (await getPartnerById(partnerId))?.slug;
  } catch {
    return undefined;
  }
}

/** Invalida una ruta y dice si se pudo, sin propagar el fallo. */
function purge(path: string, type?: 'page' | 'layout'): boolean {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
    return true;
  } catch {
    // Fuera de una petición (o con el almacén de caché caído) no hay nada que
    // invalidar, y la escritura ya se hizo: se sigue sin ruido.
    return false;
  }
}
