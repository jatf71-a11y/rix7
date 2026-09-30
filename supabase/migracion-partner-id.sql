-- ==============================================================================
-- MIGRACIÓN: partner_id en properties (plan fase 3, ítem 2.1)
-- ==============================================================================
-- Ejecutar en Supabase SQL Editor. Idempotente: puede re-ejecutarse sin daño.
-- ¿Por qué un bloque aparte? CREATE TABLE IF NOT EXISTS no toca la tabla si ya
-- existe: una base creada con el esquema viejo queda sin la columna aunque se
-- re-ejecute el schema.sql completo. Los RPC sí se re-crean con su CREATE OR
-- REPLACE, y ahí vive el nuevo filtro por corredora (p_partner_id).

-- -----------------------------------------------------------------------------
-- 1) Columna + índice (lo único destructivo-imposible: no borra nada)
-- -----------------------------------------------------------------------------

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES public.partners(id);

CREATE INDEX IF NOT EXISTS idx_properties_partner
  ON public.properties (partner_id);

-- -----------------------------------------------------------------------------
-- 2) RPCs actualizados (copiados del schema.sql, secciones 4 y 4.b)
-- -----------------------------------------------------------------------------

-- ==============================================================================
-- 4. FUNCIÓN ALMACENADA RPC: get_properties_filtered
-- Permite filtrar por Bounding Box (coordenadas del viewport del mapa) y atributos
-- ==============================================================================
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

-- ==============================================================================
-- 4.b FUNCIÓN ALMACENADA RPC: get_property_by_id
-- Detalle de una propiedad individual por ID (usada por /api/properties/[id])
-- ==============================================================================
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
        p.created_at
    FROM public.properties p
    WHERE p.id::TEXT = property_id
    LIMIT 1;
END;
$$;
