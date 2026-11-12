-- ════════════════════════════════════════════════════════════════════════════
-- 0041 · Registro de acciones del equipo
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta acá, lo que hacía el equipo de Rix7 sobre la cuenta de un socio quedaba
-- solo en el estado final: una decisión en `kyb_decisions` o un usuario en
-- `partner_users`. Cuando la acción **quita** una protección —el caso de este
-- registro, el reset del segundo factor— no alcanza con el estado final: hay
-- que poder responder quién lo hizo, cuándo y sobre qué cuenta.
--
-- Esta tabla es un libro de acciones, no un estado:
--
-- - **action**: qué se hizo, con un nombre estable (`partner_mfa.reset`), para
--   poder filtrar sin depender de un texto libre.
-- - **actor_id / actor_email**: quién lo hizo, tomados de la sesión del admin.
--   Quedan nulos solo en el bypass local, donde no hay sesión que leer.
-- - **partner_id**: sobre qué socio. `SET NULL` al borrar la empresa para que el
--   registro no se lleve la acción por delante: lo que pasó, pasó.
-- - **target_email**: sobre qué cuenta, cuando la acción apunta a una persona
--   (un socio puede tener varias cuentas).
-- - **detail**: lo específico de cada acción, en JSON, sin columnas nuevas por
--   cada caso.
--
-- Se escribe solo desde el servidor con `service_role`; RLS cerrada sin
-- políticas, como el resto del flujo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    -- Nombre estable de la acción, en minúsculas y con punto: `partner_mfa.reset`.
    action TEXT NOT NULL,

    -- Quién la ejecutó. Nulos solo en el bypass de desarrollo.
    actor_id UUID,
    actor_email TEXT,

    -- Socio afectado. Sin `CASCADE`: borrar la empresa no borra su historial.
    partner_id TEXT REFERENCES public.partners(id) ON DELETE SET NULL,

    -- Cuenta afectada, cuando la acción es sobre una persona.
    target_email TEXT,

    detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- La ficha de un socio pregunta «¿qué le hizo el equipo a esta cuenta?».
CREATE INDEX IF NOT EXISTS admin_events_partner_idx
    ON public.admin_events (partner_id, created_at DESC);

-- Y la vista de conjunto pregunta «¿qué resets de 2FA hubo?».
CREATE INDEX IF NOT EXISTS admin_events_action_idx
    ON public.admin_events (action, created_at DESC);

ALTER TABLE public.admin_events ENABLE ROW LEVEL SECURITY;

-- Sin políticas no se lee ninguna fila, ni con `authenticated`: el acceso real es
-- por `service_role`, que no evalúa RLS. Los GRANT quedan por coherencia con las
-- otras tablas del flujo, no porque habiliten lectura.
GRANT SELECT ON public.admin_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_events TO service_role;

COMMENT ON TABLE public.admin_events IS
    'Libro de acciones del equipo de Rix7 sobre socios: quién, cuándo y sobre qué cuenta.';
COMMENT ON COLUMN public.admin_events.action IS
    'Nombre estable de la acción, por ejemplo partner_mfa.reset.';
