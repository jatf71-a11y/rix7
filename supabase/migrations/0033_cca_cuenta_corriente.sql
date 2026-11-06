-- ════════════════════════════════════════════════════════════════════════════
-- 0033 · El CCA como cobro mensual: autorización en el alta y cuenta corriente
-- ════════════════════════════════════════════════════════════════════════════
-- El CCA dejó de ser una estimación de la propuesta y pasó a ser la suma de la
-- cartera del socio, en UF. Eso lo convierte en un **cargo mensual variable** y
-- trae dos obligaciones que hasta ahora no tenían dónde vivir:
--
-- 1. **Autorización.** El solicitante tiene que aprobar el concepto antes de que
--    se le cobre. Se guarda en la solicitud, en la etapa de `Alta`, junto con la
--    confirmación del plan: es la prueba de que aceptó que el monto dependa de
--    sus publicaciones y se facture con la mensualidad. Sin esta columna no hay
--    forma de distinguir un alta autorizada de una que simplemente se activó.
--
-- 2. **Cuenta corriente.** Cada vez que la cartera del socio cambia —o cambia el
--    `%CCA` en Planes— el monto mensual cambia. El socio recibe un correo con el
--    nuevo valor y su panel muestra el historial. La tabla guarda **cada
--    movimiento** con la cartera, la UF, el `%CCA` y el monto resultante: con eso
--    se puede explicar cualquier factura sin recalcular el pasado con datos de
--    hoy. No se guarda «el CCA actual»: se deriva de la cartera y del `%CCA`
--    vigente, y una cifra única quedaría vieja en cuanto cargue otra propiedad.
--
-- RLS cerrada sin políticas, igual que el resto del flujo: el socio la ve a
-- través de `/api/partner/cca` (con su sesión y su `partner_id`) y el equipo a
-- través del panel; las dos rutas usan `service_role` en el servidor. Un
-- `authenticated` que consulte la tabla directo no ve filas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Autorización del cobro del CCA ─────────────────────────────────────────
ALTER TABLE public.kyb_applications
    ADD COLUMN IF NOT EXISTS cca_authorized_at TIMESTAMPTZ;

COMMENT ON COLUMN public.kyb_applications.cca_authorized_at IS
    'Momento en que la empresa autorizó el cobro del CCA en la etapa de Alta. NULL si todavía no lo aprobó.';

-- ── Cuenta corriente del CCA ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_cca_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id TEXT NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,

    -- El monto que se factura ese mes por concepto de CCA, en pesos.
    amount_clp NUMERIC(14, 0) NOT NULL,
    -- Monto del movimiento anterior; NULL en el primero (la línea base del alta).
    previous_amount_clp NUMERIC(14, 0),

    -- La cuenta que produjo el monto, para poder explicarlo después.
    stock_clp NUMERIC(16, 2) NOT NULL, -- suma de la cartera del socio
    cca_uf NUMERIC(14, 2) NOT NULL, -- la cartera expresada en UF
    uf_clp NUMERIC(14, 2) NOT NULL, -- valor de la UF usado
    cca_pct NUMERIC(6, 2) NOT NULL, -- %CCA vigente en Planes

    -- Por qué cambió: el alta (línea base), la cartera o los precios de Planes.
    reason TEXT NOT NULL DEFAULT 'cartera'
        CHECK (reason IN ('alta', 'cartera', 'planes')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- El panel pide los últimos movimientos de **un** socio: el índice compuesto
-- evita recorrer el historial completo de todos.
CREATE INDEX IF NOT EXISTS partner_cca_ledger_partner_idx
    ON public.partner_cca_ledger (partner_id, created_at DESC);

ALTER TABLE public.partner_cca_ledger ENABLE ROW LEVEL SECURITY;

-- Sin políticas no se ve ninguna fila (ni con `authenticated`): el acceso real
-- es por `service_role`, que no evalúa RLS. Los GRANT quedan por coherencia con
-- las otras tablas del flujo, no porque habiliten lectura.
GRANT SELECT ON public.partner_cca_ledger TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_cca_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_cca_ledger TO service_role;

COMMENT ON TABLE public.partner_cca_ledger IS
    'Cuenta corriente del CCA: un movimiento por cada cambio del monto mensual de un socio.';
