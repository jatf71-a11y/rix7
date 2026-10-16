/**
 * Filas del sitemap: **la tabla manda**, el catálogo del build solo aporta lo que
 * la tabla todavía no tiene.
 *
 * El id de la tabla y el del catálogo son de espacios distintos: el catálogo usa
 * ids legibles (`scl-casa-de-la-reina`) y la tabla un uuid —el uuid v5 del id del
 * catálogo, para que derivarlo sea reproducible: ver `supabase/seed.sql`—, así que
 * comparar por id **no alcanza**. Con las 35 fichas del catálogo cargadas en la
 * base, el sitemap publicaba dos URLs con el mismo contenido para cada una de
 * ellas: la del uuid recién migrada y la del id del catálogo, que también
 * resuelve (la ficha cae al catálogo cuando la tabla no la tiene).
 *
 * La regla es la misma que la de la lectura de cada corredora
 * (`listPartnerProperties`): una ficha del catálogo se omite cuando **su corredora
 * ya tiene filas en la tabla**, porque en ese momento esa corredora se sirve
 * enteramente de la base y el id del catálogo ya no lo enlaza nadie. Mientras una
 * corredora no tenga ninguna fila, sus fichas del catálogo siguen entrando: son su
 * contenido de arranque, y su URL es la única que existe.
 */

/** Lo mínimo que el sitemap necesita de una propiedad. */
export interface SitemapPropertyRow {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  /** Corredora dueña. `null`/ausente = ficha del portal, sin atribución. */
  partner_id?: string | null;
}

/**
 * Junta las filas de la tabla con las del catálogo, sin repetir fichas.
 *
 * @param hot Filas de la tabla (incluye `partner_id`).
 * @param catalogRows Filas del catálogo del build (incluye `partner_id`).
 */
export function mergePropertyRows(
  hot: SitemapPropertyRow[],
  catalogRows: SitemapPropertyRow[]
): SitemapPropertyRow[] {
  const hotIds = new Set(hot.map((row) => row.id));
  // Una corredora con filas en la tabla "manda": sus fichas del catálogo ya no
  // son su contenido, así que no aportan una segunda URL.
  const partnersInTable = new Set(
    hot
      .map((row) => row.partner_id)
      .filter((partnerId): partnerId is string => typeof partnerId === 'string' && partnerId !== '')
  );

  return [
    ...hot,
    ...catalogRows.filter(
      (row) =>
        !hotIds.has(row.id) &&
        !(typeof row.partner_id === 'string' && partnersInTable.has(row.partner_id))
    ),
  ];
}
