-- ════════════════════════════════════════════════════════════════════════════
-- 0026 · Onboarding de empresas (KYB) con estados
-- ════════════════════════════════════════════════════════════════════════════
-- Un registro de empresa pasa por cinco estados y cada uno deja rastro:
--
--   Recibida → En_Evaluacion → Pendiente_Informacion → En_Evaluacion → Aceptada → En_Alta
--
-- `kyb_applications` guarda la solicitud y su estado actual; `kyb_evaluations`,
-- cada corrida del motor con su puntaje y el detalle de las verificaciones; y
-- `kyb_information_requests`, las preguntas que se le hicieron a la empresa y
-- las respuestas que devolvió, que son la entrada de la re-evaluación.
--
-- Por qué tres tablas y no una con JSONB: el estado y el puntaje se consultan y
-- se ordenan en el panel; las corridas del motor son historial (interesa ver
-- cómo cambió una decisión, no solo la última) y las preguntas/respuestas tienen
-- su propio ciclo (se piden, se responden, se re-evalúa).
--
-- El token de acceso **nunca se guarda en claro**: la base retiene su SHA-256 y
-- el valor se muestra una sola vez, en el correo. Es el mismo criterio del feed
-- XML de las corredoras.
CREATE TABLE IF NOT EXISTS public.kyb_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Estado del flujo. Los valores son los del enunciado del producto, en
    -- PascalCase y con guion bajo, no los de `solicitudes` (que usa minúsculas):
    -- acá el nombre del estado también viaja en el correo y en la API.
    status TEXT NOT NULL DEFAULT 'Recibida'
        CHECK (status = ANY (ARRAY[
            'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada', 'En_Alta'
        ])),

    -- Identidad de la empresa.
    legal_name TEXT NOT NULL,
    rut TEXT NOT NULL,
    website TEXT,
    -- Dominio normalizado (sin protocolo ni `www`), derivado del sitio web.
    domain TEXT,
    email TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    consent BOOLEAN NOT NULL DEFAULT false,

    -- Datos operativos del registro de empresas (`/registro/corredora` e
    -- `/registro/inmobiliaria`). No entran al motor: la verificación mira la
    -- identidad y la reputación, no dónde trabaja la empresa. Se guardan para
    -- que el equipo los vea en el panel y no se pierdan al pasar el registro al
    -- flujo evaluado.
    coverage TEXT CHECK (coverage IS NULL OR coverage IN ('nacional', 'regional')),
    regions TEXT[] NOT NULL DEFAULT '{}',
    message TEXT,
    -- Camino por el que entró el registro. El alta directa por API no lo trae;
    -- el equipo lo usa para clasificar la ficha después (`partners.kind` queda
    -- sin definir a propósito hasta que alguien la revise).
    registration_kind TEXT CHECK (
        registration_kind IS NULL OR registration_kind IN ('corredora', 'inmobiliaria')
    ),
    contact_role TEXT,

    -- Resultado de la última evaluación. `score` es 0..100.
    score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),

    -- Plan elegido por la empresa al usar su token (ver `lib/kyb/plans.ts`).
    plan TEXT,
    -- true cuando el panel de /socio quedó habilitado (cuenta + corredora).
    panel_enabled BOOLEAN NOT NULL DEFAULT false,
    activated_at TIMESTAMPTZ,

    -- Token de un solo uso para responder preguntas o elegir plan. Se guarda el
    -- hash; el valor en claro solo viaja en el correo.
    token_hash TEXT,
    token_purpose TEXT CHECK (token_purpose IS NULL OR token_purpose = ANY (ARRAY['answers', 'activation'])),
    token_expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- El panel lista por fecha y filtra por estado; el alta pública busca
-- duplicados recientes por RUT y correo.
CREATE INDEX IF NOT EXISTS kyb_applications_created_at_idx
    ON public.kyb_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS kyb_applications_status_idx
    ON public.kyb_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS kyb_applications_rut_idx
    ON public.kyb_applications (rut, created_at DESC);
CREATE INDEX IF NOT EXISTS kyb_applications_email_idx
    ON public.kyb_applications (email, created_at DESC);

-- El token se resuelve por igualdad de hash al responder o al elegir plan.
CREATE UNIQUE INDEX IF NOT EXISTS kyb_applications_token_hash_idx
    ON public.kyb_applications (token_hash)
    WHERE token_hash IS NOT NULL;

-- ── Corridas del motor de evaluación ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyb_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.kyb_applications(id) ON DELETE CASCADE,

    -- Estado antes y después de esta corrida: es el historial de la solicitud
    -- sin una tabla de eventos aparte.
    status_before TEXT NOT NULL,
    status_after TEXT NOT NULL,

    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    -- Cada verificación: id, etiqueta, pass/warn/fail, detalle y peso.
    checks JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Motivos legibles de la decisión (por qué se pidió información, etc.).
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS kyb_evaluations_application_idx
    ON public.kyb_evaluations (application_id, created_at DESC);

-- ── Preguntas y respuestas de «Pendiente_Informacion» ───────────────────────
CREATE TABLE IF NOT EXISTS public.kyb_information_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.kyb_applications(id) ON DELETE CASCADE,

    -- [{"id":"domain_web","question":"..."}]
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{"id":"domain_web","answer":"..."}]
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,

    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    answered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kyb_information_requests_application_idx
    ON public.kyb_information_requests (application_id, requested_at DESC);

-- ── RLS: sin acceso público ─────────────────────────────────────────────────
-- La solicitud se crea y todo el flujo corre en el servidor con la clave de
-- servicio (el motor necesita leer y escribir estado, y la empresa no tiene
-- sesión: se identifica con el token del correo). Por eso no hay políticas para
-- `anon`: habilitar RLS sin políticas deja la tabla cerrada salvo service_role.
-- Los datos son de empresa (RUT, correo, reputación) y no pueden quedar
-- legibles con la clave pública.
ALTER TABLE public.kyb_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyb_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyb_information_requests ENABLE ROW LEVEL SECURITY;

-- ── Grants explícitos (regla de la 0019) ────────────────────────────────────
-- El privilegio de esquema va explícito, pero **sin políticas RLS no devuelve
-- nada**: `anon` recibe SELECT y aun así no puede leer una sola fila, porque la
-- tabla no tiene ninguna política de lectura. Se concede lo mismo que al resto
-- de las tablas para que una base nueva no dependa del auto-grant de Supabase.
GRANT SELECT ON public.kyb_applications TO anon;
GRANT SELECT ON public.kyb_evaluations TO anon;
GRANT SELECT ON public.kyb_information_requests TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_applications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_information_requests TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_applications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_evaluations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_information_requests TO service_role;
