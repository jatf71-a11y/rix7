-- ════════════════════════════════════════════════════════════════════════════
-- 0027 · Rechazo y decisiones del equipo en el alta de empresas
-- ════════════════════════════════════════════════════════════════════════════
-- Dos cambios que van juntos:
--
--   1. `Rechazada` entra al CHECK de `kyb_applications.status`. Es el estado
--      terminal negativo: el alta no prosperó y no se vuelve a evaluar. Sin él,
--      una empresa con fraude comprobado quedaba en «Pendiente_Informacion»
--      para siempre, pidiéndole datos que no iban a cambiar nada.
--
--   2. `kyb_decisions` guarda **quién** decidió, **cuándo**, con qué nota y
--      sobre qué estado. La decisión es del equipo, no del motor, así que tiene
--      que quedar con nombre: «quedó rechazada» sin autor no sirve para
--      reclamar ni para auditar, y el historial del motor (`kyb_evaluations`)
--      no puede contar esa historia porque no hubo corrida.
--
-- Las preguntas de una decisión «Pendiente_Informacion» tomada a mano también
-- se guardan acá: son parte de lo que se le pidió a la empresa, y
-- `kyb_information_requests` guarda la ronda que la empresa puede responder.

-- ── 1. Rechazada en el estado de la solicitud ───────────────────────────────
-- Se recrea la restricción con el nombre que le dio Postgres al crearla, para
-- que la migración sea idempotente si alguna vez se vuelve a correr.
ALTER TABLE public.kyb_applications
    DROP CONSTRAINT IF EXISTS kyb_applications_status_check;

ALTER TABLE public.kyb_applications
    ADD CONSTRAINT kyb_applications_status_check
    CHECK (status = ANY (ARRAY[
        'Recibida', 'En_Evaluacion', 'Pendiente_Informacion', 'Aceptada', 'En_Alta', 'Rechazada'
    ]));

-- ── 2. Decisiones del equipo ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyb_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.kyb_applications(id) ON DELETE CASCADE,

    -- Las tres decisiones que puede tomar una persona. `En_Evaluacion` no es
    -- una decisión: es un paso del motor.
    decision TEXT NOT NULL
        CHECK (decision = ANY (ARRAY['Aceptada', 'Pendiente_Informacion', 'Rechazada'])),

    -- Estado desde el que se decidió y en el que quedó la solicitud. Se guardan
    -- los dos porque el flujo puede haber cambiado la solicitud entre la
    -- lectura y la escritura, y el historial tiene que poder reconstruirse.
    status_before TEXT NOT NULL,
    status_after TEXT NOT NULL,

    -- Motivo del rechazo o comentario de la aprobación. Obligatorio al rechazar
    -- (lo exige la API), opcional en el resto.
    note TEXT,

    -- Preguntas enviadas cuando la decisión es «Pendiente_Informacion»:
    -- [{"id":"domain_web","question":"..."}]
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Quién decidió: correo de la cuenta de administración (o `dev` sin
    -- Supabase). Es texto y no una FK a `auth.users` a propósito: la decisión
    -- tiene que seguir siendo legible si esa cuenta se borra.
    decided_by TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS kyb_decisions_application_idx
    ON public.kyb_decisions (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kyb_decisions_created_at_idx
    ON public.kyb_decisions (created_at DESC);

-- ── RLS: cerrada salvo service_role, igual que el resto del flujo ───────────
ALTER TABLE public.kyb_decisions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.kyb_decisions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyb_decisions TO service_role;
