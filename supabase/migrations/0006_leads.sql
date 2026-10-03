-- ════════════════════════════════════════════════════════════════════════════
-- 0006 · Contactos de visitas interesadas (public.leads)
-- ════════════════════════════════════════════════════════════════════════════
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

-- ── RLS: cualquiera puede dejar sus datos, solo el equipo puede leerlos ──────
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
