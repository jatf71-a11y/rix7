-- ==============================================================================
-- 1. EXTENSIÓN POSTGIS PARA CONSULTAS GEOESPACIALES
-- ==============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==============================================================================
-- 2. TABLA PRINCIPAL: PROPERTIES (RIX7)7)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC(14, 2) NOT NULL, -- Soporte para valores en CLP
    property_type TEXT NOT NULL DEFAULT 'apartment', -- 'apartment' (Departamentos), 'house' (Casas), 'vip' (VIP), 'parcel' (Parcelas), 'office' (Oficinas), 'land' (Terrenos)
    status TEXT NOT NULL DEFAULT 'for_sale', -- 'for_sale' (Venta), 'for_rent' (Arriendo), 'sold' (Vendido)
    bedrooms INTEGER NOT NULL DEFAULT 1,
    bathrooms NUMERIC(3, 1) NOT NULL DEFAULT 1.0,
    area_sqm NUMERIC(10, 2) NOT NULL,
    parking_spots INTEGER NOT NULL DEFAULT 0,
    year_built INTEGER,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT DEFAULT 'Región Metropolitana',
    zip_code TEXT,
    images TEXT[] NOT NULL DEFAULT '{}',
    features TEXT[] NOT NULL DEFAULT '{}',
    -- Columna Geoespacial nativa PostGIS (Longitud, Latitud con SRID 4326 - WGS 84 estándar GPS/Web)
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    
    -- Datos del Agente de Contacto
    agent_name TEXT DEFAULT 'Camila Undurraga',
    agent_email TEXT DEFAULT 'camila.undurraga@rix7.cl',
    agent_phone TEXT DEFAULT '+56 9 8765 4321',
    agent_avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
    
    -- Auditoría
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. ÍNDICES ESPACIALES Y DE RENDIMIENTO
-- ==============================================================================
-- Índice espacial GiST fundamental para búsquedas de Bounding Box en tiempo real (<5ms)
CREATE INDEX IF NOT EXISTS idx_properties_location_gist 
ON public.properties USING GIST (location);

-- Índices B-Tree para acelerar filtros de atributos comunes
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_bedrooms ON public.properties (bedrooms);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON public.properties (property_type);
CREATE INDEX IF NOT EXISTS idx_properties_city ON public.properties (city);

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
    search_query TEXT DEFAULT NULL
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
        p.created_at
    FROM public.properties p
    WHERE p.id::TEXT = property_id
    LIMIT 1;
END;
$$;

-- ==============================================================================
-- 5. SEGURIDAD A NIVEL DE FILAS (ROW LEVEL SECURITY - RLS)
-- ==============================================================================
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Lectura pública para cualquier usuario
CREATE POLICY "Lectura publica de propiedades" 
ON public.properties 
FOR SELECT 
USING (true);

-- Creación permitida solo para usuarios autenticados
CREATE POLICY "Creacion permitida para usuarios autenticados" 
ON public.properties 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Actualización solo por el creador o administradores
CREATE POLICY "Actualizacion de propiedades del creador" 
ON public.properties 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Eliminación solo por el creador
CREATE POLICY "Eliminacion de propiedades del creador" 
ON public.properties 
FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);

-- ==============================================================================
-- 6. CONFIGURACIÓN DE SUPABASE STORAGE (BUCKET PARA FOTOS)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('properties-media', 'properties-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Acceso publico de lectura a imagenes"
ON storage.objects FOR SELECT
USING (bucket_id = 'properties-media');

CREATE POLICY "Subida de imagenes para autenticados"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'properties-media');
