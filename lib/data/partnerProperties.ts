import type { Property } from '@/lib/types/property';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { rowToPublication } from './propertiesStore';

/**
 * Propiedades de una corredora (plan fase 3, 2.1).
 *
 * **La base manda.** El listado se arma con las filas de `properties` filtradas
 * por `partner_id` **en el servidor** — nunca se traen todas para filtrar en
 * cliente, que era el fallback anterior y habría atribuido a la corredora
 * propiedades ajenas. Así lo que la corredora publica, edita o borra desde el
 * panel es lo que su página muestra: el listado dejó de ser una copia del build.
 *
 * **El catálogo del build es el contenido de arranque**, no una fuente paralela:
 * se usa solo cuando la base no puede contestar —sin Supabase configurado, o si
 * la consulta falla— o cuando **esa** corredora todavía no tiene ninguna fila. Es
 * el caso de una base recién creada (o recién copiada) sin los datos del
 * catálogo: el portal se ve completo desde el primer minuto en vez de mostrar
 * páginas vacías, y en cuanto la corredora tiene una ficha propia en la base, el
 * catálogo deja de aportar nada para ella.
 *
 * Consecuencia buscada de esa regla, para que no sorprenda: mientras una
 * corredora no tenga ninguna fila, sus fichas del catálogo siguen apareciendo
 * aunque no existan en la base. Con una sola fila publicada —la primera que cree
 * desde `/socio`— su página pasa a depender enteramente de la base.
 *
 * Consumidores: la página `/empresas/<slug>` y el feed público
 * (`/feeds/<slug>.xml`, hallazgo #14), los dos en el servidor.
 */

/** Resultado de la lectura de propiedades de una corredora. */
export interface PartnerPropertiesResult {
  properties: Property[];
  /**
   * - `supabase`: la base respondió con fichas de esta corredora (el caso normal).
   * - `catalog`: la base no pudo responder, o esta corredora todavía no tiene
   *   ninguna fila y se usó su contenido de arranque.
   */
  source: 'supabase' | 'catalog';
}

export async function listPartnerProperties(
  partnerId: string
): Promise<PartnerPropertiesResult> {
  if (isSupabaseConfigured()) {
    try {
      const { createPublicClient } = await import('@/lib/supabase/server');
      const supabase = createPublicClient();
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        // Filtro obligatorio: sin él la consulta devolvería el portal
        // completo y el feed/la página de la corredora se llenaría de
        // propiedades ajenas.
        .eq('partner_id', partnerId)
        // Las más recientes primero: lo que la corredora acaba de publicar es lo
        // que quiere ver arriba, y el orden tiene que ser estable entre visitas.
        .order('created_at', { ascending: false })
        .limit(1000);

      if (!error && data && data.length > 0) {
        // El ROL (0015) no sale de la base: es identificación interna y este
        // listado alimenta lo público (/empresas y los feeds XML, que serializan
        // la propiedad entera). Los RPC del portal ya lo excluyen con sus
        // columnas explícitas; acá, que se lee con `select('*')`, se quita en el
        // límite — antes del conversor, que copia la fila tal cual.
        //
        // `rowToPublication` es el mismo conversor que usa el panel: traduce
        // `location` (el GeoJSON que devuelve PostgREST) a `lat`/`lng` y
        // normaliza números y arreglos. Sin él la ficha llegaría a la página y al
        // feed **sin coordenadas** — el feed las publica en `<latitude>` y
        // `<longitude>`, así que el defecto saldría hacia Trovit.
        const hot = (data as Record<string, unknown>[]).map(({ rol: _rol, ...row }) =>
          rowToPublication(row)
        );
        return { properties: hot, source: 'supabase' };
      }
    } catch {
      // Sin Supabase disponible (o sin la columna aún, en una base sin
      // migrar): el contenido de arranque de abajo.
    }
  }

  // El catálogo del build se importa **sólo acá**: pesa varios megabytes y,
  // cuando la base contesta, no hace falta cargarlo.
  const { ALL_PROPERTIES } = await import('@/lib/data/propertyCatalog');
  return {
    properties: ALL_PROPERTIES.filter((property) => property.partner_id === partnerId),
    source: 'catalog',
  };
}
