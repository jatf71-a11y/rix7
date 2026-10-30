-- ════════════════════════════════════════════════════════════════════════════
-- 0030 · Precios de los planes por perfil de socio
-- ════════════════════════════════════════════════════════════════════════════
-- El precio dejó de ser un número en el código. El panel tiene una sección
-- **Planes** donde el equipo define, para cada perfil de socio (profesional
-- independiente, corredora, inmobiliaria), cuánto se cobra de alta inicial,
-- cuánto de mensualidad base y cuántos usuarios incluye. Eso es una decisión de
-- negocio: cambia sin un deploy.
--
-- **Una sola fila** (`key = 'planes'`) con la configuración en JSONB. No es una
-- tabla con una columna por precio porque la forma del dato cambia con el
-- producto —un perfil más, otro concepto de cobro— y eso no debería costar una
-- migración cada vez. La validación de rangos y de identificadores vive en
-- `lib/kyb/planPricing.ts` y se aplica al leer y al escribir, así que una fila
-- editada a mano en el SQL editor no puede dejar la pantalla rota ni cobrar un
-- precio absurdo.
--
-- Sin fila, el panel muestra los precios de partida de
-- `lib/kyb/planPricing.ts`: la ausencia de configuración no es un error.
--
-- RLS cerrada sin políticas, igual que el resto del flujo: solo `service_role`
-- lee y escribe, desde `/api/admin/planes` (que exige sesión de administrador).

CREATE TABLE IF NOT EXISTS public.plan_settings (
    key TEXT PRIMARY KEY,
    -- { version: 2, profiles: [{ profile, altaInicialClp, mensualBaseClp, usuariosIncluidos }] }
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.plan_settings ENABLE ROW LEVEL SECURITY;

-- Sin políticas no se ve ninguna fila (ni con `authenticated`): el acceso real
-- es por `service_role`, que no evalúa RLS. Se dejan los GRANT por coherencia
-- con las otras tablas del flujo, no porque habiliten lectura.
GRANT SELECT ON public.plan_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_settings TO service_role;

COMMENT ON TABLE public.plan_settings IS
    'Configuración de negocio del panel. Hoy: precios de los planes por perfil de socio.';
