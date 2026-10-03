-- ════════════════════════════════════════════════════════════════════════════
-- 0003 · Tabla principal del catálogo (public.properties) y sus índices
-- ════════════════════════════════════════════════════════════════════════════
-- Depende de 0002: `partner_id` referencia `public.partners`.
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

    -- Corredora dueña de la propiedad (hallazgo #14 / plan fase 3, 2.1): alimenta
    -- el feed XML por corredora y /empresas/<slug>. Los valores son `partners.id`
    -- (el mismo `partner_id` del catálogo del código); los leads ya lo guardaban.
    -- NULL = propiedad del portal, sin corredora asignada.
    partner_id TEXT REFERENCES public.partners(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índice espacial GiST fundamental para búsquedas de Bounding Box en tiempo real (<5ms)
CREATE INDEX IF NOT EXISTS idx_properties_location_gist
ON public.properties USING GIST (location);

-- Índices B-Tree para acelerar filtros de atributos comunes
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_bedrooms ON public.properties (bedrooms);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON public.properties (property_type);
CREATE INDEX IF NOT EXISTS idx_properties_city ON public.properties (city);

-- Atribución por corredora: el feed público consulta por igualdad en cada
-- rastreo del agregador y /empresas/<slug> pide las de una sola corredora.
CREATE INDEX IF NOT EXISTS idx_properties_partner ON public.properties (partner_id);
