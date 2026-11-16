-- ════════════════════════════════════════════════════════════════════════════
-- 0042 · Registro de correos enviados
-- ════════════════════════════════════════════════════════════════════════════
-- Los correos son la única puerta de entrada de un socio: la invitación a su
-- cuenta, el enlace de su panel, el reset del segundo factor, la propuesta y el
-- plan. Cuando uno no llega, hoy la única forma de investigarlo es entrar a
-- Resend o leer los logs del despliegue, y ninguna de las dos dice qué plantilla
-- se intentó mandar ni por qué falló.
--
-- Esta tabla es un **libro de envíos**, no un estado del correo:
--
-- - **status**: `sent` (Resend lo aceptó), `failed` (lo rechazó o hubo error de
--   red) o `skipped` (faltaba configuración y no se intentó). El tercero es
--   deliberado: en este proyecto un envío que no ocurrió no se anota como
--   enviado.
-- - **template**: nombre estable de la plantilla (`panel_link`, `mfa_reset`…),
--   para poder responder «¿qué correos de reset salieron este mes?».
-- - **error**: el motivo cuando no salió, recortado: es un diagnóstico, no un
--   volcado de la respuesta de Resend.
--
-- Se escribe **solo desde el servidor** (el mismo `sendEmail` de todo el
-- proyecto) y la RLS queda cerrada sin políticas, como `admin_events`: se lee
-- con `service_role` desde el panel del equipo.
--
-- Nunca guarda el cuerpo del correo: el cuerpo lleva enlaces de un solo uso.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Destinatario tal como se pidió. No se normaliza: si el error fue el correo,
    -- hay que ver exactamente cuál se usó.
    to_email TEXT NOT NULL,

    subject TEXT NOT NULL,

    -- Plantilla que lo generó; nula en los correos armados a mano.
    template TEXT,

    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),

    -- Motivo del fallo o del salto, recortado a 500 caracteres.
    error TEXT,

    -- Id del buzón local cuando `DEV_EMAIL_OUTBOX=1`.
    outbox_id TEXT
);

-- El panel pregunta «¿qué salió últimamente?» y «¿qué pasó con este socio?».
CREATE INDEX IF NOT EXISTS email_log_created_idx
    ON public.email_log (created_at DESC);

CREATE INDEX IF NOT EXISTS email_log_to_idx
    ON public.email_log (to_email, created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Sin políticas no se lee ninguna fila, ni con `authenticated`.
GRANT SELECT ON public.email_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_log TO service_role;

COMMENT ON TABLE public.email_log IS
    'Libro de correos salientes: plantilla, destinatario y resultado. Nunca guarda el cuerpo.';
COMMENT ON COLUMN public.email_log.status IS
    'sent = Resend lo aceptó · failed = lo rechazó o hubo error · skipped = no se intentó (falta configuración).';
