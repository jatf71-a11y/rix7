-- ════════════════════════════════════════════════════════════════════════════
-- 0018 · Solicitudes de publicación (public.solicitudes)
-- ════════════════════════════════════════════════════════════════════════════
-- El botón «Publicar» ahora abre tres caminos y todos terminan en una solicitud:
--
--   - `licitacion`   — un propietario sin corredora pide que corredoras
--                      verificadas compitan por publicar su propiedad.
--   - `corredora`    — una corredora pide su registro para publicar stock.
--   - `inmobiliaria` — una inmobiliaria/desarrolladora pide el suyo.
--
-- Una sola tabla y no tres: lo común —quién pide, cómo contactarlo, cuándo y en
-- qué estado— es idéntico, y los campos propios de cada registro todavía se
-- están definiendo. `payload` los guarda sin obligar a una migración por cada
-- campo nuevo; la API valida su forma antes de escribir y el panel lo muestra
-- como detalle. El día que un registro necesite columnas propias, se agregan
-- con un `ALTER` y se migra el payload.
CREATE TABLE IF NOT EXISTS public.solicitudes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Qué camino del botón «Publicar» originó la solicitud.
    kind TEXT NOT NULL CHECK (kind = ANY (ARRAY['licitacion', 'corredora', 'inmobiliaria'])),

    -- Datos de contacto de quien pide (persona, no empresa).
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,

    -- Empresa, solo en los registros de corredora/inmobiliaria.
    company TEXT,
    -- Mensaje libre de quien completa el formulario.
    message TEXT,

    -- Campos propios del tipo de solicitud, ya validados por la API:
    --   licitacion:   operation, property_type, region, commune, address (exacta),
    --                 expected_price, rol y message — todos obligatorios
    --   corredora/inmobiliaria: rut, role, region, commune, website
    -- Es JSONB para que el registro pueda crecer sin migrar la tabla.
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Constancia explícita de aceptación de la política de privacidad. Sin esto
    -- no se guarda una solicitud: es el mismo criterio que `signups`.
    consent BOOLEAN NOT NULL DEFAULT false,

    -- Ciclo de vida que usará el panel: recién llegada, en revisión, contactada
    -- y cerrada. Hoy el panel solo lista; el estado queda listo para el flujo de
    -- revisión.
    status TEXT NOT NULL DEFAULT 'nueva'
        CHECK (status = ANY (ARRAY['nueva', 'en_revision', 'contactada', 'cerrada'])),

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS solicitudes_created_at_idx
    ON public.solicitudes (created_at DESC);
CREATE INDEX IF NOT EXISTS solicitudes_kind_idx
    ON public.solicitudes (kind, created_at DESC);

-- ── RLS: cualquiera puede pedir, solo el equipo puede leer ──────────────────
ALTER TABLE public.solicitudes ENABLE ROW LEVEL SECURITY;

-- La solicitud es pública porque quien la envía todavía no tiene cuenta. La
-- política vuelve a validar la forma mínima para que la tabla no se convierta
-- en un vertedero si alguien llama a la API a mano.
DROP POLICY IF EXISTS "Alta publica de solicitudes" ON public.solicitudes;
CREATE POLICY "Alta publica de solicitudes"
ON public.solicitudes
FOR INSERT
TO anon, authenticated
WITH CHECK (
    kind = ANY (ARRAY['licitacion', 'corredora', 'inmobiliaria'])
    AND consent = true
    AND length(trim(name)) BETWEEN 2 AND 120
    AND length(trim(email)) BETWEEN 5 AND 200
    AND length(trim(phone)) BETWEEN 6 AND 40
    AND (company IS NULL OR length(trim(company)) BETWEEN 2 AND 160)
    AND (message IS NULL OR length(message) <= 1200)
    AND jsonb_typeof(payload) = 'object'
    -- Un payload absurdo no entra: los formularios son acotados y el panel no
    -- tiene que defenderse de un JSON de megabytes.
    AND pg_column_size(payload) < 8192
);

-- Las solicitudes tienen datos personales: no son públicas ni siquiera para
-- quien las envió (no hay sesión que lo identifique).
DROP POLICY IF EXISTS "Lectura de solicitudes solo para admin" ON public.solicitudes;
CREATE POLICY "Lectura de solicitudes solo para admin"
ON public.solicitudes
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- El equipo puede marcar el estado o borrar spam/duplicados.
DROP POLICY IF EXISTS "Actualizacion de solicitudes solo para admin" ON public.solicitudes;
CREATE POLICY "Actualizacion de solicitudes solo para admin"
ON public.solicitudes
FOR UPDATE
TO authenticated
USING (public.is_rix7_admin())
WITH CHECK (public.is_rix7_admin());

DROP POLICY IF EXISTS "Borrado de solicitudes solo para admin" ON public.solicitudes;
CREATE POLICY "Borrado de solicitudes solo para admin"
ON public.solicitudes
FOR DELETE
TO authenticated
USING (public.is_rix7_admin());
