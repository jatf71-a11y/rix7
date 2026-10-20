-- ════════════════════════════════════════════════════════════════════════════
-- 0016 · Compartidos con identidad (public.share_events) y origen del contacto
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta acá había dos registros distintos y ninguno respondía esta pregunta:
-- **¿quién compartió qué enlace y por dónde?**
--
-- - `share_views` cuenta aperturas agregadas (una fila por propiedad y día),
--   sin ninguna identidad. Sirve para saber si el enlace circula, no quién lo
--   movió.
-- - `leads` guarda el contacto de quien se interesa, pero no distingue si nació
--   en la ficha o en la landing compartida.
--
-- Este archivo agrega las dos piezas que faltaban:
--
-- 1. `share_events`: una fila por acción de compartir (WhatsApp, copiar,
--    compartir nativo o tarjeta descargada) con la identidad que el portal ya
--    reconoce (nombre, correo y teléfono del registro del dispositivo o de la
--    cuenta del portal). Es el registro que el equipo consulta en
--    `/admin/landings`, y la razón de que el candado de registro tenga sentido:
--    compartir deja rastro de quién lo hizo.
-- 2. `leads.source`: el contacto dice desde qué superficie se dejó, para poder
--    separar «me interesó en la ficha» de «me llegó el enlace compartido».
--
-- Privacidad, con el mismo criterio que `leads`: el **alta es pública** porque
-- la visita no tiene cuenta (el registro vive en su dispositivo), pero la
-- **lectura y el borrado son solo del equipo** (`is_rix7_admin()`). La política
-- de inserción vuelve a validar la forma del dato, así que un POST manual
-- tampoco puede meter basura ni filas de un largo arbitrario.
--
-- No se guarda IP, ni user agent, ni coordenadas: solo lo que la persona ya
-- dejó en el portal para poder ser contactada.

-- ── 1. Origen del contacto ──────────────────────────────────────────────────
-- Default `ficha`: las filas viejas (y cualquier cliente anterior) siguen
-- significando lo mismo que antes. La columna es aditiva, sin backfill.
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ficha';

-- ── 2. Compartidos con identidad ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.share_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Igual que en `leads`: TEXT y sin FK, para que el registro sobreviva si la
    -- propiedad se borra o si vino del catálogo en memoria.
    property_id TEXT NOT NULL,
    partner_id TEXT,

    -- Qué hizo la persona: 'whatsapp' | 'copy' | 'share' | 'card'.
    channel TEXT NOT NULL,

    -- Desde dónde: 'ficha' (barra de la ficha), 'landing' (/compartir/[id]) o
    -- 'panel' (el socio que comparte desde /socio).
    source TEXT NOT NULL DEFAULT 'ficha',

    -- Identidad reconocida por el portal en el momento de compartir. No es una
    -- cuenta de Auth necesariamente: el registro del dispositivo también vale.
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,

    -- Enlace exacto que se compartió. Es la landing y permite auditar que lo
    -- que viajó fue el resumen y no una URL con datos sensibles.
    share_url TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- El panel lista los últimos compartidos y filtra por corredora/propiedad.
CREATE INDEX IF NOT EXISTS share_events_created_at_idx
    ON public.share_events (created_at DESC);
CREATE INDEX IF NOT EXISTS share_events_partner_idx
    ON public.share_events (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_events_property_idx
    ON public.share_events (property_id, created_at DESC);

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;

-- Alta pública: la visita no tiene cuenta. La política repite la validación de
-- `normalizeShareEvent` (largos, correo y canales permitidos) para que la tabla
-- no se convierta en un vertedero si alguien llama a la API a mano.
DROP POLICY IF EXISTS "Alta publica de compartidos" ON public.share_events;
CREATE POLICY "Alta publica de compartidos"
ON public.share_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
    length(trim(property_id)) BETWEEN 1 AND 120
    AND (partner_id IS NULL OR length(trim(partner_id)) BETWEEN 1 AND 120)
    AND length(trim(name)) BETWEEN 2 AND 120
    AND length(trim(email)) BETWEEN 5 AND 200
    AND email LIKE '%@%.%'
    AND (phone IS NULL OR length(trim(phone)) BETWEEN 6 AND 40)
    AND channel = ANY (ARRAY['whatsapp', 'copy', 'share', 'card'])
    AND source = ANY (ARRAY['ficha', 'landing', 'panel'])
    AND (
        share_url IS NULL
        OR (length(share_url) BETWEEN 10 AND 600 AND share_url LIKE 'http%')
    )
);

-- Quién compartió es un dato de personas: no es público, solo lo lee el equipo.
DROP POLICY IF EXISTS "Lectura de compartidos solo para admin" ON public.share_events;
CREATE POLICY "Lectura de compartidos solo para admin"
ON public.share_events
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- El equipo puede borrar spam o duplicados, igual que en `leads`.
DROP POLICY IF EXISTS "Borrado de compartidos solo para admin" ON public.share_events;
CREATE POLICY "Borrado de compartidos solo para admin"
ON public.share_events
FOR DELETE
TO authenticated
USING (public.is_rix7_admin());
