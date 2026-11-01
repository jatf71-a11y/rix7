-- ════════════════════════════════════════════════════════════════════════════
-- 0031 · Calificado, propuesta comercial, alta y cobranza de la suscripción
-- ════════════════════════════════════════════════════════════════════════════
-- El flujo de una solicitud pasa a tener dos etapas más de las que tenía:
--
--   Recibida → En_Evaluacion → Pendiente_Informacion → Aceptada → **Calificado**
--     → **Propuesta_Comercial** → (el candidato acepta) → **Alta**
--     → (alta hecha y plan pagado) → Operando
--
-- `En_Alta` **sí** cambia de nombre acá, al revés que en 0029: su etiqueta ya
-- decía «Alta» pero su significado era «calificada, esperando el plan». Con una
-- etapa «Alta» de verdad más adelante, dejar el identificador viejo habría
-- dejado dos cosas llamadas parecido haciendo cosas distintas. Las filas se
-- traducen en el mismo paso que los CHECK, así que no queda ningún `En_Alta`
-- suelto en la base.
--
-- Después del alta el cliente **no** pasa solo a `Operando`: primero elige plan
-- y paga. `Operando` es el cliente al día que puede publicar, y por eso la
-- cobranza es parte de esta migración y no de una pantalla aparte:
--
--   · `partner_billing` — un período por fila (YYYY-MM), con su vencimiento y
--     el pago cuando entra. La morosidad **no** se guarda como estado de cada
--     fila: se deriva de la fecha de vencimiento y de si hay pago, así una base
--     sin mantenimiento no acumula filas «vencidas» que nunca se actualizaron.
--   · `partners.moroso` — la marca que el equipo confirma a mano. Cuando está
--     en true, las publicaciones de ese socio **desaparecen de la vidriera
--     pública** (los dos RPC de abajo las filtran) y el panel del socio avisa.
--     No se borra nada: al regularizar, la marca se levanta y las fichas
--     vuelven solas, con su misma URL y su mismo historial.

-- ── 1. Estados nuevos en las dos tablas que comparten el vocabulario ────────
ALTER TABLE public.kyb_applications
    DROP CONSTRAINT IF EXISTS kyb_applications_status_check;

ALTER TABLE public.kyb_applications
    ADD CONSTRAINT kyb_applications_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada',
        'Calificado', 'Propuesta_Comercial', 'Alta', 'Operando', 'Rechazada'
    ]));

ALTER TABLE public.solicitudes
    DROP CONSTRAINT IF EXISTS solicitudes_status_check;

ALTER TABLE public.solicitudes
    ADD CONSTRAINT solicitudes_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada',
        'Calificado', 'Propuesta_Comercial', 'Alta', 'Operando', 'Rechazada'
    ]));

-- ── 2. El token de la propuesta comercial ──────────────────────────────────
-- El enlace que recibe el candidato para aceptar la propuesta usa el mismo
-- mecanismo que los otros dos (hash en la base, valor en claro solo en el
-- correo); lo único que cambia es el propósito.
ALTER TABLE public.kyb_applications
    DROP CONSTRAINT IF EXISTS kyb_applications_token_purpose_check;

ALTER TABLE public.kyb_applications
    ADD CONSTRAINT kyb_applications_token_purpose_check
    CHECK (token_purpose IS NULL OR token_purpose = ANY (ARRAY['answers', 'proposal', 'activation']));

-- ── 3. La propuesta enviada ────────────────────────────────────────────────
-- Plan propuesto, nota y la decisión del candidato, en un JSONB: es un dato de
-- la solicitud —como las respuestas de una ronda—, no una entidad que se
-- consulte por su cuenta. El historial de propuestas queda en el array, así
-- una renegociación no borra la anterior.
ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS proposal JSONB;

COMMENT ON COLUMN public.kyb_applications.proposal IS
    'Propuesta comercial vigente: {planId, amountClp, monthlyClp, note, sentAt, decidedAt, decision}. Un objeto por ronda; se conservan las anteriores.';

-- ── 3 bis. El socio que nace del alta ──────────────────────────────────────
-- Al activar el plan se crea la ficha en `partners`; hasta ahora esa relación se
-- perdía y el pipeline solo podía adivinar por correo a qué socio correspondía
-- cada alta. Es lo que permite que el pago de un socio mueva **su** solicitud a
-- `Operando` y que la cobranza sepa a quién le está cobrando.
ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES public.partners(id);

CREATE INDEX IF NOT EXISTS kyb_applications_partner_idx
    ON public.kyb_applications (partner_id)
    WHERE partner_id IS NOT NULL;

