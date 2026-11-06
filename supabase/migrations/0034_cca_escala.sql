-- ════════════════════════════════════════════════════════════════════════════
-- 0034 · El CCA en la escala de la mensualidad
-- ════════════════════════════════════════════════════════════════════════════
-- El %CCA de partida pasa de 100 a 8.333,33: deja el factor en 12.000 y cobra
-- **0,1 % de la cartera al año**, facturado mes a mes ($CCA = cartera ÷ 12.000).
-- Una cartera de $180 millones paga $15.000 al mes; con 100 pagaba $180.
--
-- El tope del ajuste sube de 1.000 a 50.000 (0,6 % anual), que es lo que el
-- equipo puede mover desde Planes. `cca_pct` era NUMERIC(6,2) —techo 9.999,99—,
-- así que el movimiento no podía guardar el %CCA real sin truncarlo: se ensancha
-- a NUMERIC(9,2) para que la columna acepte todo el rango que valida el código.
--
-- El %CCA guardado en Planes también se mueve: sin esto la producción sigue
-- cobrando con el 100 viejo, porque el código solo cambia el valor de partida.
-- Se toca **solo** si sigue en 100 —lo que dejó el último guardado— para no
-- pisar un ajuste elegido desde el panel. El resto de la fila (perfiles,
-- captación y versión) queda como está, y `normalizePlanPricing` lo acepta igual.
UPDATE public.plan_settings
SET value = jsonb_set(value, '{ccaPct}', '8333.33'::jsonb, true),
    updated_at = timezone('utc'::text, now())
WHERE key = 'planes'
  AND value->>'ccaPct' = '100';

ALTER TABLE public.partner_cca_ledger
    ALTER COLUMN cca_pct TYPE NUMERIC(9, 2);

COMMENT ON COLUMN public.partner_cca_ledger.cca_pct IS
    'Valor del %CCA aplicado, tomado de Planes al registrar el movimiento (rango 1 a 50.000).';
