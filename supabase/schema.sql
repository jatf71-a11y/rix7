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

-- ==============================================================================
-- 7. TABLA DE CORREDORAS INSCRITAS (PARTNERS)
-- ==============================================================================
-- Antes vivían en memoria (se reiniciaban con el servidor). Ahora son filas:
-- lo que se da de alta desde /admin/empresas queda guardado.
--
-- `id` es la clave que ya usan las propiedades (`partner_id`) y `slug` la que
-- arma las URLs de /empresas/<slug>. Se guardan por separado porque en el
-- catálogo no coinciden en todos los casos (Portal Inmobiliario tiene id
-- '.portal-inmobiliario' y slug 'portal-inmobiliario').
CREATE TABLE IF NOT EXISTS public.partners (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    logo TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    website TEXT,
    color TEXT NOT NULL DEFAULT '#3B82F6',

    -- Datos de contacto de la corredora: alimentan los botones Llamar /
    -- WhatsApp / Mail de la ficha. Se separa teléfono fijo de móvil porque
    -- `api.whatsapp.com` rechaza un número fijo.
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_whatsapp TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',

    -- Orden de aparición en el portal (el carrusel de socios y /admin)
    sort_order INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS partners_sort_order_idx ON public.partners (sort_order, name);

-- ==============================================================================
-- 7.b ROL DE ADMINISTRADOR: helper para las políticas
-- ==============================================================================
-- El rol vive en app_metadata, que solo el servidor puede escribir; el usuario
-- no puede ascenderse editando user_metadata.
CREATE OR REPLACE FUNCTION public.is_rix7_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ==============================================================================
-- 7.c RLS: lectura pública, escritura solo del equipo
-- ==============================================================================
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- Los logos y datos de contacto se muestran en el portal sin sesión.
DROP POLICY IF EXISTS "Lectura publica de corredoras" ON public.partners;
CREATE POLICY "Lectura publica de corredoras"
ON public.partners
FOR SELECT
USING (true);

-- Alta, edición y baja desde /admin/empresas, solo con rol admin.
DROP POLICY IF EXISTS "Escritura de corredoras solo para admin" ON public.partners;
CREATE POLICY "Escritura de corredoras solo para admin"
ON public.partners
FOR ALL
TO authenticated
USING (public.is_rix7_admin())
WITH CHECK (public.is_rix7_admin());

-- ==============================================================================
-- 8. TABLA DE CONTACTOS DE VISITAS INTERESADAS (LEADS)
-- ==============================================================================
-- Antes, cuando una visita dejaba sus datos y abría WhatsApp, ese contacto se
-- perdía: solo quedaba en el teléfono del usuario. Ahora se registra una fila
-- para que el equipo pueda consultarla y hacerle seguimiento.
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Qué propiedad y qué corredora generaron el interés. Son TEXT (no FK) para
    -- que el registro sobreviva aunque la propiedad se borre o el catálogo en
    -- memoria haya sido la fuente.
    property_id TEXT,
    partner_id TEXT,

    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,

    -- Canal por el que se interesó: el formulario o el botón que abrió
    -- ('form' | 'call' | 'whatsapp' | 'mail').
    channel TEXT NOT NULL DEFAULT 'form',
    message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_partner_idx ON public.leads (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_property_idx ON public.leads (property_id, created_at DESC);

-- ==============================================================================
-- 8.b RLS: cualquiera puede dejar sus datos, solo el equipo puede leerlos
-- ==============================================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- La visita no tiene cuenta, así que el alta es pública. La propia política
-- valida la forma del dato (longitudes y canal permitido) para que la tabla no
-- se convierta en un vertedero de basura si alguien llama a la API a mano.
DROP POLICY IF EXISTS "Alta publica de contactos" ON public.leads;
CREATE POLICY "Alta publica de contactos"
ON public.leads
FOR INSERT
TO anon, authenticated
WITH CHECK (
    length(trim(name)) BETWEEN 2 AND 120
    AND length(trim(email)) BETWEEN 5 AND 200
    AND length(trim(phone)) BETWEEN 6 AND 40
    AND channel = ANY (ARRAY['form', 'call', 'whatsapp', 'mail'])
);

-- Los contactos NO son públicos: solo el equipo los lee.
DROP POLICY IF EXISTS "Lectura de contactos solo para admin" ON public.leads;
CREATE POLICY "Lectura de contactos solo para admin"
ON public.leads
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- El equipo puede borrar duplicados o spam.
DROP POLICY IF EXISTS "Borrado de contactos solo para admin" ON public.leads;
CREATE POLICY "Borrado de contactos solo para admin"
ON public.leads
FOR DELETE
TO authenticated
USING (public.is_rix7_admin());

-- ==============================================================================
-- 9. BÚSQUEDAS GUARDADAS Y SUS ALERTAS
-- ==============================================================================
-- Le dan un propósito a la cuenta: la persona guarda una búsqueda y recibe un
-- correo cuando aparece una propiedad que encaja. Sin esto, "crear cuenta" solo
-- servía para publicar, que es cosa de las corredoras.
CREATE TABLE IF NOT EXISTS public.saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Filtros tal como los usa el buscador (`lib/data/propertyFilters`), para que
    -- el aviso coincida exactamente con lo que la persona vio al guardar.
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Etiqueta legible calculada al guardar ("Venta · Departamentos en Las Condes"),
    -- para el correo y la lista del usuario.
    label TEXT NOT NULL DEFAULT '',

    -- Permite silenciar un aviso sin borrar la búsqueda.
    notify BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Cuándo se avisó por última vez: define qué propiedades son "nuevas". Se
    -- deja en NULL al crear para que la primera corrida solo fije la línea base
    -- y no mande un correo con todo el catálogo.
    last_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS saved_searches_user_idx
    ON public.saved_searches (user_id, created_at DESC);

-- El job de alertas solo mira las que tienen aviso activo.
CREATE INDEX IF NOT EXISTS saved_searches_notify_idx
    ON public.saved_searches (notify)
    WHERE notify;

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

-- Cada persona administra únicamente las suyas. El job de alertas no pasa por
-- acá: usa la clave de servicio, que no está sujeta a RLS.
DROP POLICY IF EXISTS "Busquedas propias" ON public.saved_searches;
CREATE POLICY "Busquedas propias"
ON public.saved_searches
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- 10. FAVORITOS (public.favorites)
-- ==============================================================================
-- Los favoritos vivían en el navegador (`localStorage`), así que se quedaban en
-- ese dispositivo. Acá viven en la cuenta: siguen a la persona entre el celular
-- y el computador, y son la razón por la que conviene entrar.
--
-- `property_id` es TEXT y **no** tiene clave foránea, igual que en `leads`:
-- las propiedades del catálogo usan ids legibles ("scl-depto-marco-polo") que no
-- son UUID, así que una FK contra `properties(id)` los rechazaría.
CREATE TABLE IF NOT EXISTS public.favorites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- La misma propiedad no se puede guardar dos veces: si se aprieta dos veces
    -- el corazón, la segunda es inofensiva.
    PRIMARY KEY (user_id, property_id)
);

-- El listado siempre es "los míos, del más nuevo al más viejo".
CREATE INDEX IF NOT EXISTS favorites_user_idx
    ON public.favorites (user_id, created_at DESC);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Cada persona administra únicamente los suyos: ni lee ni escribe los de otro,
-- ni siquiera con la anon key. No hay política de lectura pública a propósito.
DROP POLICY IF EXISTS "Favoritos propios" ON public.favorites;
CREATE POLICY "Favoritos propios"
ON public.favorites
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- 11. APERTURAS DE ENLACES COMPARTIDOS (public.share_views)
-- ==============================================================================
-- La landing `/compartir/[id]` es lo que las corredoras mandan por WhatsApp, y
-- hasta ahora no había forma de saber si el enlace servía. Sumado a `leads`
-- (que ya guarda la corredora de cada contacto), esto permite responder la
-- pregunta que importa: **qué enlaces traen interesados**.
--
-- Decisión de diseño: se guarda un **contador agregado por propiedad y día**,
-- no una fila por visita. No hay IP, ni user agent, ni identificador de nadie:
-- el sistema cuenta enlaces abiertos, no personas. Con una fila por evento el
-- panel podría responder las mismas preguntas, pero además acumularía un
-- historial de quién abrió qué, que es exactamente lo que no hace falta.
--
-- `property_id` es TEXT y sin clave foránea, igual que en `leads` y `favorites`:
-- los ids del catálogo son legibles ("scl-depto-marco-polo"), no UUID.
CREATE TABLE IF NOT EXISTS public.share_views (
    property_id TEXT NOT NULL,

    -- Día UTC de las aperturas. Permite ver si el enlace funciona **ahora**, que
    -- es la pregunta real: un total histórico esconde que dejó de circular.
    day DATE NOT NULL DEFAULT (timezone('utc'::text, now()))::date,

    -- Corredora dueña de la propiedad, para poder agrupar el informe. Se guarda
    -- desnormalizado a propósito: si la propiedad cambia de corredora, las
    -- aperturas viejas siguen atribuidas a quien las generó.
    partner_id TEXT,

    views INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    PRIMARY KEY (property_id, day)
);

-- El informe agrupa por corredora en una ventana de tiempo.
CREATE INDEX IF NOT EXISTS share_views_partner_idx
    ON public.share_views (partner_id, day DESC);

ALTER TABLE public.share_views ENABLE ROW LEVEL SECURITY;

-- Nadie escribe la tabla directamente: el único camino es la función de abajo,
-- que solo suma de a uno. Sin política de INSERT/UPDATE, la anon key no puede
-- inventar filas ni fijar un contador arbitrario.
DROP POLICY IF EXISTS "Lectura de aperturas solo para admin" ON public.share_views;
CREATE POLICY "Lectura de aperturas solo para admin"
ON public.share_views
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- ------------------------------------------------------------------------------
-- RPC: suma una apertura de forma atómica.
-- ------------------------------------------------------------------------------
-- `SECURITY DEFINER` porque quien llama es la visita (sin sesión) y la tabla no
-- tiene política de escritura. La función no recibe un valor a sumar, solo el
-- nombre del enlace: no se puede usar para fijar el contador en el número que
-- uno quiera, y no devuelve nada que no fuera ya público.
--
-- Límite honesto: cualquiera puede invocarla repetidamente para inflar el
-- número de un enlace propio. El rate limit de la API route lo frena, pero un
-- contador público nunca es a prueba de manipulación; sirve para decidir qué
-- enlace conviene seguir usando, no para facturar.
CREATE OR REPLACE FUNCTION public.increment_share_view(
    p_property_id TEXT,
    p_partner_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.share_views (property_id, day, partner_id, views)
    VALUES (
        p_property_id,
        (timezone('utc'::text, now()))::date,
        p_partner_id,
        1
    )
    ON CONFLICT (property_id, day)
    DO UPDATE SET
        views = public.share_views.views + 1,
        -- Se completa si faltaba, pero no se pisa una atribución ya guardada.
        partner_id = COALESCE(public.share_views.partner_id, EXCLUDED.partner_id),
        updated_at = timezone('utc'::text, now());
$$;

GRANT EXECUTE ON FUNCTION public.increment_share_view(TEXT, TEXT) TO anon, authenticated;
