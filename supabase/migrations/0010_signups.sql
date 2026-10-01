-- ════════════════════════════════════════════════════════════════════════════
-- 0010 · Registros de visitas y sus autorizaciones (public.signups)
-- ════════════════════════════════════════════════════════════════════════════
-- El alta del navbar (`RegistrationModal`) guarda la identidad en el dispositivo
-- (localStorage) y hasta ahora el consentimiento solo quedaba en una línea de
-- log, que se pierde en el próximo deploy: no había forma de responder quién
-- autorizó el envío de publicidad —ni la cesión a socios—, ni desde cuándo, ni de
-- probarlo después.
--
-- Cuatro decisiones que sostienen la auditoría:
--
-- 1. **Las cuatro autorizaciones son columnas booleanas NOT NULL**, no un JSONB.
--    La pregunta que hay que poder responder es «¿cuántas personas autorizaron la
--    cesión a socios?», y con columnas esa consulta se escribe sola. Además el
--    **no autorizar también se guarda**: una casilla vacía es un dato, no un hueco.
-- 2. **`consent_version` fija qué texto se aceptó.** Los textos viven en
--    `lib/utils/consents.ts` y cambian con el tiempo; sin la versión, una fila de
--    hace un año no prueba a qué se comprometió nadie.
-- 3. **La tabla es solo-anexa**: hay política de INSERT (público, porque quien se
--    registra no tiene cuenta) y de SELECT (equipo), y **ninguna de UPDATE**. Una
--    autorización no se reescribe; si alguien cambia de opinión, queda una fila
--    nueva y se ve **cuándo** lo hizo. El borrado sí existe para el equipo, y está
--    pensado para una solicitud de supresión de la propia persona, no para
--    «limpiar» registros incómodos.
-- 4. **No se guarda IP ni user agent**, igual que en `share_views`: el portal
--    registra quién autorizó qué, no desde dónde. Si una revisión legal pide más
--    evidencia, es una columna nueva y una decisión explícita.
CREATE TABLE IF NOT EXISTS public.signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,

    -- Las cuatro autorizaciones de `lib/utils/consents.ts`. Las obligatorias
    -- (datos personales y términos) llegan en true por construcción, porque la API
    -- rechaza el alta sin ellas; las opcionales se guardan tal como quedaron.
    consent_personal_data BOOLEAN NOT NULL,
    consent_terms BOOLEAN NOT NULL,
    consent_marketing BOOLEAN NOT NULL,
    consent_third_party BOOLEAN NOT NULL,

    -- Versión de los textos que se mostraron (constante CONSENT_VERSION).
    consent_version TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- El panel lista del más reciente al más antiguo.
CREATE INDEX IF NOT EXISTS signups_created_at_idx ON public.signups (created_at DESC);

-- «El estado vigente de esta persona»: la última fila de su correo. Como la tabla
-- es solo-anexa, el estado actual es la más nueva, no una fila actualizada.
CREATE INDEX IF NOT EXISTS signups_email_idx ON public.signups (email, created_at DESC);

-- La baja de publicidad se resuelve buscando a quién se le autorizó.
CREATE INDEX IF NOT EXISTS signups_marketing_idx
    ON public.signups (created_at DESC)
    WHERE consent_marketing;

ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;

-- La visita no tiene cuenta, así que el alta es pública. La propia política exige
-- el mínimo legal (base de licitud y términos aceptados) para que la tabla no
-- acepte un registro sin consentimiento ni llamando a la API a mano.
DROP POLICY IF EXISTS "Alta publica de registros" ON public.signups;
CREATE POLICY "Alta publica de registros"
ON public.signups
FOR INSERT
TO anon, authenticated
WITH CHECK (
    length(trim(name)) BETWEEN 2 AND 120
    AND length(trim(email)) BETWEEN 5 AND 200
    AND length(trim(phone)) BETWEEN 6 AND 40
    AND consent_personal_data
    AND consent_terms
    AND length(trim(consent_version)) > 0
);

-- Los registros NO son públicos: ni siquiera una persona ve los suyos por esta
-- vía (su identidad vive en su dispositivo). Solo el equipo, con rol admin.
DROP POLICY IF EXISTS "Lectura de registros solo para admin" ON public.signups;
CREATE POLICY "Lectura de registros solo para admin"
ON public.signups
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- Supresión a pedido de la persona. No hay política de UPDATE a propósito.
DROP POLICY IF EXISTS "Borrado de registros solo para admin" ON public.signups;
CREATE POLICY "Borrado de registros solo para admin"
ON public.signups
FOR DELETE
TO authenticated
USING (public.is_rix7_admin());
