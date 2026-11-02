-- ════════════════════════════════════════════════════════════════════════════
-- 0032 · Puente registro → alta y recordatorios del onboarding
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta acá el panel mostraba un pipeline único pero había dos caminos: el
-- registro de un socio (corredora, inmobiliaria o profesional independiente) se
-- evaluaba solo y moría en `Aceptada`, mientras que el alta de empresa tenía
-- propuesta, token, alta y panel. Un socio que entraba por el formulario público
-- nunca llegaba a tener panel sin que alguien lo creara a mano.
--
-- Ahora, cuando un registro queda aprobado, el sistema crea la solicitud de alta
-- equivalente en `kyb_applications` y guarda acá de dónde vino. La columna es la
-- que hace idempotente la conversión (un registro no puede generar dos altas) y
-- la que permite responder «¿de qué registro salió este cliente?».
--
-- `registration_kind` se amplía para aceptar al profesional independiente: sin
-- eso la base rechazaría la fila justo en el caso más común del registro.
--
-- Los recordatorios necesitan memoria: `reminders_sent` cuenta los avisos ya
-- enviados y `last_reminder_at` dice cuándo. Sin esas dos columnas el job diario
-- volvería a escribirle a la misma persona en cada corrida.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Profesional independiente como camino de registro ──────────────────────
ALTER TABLE public.kyb_applications
    DROP CONSTRAINT IF EXISTS kyb_applications_registration_kind_check;

ALTER TABLE public.kyb_applications
    ADD CONSTRAINT kyb_applications_registration_kind_check
    CHECK (
        registration_kind IS NULL
        OR registration_kind IN ('corredora', 'inmobiliaria', 'agente')
    );

-- ── Origen: el registro de «Publicar» que se convirtió en alta ─────────────
ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS solicitud_origen UUID
    REFERENCES public.solicitudes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.kyb_applications.solicitud_origen IS
    'Solicitud de «Publicar» de la que se creó esta alta. NULL en las altas directas.';

-- Una sola alta por registro: el índice único es la garantía de que un reintento
-- de la conversión —o dos peticiones simultáneas— no duplica la fila.
CREATE UNIQUE INDEX IF NOT EXISTS kyb_applications_solicitud_origen_idx
    ON public.kyb_applications (solicitud_origen)
    WHERE solicitud_origen IS NOT NULL;

-- ── Recordatorios ─────────────────────────────────────────────────────────
ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS reminders_sent INTEGER NOT NULL DEFAULT 0
    CHECK (reminders_sent >= 0);

ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;

COMMENT ON COLUMN public.kyb_applications.reminders_sent IS
    'Recordatorios enviados por el job de solicitudes detenidas.';