-- ── 4. Traducción de las filas que estaban en el vocabulario viejo ─────────
-- Primero los clientes ya activados (panel habilitado), que en 0029 quedaron en
-- `Operando`; después el resto, que estaba esperando el plan y ahora está
-- calificado. El orden importa solo para no pisar el primero con el segundo.
UPDATE public.kyb_applications
    SET status = 'Operando'
    WHERE status = 'En_Alta' AND panel_enabled = true;

UPDATE public.kyb_applications
    SET status = 'Calificado'
    WHERE status = 'En_Alta';

UPDATE public.solicitudes
    SET status = 'Calificado'
    WHERE status = 'En_Alta';

-- ── 5. Cobranza de la suscripción ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_billing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id TEXT NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    -- Período facturado, «YYYY-MM». La clave es el período y no un rango de
    -- fechas: el cobro es mensual y así un mismo mes no se puede facturar dos
    -- veces (el UNIQUE de abajo lo impide).
    period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

    amount_clp INTEGER NOT NULL CHECK (amount_clp >= 0),
    -- Vencimiento del período. De acá sale «vencido» sin guardar estado.
    due_date DATE NOT NULL,
    paid_at TIMESTAMPTZ,
    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT partner_billing_period_unique UNIQUE (partner_id, period)
);

CREATE INDEX IF NOT EXISTS partner_billing_partner_idx
    ON public.partner_billing (partner_id, period DESC);

-- La cobranza es información comercial del socio: la lee y la escribe solo el
-- equipo con clave de servicio, igual que `plan_settings`. RLS sin políticas:
-- los GRANT de `anon` y `authenticated` quedan por coherencia con el resto de
-- las tablas —una tabla nueva sin sus GRANT explícitos rompe la guardia de
-- `db-push`—, pero sin política no habilitan ninguna lectura. Lo único que
-- puede leer esta tabla es `service_role`, que no evalúa RLS.
ALTER TABLE public.partner_billing ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.partner_billing TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_billing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_billing TO service_role;

COMMENT ON TABLE public.partner_billing IS
    'Un período facturado por socio. La morosidad se deriva (vencimiento pasado sin paid_at) y la marca pública vive en partners.moroso.';

-- ── 6. La marca de morosidad del socio ─────────────────────────────────────
ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS moroso BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS moroso_desde TIMESTAMPTZ;

ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS moroso_nota TEXT;

COMMENT ON COLUMN public.partners.moroso IS
    'true = el equipo confirmó la morosidad: sus publicaciones no se muestran en el portal hasta que regularice.';

-- ── 7. La vidriera pública respeta la morosidad ────────────────────────────
-- El filtro va en los RPC y no en cada consulta: son las dos únicas puertas por
-- las que el catálogo de la base llega al portal (buscador y ficha), así que
-- una corredora morosa desaparece de todo lo público sin que ninguna pantalla
-- tenga que acordarse de preguntar. `partners.moroso` ya existe arriba.
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
        ST_Intersects(p.location::geometry, bbox)
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
        AND (
            p_partner_id IS NULL
            OR p_partner_id = ''
            OR p.partner_id = p_partner_id
        )
        -- 0031: la corredora morosa no aparece en el buscador. Sus fichas no se
        -- borran ni se despublican: quedan ocultas mientras dure la marca.
        AND NOT EXISTS (
            SELECT 1 FROM public.partners pt
            WHERE pt.id = p.partner_id AND pt.moroso
        )
    ORDER BY p.created_at DESC;
END;
$$;

-- La ficha individual también: un enlace compartido de una propiedad de un socio
-- moroso no puede seguir sirviendo la propiedad como si nada.
--
-- `get_properties_filtered` se pudo reemplazar con CREATE OR REPLACE porque su
-- firma no cambió; esta no: la versión viva de `get_property_by_id` salió de un
-- `0005` anterior a las columnas de video, así que su tipo de fila no coincide
-- con el de acá y Postgres responde 42P13 («cannot change return type»). Se
-- retira la firma vieja primero —una función, no datos— y se crea la nueva con
-- las columnas que el código espera.
DROP FUNCTION IF EXISTS public.get_property_by_id(text);

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
        p.video_url,
        p.video_poster,
        p.created_at
    FROM public.properties p
    WHERE p.id::TEXT = property_id
      AND NOT EXISTS (
          SELECT 1 FROM public.partners pt
          WHERE pt.id = p.partner_id AND pt.moroso
      )
    LIMIT 1;
END;
$$;
