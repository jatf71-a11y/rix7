-- ════════════════════════════════════════════════════════════════════════════
-- 0040 · Usuarios del socio
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta acá una empresa tenía **una** cuenta con acceso al panel: la que se creó
-- en el alta. Pero el plan que eligió incluye varios usuarios —1, 5 o 20 según
-- el plan— y no había dónde anotarlos. El socio no podía sumar a su equipo y el
-- equipo de Rix7 no sabía cuántas cuentas colgaban de cada empresa.
--
-- Esta tabla es la lista de usuarios **de la empresa**, no la lista de cuentas
-- de Supabase: la cuenta vive en `auth.users` y se vincula por
-- `app_metadata.partner_id`. Acá queda lo que el socio administra y lo que el
-- tope del plan tiene que poder contar:
--
-- - **correo** normalizado en minúsculas, uno por empresa (`UNIQUE`): invitar
--   dos veces a la misma persona es un error de la pantalla, no una fila más.
-- - **rol**: quién administra la cuenta (suma y da de baja usuarios) y quién
--   solo publica. Es un rol *dentro de la empresa*; el rol de plataforma sigue
--   siendo `member` en `app_metadata` y no se toca desde acá.
-- - **estado**: una invitación no es un usuario activo. `revocado` deja la fila
--   —el historial de quién tuvo acceso y cuándo— pero libera el cupo del plan.
--
-- El **titular** (el correo del alta) no se guarda acá: es `kyb_applications.email`
-- y la pantalla lo muestra aparte, porque no se puede revocar sin cambiar de
-- dueña la cuenta.
--
-- RLS cerrada sin políticas, como el resto del flujo: el socio la lee y la
-- escribe a través de `/api/partner/users` (con su sesión y su `partner_id`) y
-- esa ruta usa `service_role` en el servidor. Un `authenticated` que consulte la
-- tabla directo no ve filas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.partner_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id TEXT NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    -- Correo normalizado (minúsculas, sin espacios) al momento de invitar.
    email TEXT NOT NULL,

    -- Rol dentro de la empresa: administra la cuenta o solo publica.
    role TEXT NOT NULL DEFAULT 'editor'
        CHECK (role IN ('admin', 'editor')),

    -- `invitado` = se mandó el correo y todavía no entró.
    status TEXT NOT NULL DEFAULT 'invitado'
        CHECK (status IN ('invitado', 'activo', 'revocado')),

    invited_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Primera entrada efectiva al panel (se completa cuando la cuenta entra).
    joined_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    -- Quién hizo la invitación, para poder explicar un acceso después.
    invited_by TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Un correo, una vez por empresa. El índice es único por (partner_id, email)
-- y no global: la misma persona puede trabajar en dos corredoras.
CREATE UNIQUE INDEX IF NOT EXISTS partner_users_partner_email_idx
    ON public.partner_users (partner_id, lower(email));

-- La pantalla lista los usuarios de **un** socio, y el tope del plan cuenta los
-- que no están revocados: el índice compuesto resuelve las dos consultas.
CREATE INDEX IF NOT EXISTS partner_users_partner_status_idx
    ON public.partner_users (partner_id, status, created_at);

ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;

-- Sin políticas no se ve ninguna fila (ni con `authenticated`): el acceso real
-- es por `service_role`, que no evalúa RLS. Los GRANT quedan por coherencia con
-- las otras tablas del flujo, no porque habiliten lectura.
GRANT SELECT ON public.partner_users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_users TO service_role;

COMMENT ON TABLE public.partner_users IS
    'Usuarios de la cuenta de un socio: quiénes entran al panel de la empresa y con qué rol.';
COMMENT ON COLUMN public.partner_users.status IS
    'invitado = todavía no entró; activo = con acceso; revocado = sin acceso y libera cupo del plan.';
