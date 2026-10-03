-- ════════════════════════════════════════════════════════════════════════════
-- 0002 · Corredoras inscritas (public.partners), el helper de rol admin y su RLS
-- ════════════════════════════════════════════════════════════════════════════
-- **Esta migración va antes que `properties`** a propósito: `properties.partner_id`
-- tiene clave foránea contra esta tabla, así que en una base vacía el orden
-- inverso falla con «relation "public.partners" does not exist». El `schema.sql`
-- monolítico anterior tenía justamente ese defecto: no podía crear una base
-- desde cero, solo completar una vieja.
--
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

    -- Feed XML para agregadores (hallazgo #14): estado y hash del token.
    -- El token en claro NUNCA se guarda: solo su SHA-256, para que la lectura
    -- pública de esta tabla no filtre credenciales. Se muestra una vez al
    -- activar/regenerar desde /api/admin/partners/feed.
    feed_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    feed_token_hash TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS partners_sort_order_idx ON public.partners (sort_order, name);

-- El feed público resuelve la corredora por hash del token: consulta por
-- igualdad, así que el índice evita el escaneo en cada rastreo del agregador.
CREATE INDEX IF NOT EXISTS partners_feed_token_hash_idx
ON public.partners (feed_token_hash)
WHERE feed_token_hash IS NOT NULL;

-- ── El helper de rol que usan las políticas de escritura ─────────────────────
-- El rol vive en app_metadata, que solo el servidor puede escribir; el usuario
-- no puede ascenderse editando user_metadata.
CREATE OR REPLACE FUNCTION public.is_rix7_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ── RLS: lectura pública, escritura solo del equipo ──────────────────────────
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
