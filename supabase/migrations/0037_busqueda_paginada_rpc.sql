-- ════════════════════════════════════════════════════════════════════════════
-- 0037 · Buscador con filtrado, contadores y paginación en la base
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta acá `/api/properties` pedía al RPC **todas** las filas de Chile y hacía
-- el trabajo en JavaScript: filtrar, contar por categoría, contar por operación,
-- contar por comuna y recién entonces cortar la página. Con el catálogo del
-- build eso era gratis; con la base son miles de filas viajando por PostgREST en
-- cada lectura que el CDN no tenía cacheada (medido: ~1,9 s en frío).
--
-- Esta función hace ese mismo trabajo donde viven los datos y devuelve solo la
-- página pedida más los contadores que la UI muestra. Las reglas son las de
-- `lib/data/propertyFilters.ts`, traducidas una por una:
--
-- - operación: igualdad con el estado, o todas;
-- - precios: `>=` / `<=`, y 0 equivale a «sin filtro» (igual que el `if` de JS);
-- - dormitorios: valor exacto, salvo 5 = «5 o más»;
-- - baños: valor exacto, salvo 4 = «4 o más»;
-- - privados: la tabla no tiene esa columna, así que —igual que el camino de
--   JavaScript, que lee `privates ?? 0`— solo un 0 deja pasar todo;
-- - comuna: igualdad sin distinguir mayúsculas; región: contención en ambos
--   sentidos y solo si no hay comuna;
-- - texto: sin tildes ni mayúsculas sobre título, comuna, dirección y región;
-- - proyecto/entrega: año de construcción contra el año en Chile;
-- - corredora: igualdad por `partner_id`.
--
-- Los tres conjuntos que alimentan los contadores son los mismos que armaba la
-- ruta: `base` (todo menos tipo y proyecto), `page_rows` (base + tipo +
-- proyecto), `ops` (todo menos operación) y `communes` (todo menos ubicación,
-- con proyecto).
--
-- `src` se materializa una vez: las cuatro lecturas comparten la misma foto del
-- catálogo y se evita repetir el RPC del recuadro chileno.
--
-- Es idempotente (`CREATE OR REPLACE` con la misma firma) y no borra datos.
CREATE OR REPLACE FUNCTION public.search_properties_catalog(
    p_operation TEXT DEFAULT 'all',
    p_property_type TEXT DEFAULT 'all',
    p_search TEXT DEFAULT '',
    p_region TEXT DEFAULT '',
    p_commune TEXT DEFAULT '',
    p_min_price NUMERIC DEFAULT NULL,
    p_max_price NUMERIC DEFAULT NULL,
    p_min_bedrooms INTEGER DEFAULT NULL,
    p_min_bathrooms INTEGER DEFAULT NULL,
    p_min_privates INTEGER DEFAULT NULL,
    p_new_property_type TEXT DEFAULT NULL,
    p_partner_id TEXT DEFAULT NULL,
    p_page INTEGER DEFAULT 1,
    p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_year INTEGER := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Santiago'))::INTEGER;
    v_search TEXT;
    v_region TEXT := lower(coalesce(p_region, ''));
    v_commune TEXT := lower(coalesce(p_commune, ''));
    v_operation TEXT := coalesce(nullif(p_operation, ''), 'all');
    v_type TEXT := coalesce(nullif(p_property_type, ''), 'all');
    v_new TEXT := nullif(p_new_property_type, '');
    v_limit INTEGER := greatest(1, least(coalesce(p_limit, 50), 2000));
    v_offset INTEGER;
    v_catalog BIGINT := 0;
    v_base_total BIGINT := 0;
    v_total BIGINT := 0;
    v_data JSONB := '[]'::jsonb;
    v_categories JSONB := '{}'::jsonb;
    v_communes JSONB := '{}'::jsonb;
    v_for_sale BIGINT := 0;
    v_for_rent BIGINT := 0;
BEGIN
    v_offset := greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * v_limit);
    v_search := lower(translate(coalesce(p_search, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));

    WITH src AS MATERIALIZED (
        SELECT * FROM public.get_properties_filtered(-76.0, -56.0, -66.0, -17.0)
    ),
    -- Base de los contadores: operación + ubicación + atributos + texto + socio.
    base AS (
        SELECT * FROM src p
        WHERE (v_operation = 'all' OR p.status = v_operation)
          AND (p_min_price IS NULL OR p_min_price = 0 OR p.price >= p_min_price)
          AND (p_max_price IS NULL OR p_max_price = 0 OR p.price <= p_max_price)
          AND (
              p_min_bedrooms IS NULL
              OR (p_min_bedrooms = 5 AND p.bedrooms >= 5)
              OR (p_min_bedrooms <> 5 AND p.bedrooms = p_min_bedrooms)
          )
          AND (
              p_min_bathrooms IS NULL
              OR (p_min_bathrooms = 4 AND p.bathrooms >= 4)
              OR (p_min_bathrooms <> 4 AND p.bathrooms = p_min_bathrooms)
          )
          -- Sin columna `privates` en la tabla: mismo criterio que el JS.
          AND (p_min_privates IS NULL OR p_min_privates = 0)
          AND (v_commune = '' OR lower(coalesce(p.city, '')) = v_commune)
          AND (
              v_commune <> ''
              OR v_region = ''
              OR p.state IS NULL
              OR position(v_region in lower(p.state)) > 0
              OR position(lower(p.state) in v_region) > 0
          )
          AND (
              v_search = ''
              OR position(
                  v_search in lower(translate(
                      concat_ws(' ', p.title, p.city, p.address, p.state),
                      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'
                  ))
              ) > 0
          )
          AND (p_partner_id IS NULL OR p_partner_id = '' OR p.partner_id = p_partner_id)
    ),
    -- Resultado de la búsqueda: base + tipo + proyecto/entrega.
    page_rows AS (
        SELECT * FROM base p
        WHERE (v_type = 'all' OR p.property_type = v_type)
          AND (
              v_new IS NULL
              OR (v_new = 'proyectos' AND p.year_built IS NOT NULL AND p.year_built > v_year)
              OR (v_new <> 'proyectos' AND (p.year_built IS NULL OR p.year_built <= v_year))
          )
    ),
    -- Chips de operación: todo menos la operación activa.
    ops AS (
        SELECT * FROM src p
        WHERE (p_min_price IS NULL OR p_min_price = 0 OR p.price >= p_min_price)
          AND (p_max_price IS NULL OR p_max_price = 0 OR p.price <= p_max_price)
          AND (
              p_min_bedrooms IS NULL
              OR (p_min_bedrooms = 5 AND p.bedrooms >= 5)
              OR (p_min_bedrooms <> 5 AND p.bedrooms = p_min_bedrooms)
          )
          AND (
              p_min_bathrooms IS NULL
              OR (p_min_bathrooms = 4 AND p.bathrooms >= 4)
              OR (p_min_bathrooms <> 4 AND p.bathrooms = p_min_bathrooms)
          )
          AND (p_min_privates IS NULL OR p_min_privates = 0)
          AND (v_commune = '' OR lower(coalesce(p.city, '')) = v_commune)
          AND (
              v_commune <> ''
              OR v_region = ''
              OR p.state IS NULL
              OR position(v_region in lower(p.state)) > 0
              OR position(lower(p.state) in v_region) > 0
          )
          AND (
              v_search = ''
              OR position(
                  v_search in lower(translate(
                      concat_ws(' ', p.title, p.city, p.address, p.state),
                      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'
                  ))
              ) > 0
          )
          AND (p_partner_id IS NULL OR p_partner_id = '' OR p.partner_id = p_partner_id)
    ),
    -- Dropdown de comuna: todo menos la ubicación (con proyecto, como la ruta).
    communes AS (
        SELECT * FROM src p
        WHERE (v_operation = 'all' OR p.status = v_operation)
          AND (p_min_price IS NULL OR p_min_price = 0 OR p.price >= p_min_price)
          AND (p_max_price IS NULL OR p_max_price = 0 OR p.price <= p_max_price)
          AND (
              p_min_bedrooms IS NULL
              OR (p_min_bedrooms = 5 AND p.bedrooms >= 5)
              OR (p_min_bedrooms <> 5 AND p.bedrooms = p_min_bedrooms)
          )
          AND (
              p_min_bathrooms IS NULL
              OR (p_min_bathrooms = 4 AND p.bathrooms >= 4)
              OR (p_min_bathrooms <> 4 AND p.bathrooms = p_min_bathrooms)
          )
          AND (p_min_privates IS NULL OR p_min_privates = 0)
          AND (
              v_search = ''
              OR position(
                  v_search in lower(translate(
                      concat_ws(' ', p.title, p.city, p.address, p.state),
                      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'
                  ))
              ) > 0
          )
          AND (p_partner_id IS NULL OR p_partner_id = '' OR p.partner_id = p_partner_id)
          AND (
              v_new IS NULL
              OR (v_new = 'proyectos' AND p.year_built IS NOT NULL AND p.year_built > v_year)
              OR (v_new <> 'proyectos' AND (p.year_built IS NULL OR p.year_built <= v_year))
          )
    )
    SELECT
        (SELECT count(*) FROM src),
        (SELECT count(*) FROM base),
        (SELECT count(*) FROM page_rows),
        (
            SELECT coalesce(
                jsonb_agg(row_to_json(page)::jsonb ORDER BY page.created_at DESC),
                '[]'::jsonb
            )
            FROM (
                SELECT * FROM page_rows
                ORDER BY created_at DESC
                LIMIT v_limit OFFSET v_offset
            ) page
        ),
        (
            SELECT coalesce(jsonb_object_agg(c.property_type, c.n), '{}'::jsonb)
            FROM (
                SELECT property_type, count(*) AS n
                FROM base
                WHERE property_type IN (
                    'apartment', 'house', 'premium', 'parcel',
                    'office', 'land', 'parking', 'local', 'warehouse'
                )
                GROUP BY property_type
            ) c
        ),
        (SELECT count(*) FROM ops WHERE status = 'for_sale'),
        (SELECT count(*) FROM ops WHERE status = 'for_rent'),
        (
            SELECT coalesce(jsonb_object_agg(g.city, g.n), '{}'::jsonb)
            FROM (
                SELECT city, count(*) AS n
                FROM communes
                WHERE city IS NOT NULL AND city <> ''
                GROUP BY city
            ) g
        )
    INTO v_catalog, v_base_total, v_total, v_data, v_categories, v_for_sale, v_for_rent, v_communes;

    -- Los contadores de categoría siempre llevan las nueve claves de la UI.
    v_categories := jsonb_build_object(
        'all', v_base_total,
        'apartment', 0,
        'house', 0,
        'premium', 0,
        'parcel', 0,
        'office', 0,
        'land', 0,
        'parking', 0,
        'local', 0,
        'warehouse', 0
    ) || v_categories;

    RETURN jsonb_build_object(
        'data', v_data,
        'total', v_total,
        'catalog_size', v_catalog,
        'category_counts', v_categories,
        'operation_counts', jsonb_build_object('for_sale', v_for_sale, 'for_rent', v_for_rent),
        'commune_counts', v_communes
    );
END;
$$;

COMMENT ON FUNCTION public.search_properties_catalog(
    TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) IS
    'Buscador del portal: filtra, cuenta por categoría/operación/comuna y pagina en la base. Devuelve {data,total,catalog_size,category_counts,operation_counts,commune_counts}.';
