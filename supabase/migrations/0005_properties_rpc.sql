-- ════════════════════════════════════════════════════════════════════════════
-- 0005 · RPC del catálogo: get_properties_filtered y get_property_by_id
-- ════════════════════════════════════════════════════════════════════════════
-- Se re-crean con CREATE OR REPLACE en cada aplicación, así que una base vieja
-- recibe siempre la última versión del filtro —incluido `p_partner_id`— sin
-- necesidad de borrar nada. Por eso la migración 0011 no repite el cuerpo.
--
-- **Excepción, y es importante:** `CREATE OR REPLACE` reemplaza la función solo
-- si la lista de argumentos es idéntica. Cuando una base nació con la firma
-- vieja (sin `p_partner_id`), en vez de reemplazarla queda **una sobrecarga**:
-- dos `get_properties_filtered` candidatas. PostgREST entonces no sabe cuál
-- elegir y responde `PGRST203` (HTTP 300) a toda llamada que no fije los diez
-- argumentos —que es exactamente como la llama el portal (`min_lng`, `min_lat`,
-- `max_lng`, `max_lat`)—: el buscador cae en silencio al catálogo del código y
-- la base parece vacía. Pasó de verdad al recuperar la base el 2026-10-14.
--
-- Por eso se retira primero la firma vieja. Es un `DROP FUNCTION` de una función
-- obsoleta, no de datos: la regla 3 de LEEME.md prohíbe borrar tablas, columnas
-- y filas, y esto no es ninguna de las tres. En una base al día no hace nada.
DROP FUNCTION IF EXISTS public.get_properties_filtered(
    DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
    NUMERIC, NUMERIC, INTEGER, TEXT, TEXT
);

--
-- Permite filtrar por Bounding Box (coordenadas del viewport del mapa) y atributos
CREATE OR REPLACE FUNCTION public.get_properties_filtered(
    min_lng DOUBLE PRECISION,
    min_lat DOUBLE PRECISION,
    max_lng DOUBLE PRECISION,
    max_lat DOUBLE PRECISION,
    min_price NUMERIC DEFAULT NULL,
    max_price NUMERIC DEFAULT NULL,
    min_bedrooms INTEGER DEFAULT NULL,
    prop_type TEXT DEFAULT NULL,
    search_query TEXT DEFAULT NULL,
    p_partner_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    price NUMERIC,
    property_type TEXT,
    status TEXT,
    bedrooms INTEGER,
    bathrooms NUMERIC,
    area_sqm NUMERIC,
    parking_spots INTEGER,
    year_built INTEGER,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    images TEXT[],
    features TEXT[],
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    agent_name TEXT,
    agent_email TEXT,
    agent_phone TEXT,
    agent_avatar TEXT,
    partner_id TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    bbox GEOMETRY;
BEGIN
    -- Crea el polígono envolvente (Bounding Box) a partir de las esquinas del mapa
    bbox := ST_SetSRID(
        ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat),
        4326
    );

    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        p.price,
        p.property_type,
        p.status,
        p.bedrooms,
        p.bathrooms,
        p.area_sqm,
        p.parking_spots,
        p.year_built,
        p.address,
        p.city,
        p.state,
        p.zip_code,
        p.images,
        p.features,
        ST_Y(p.location::geometry) AS lat,
        ST_X(p.location::geometry) AS lng,
        p.agent_name,
        p.agent_email,
        p.agent_phone,
        p.agent_avatar,
        p.partner_id,
        p.created_at
    FROM public.properties p
    WHERE
        -- Filtro espacial: el punto está contenido o intersecta con el Bounding Box
        ST_Intersects(p.location::geometry, bbox)
        -- Filtros opcionales de negocio
        AND (min_price IS NULL OR p.price >= min_price)
        AND (max_price IS NULL OR p.price <= max_price)
        AND (min_bedrooms IS NULL OR p.bedrooms >= min_bedrooms)
        AND (prop_type IS NULL OR prop_type = '' OR prop_type = 'all' OR p.property_type = prop_type)
        AND (
            search_query IS NULL
            OR search_query = ''
            OR p.title ILIKE '%' || search_query || '%'
            OR p.city ILIKE '%' || search_query || '%'
            OR p.address ILIKE '%' || search_query || '%'
        )
        -- Corredora: NULL/'' = todas (compatibilidad con callers que no envían
        -- el parámetro; la convención p_* evita chocar con la columna de la
        -- tabla, igual que en record_share_view).
        AND (
            p_partner_id IS NULL
            OR p_partner_id = ''
            OR p.partner_id = p_partner_id
        )
    ORDER BY p.created_at DESC;
END;
$$;

-- ── Detalle de una propiedad individual por ID (usada por /api/properties/[id]) ──
CREATE OR REPLACE FUNCTION public.get_property_by_id(
    property_id TEXT
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    price NUMERIC,
    property_type TEXT,
    status TEXT,
    bedrooms INTEGER,
    bathrooms NUMERIC,
    area_sqm NUMERIC,
    parking_spots INTEGER,
    year_built INTEGER,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    images TEXT[],
    features TEXT[],
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    agent_name TEXT,
    agent_email TEXT,
    agent_phone TEXT,
    agent_avatar TEXT,
    partner_id TEXT,
    video_url TEXT,
    video_poster TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        p.price,
        p.property_type,
        p.status,
        p.bedrooms,
        p.bathrooms,
        p.area_sqm,
        p.parking_spots,
        p.year_built,
        p.address,
        p.city,
        p.state,
        p.zip_code,
        p.images,
        p.features,
        ST_Y(p.location::geometry) AS lat,
        ST_X(p.location::geometry) AS lng,
        p.agent_name,
        p.agent_email,
        p.agent_phone,
        p.agent_avatar,
        p.partner_id,
        -- 0015: el video de la ficha. El ROL va a propósito AUSENTE: es
        -- identificación interna y este RPC es la puerta pública al detalle.
        p.video_url,
        p.video_poster,
        p.created_at
    FROM public.properties p
    WHERE p.id::TEXT = property_id
    LIMIT 1;
END;
$$;
