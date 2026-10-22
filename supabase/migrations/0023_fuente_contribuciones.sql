-- ════════════════════════════════════════════════════════════════════════════
-- 0023 · De dónde salió el monto de contribuciones
-- ════════════════════════════════════════════════════════════════════════════
-- Desde el panel se puede consultar el monto real de contribuciones al SII con
-- el ROL de la propiedad (ver `lib/data/siiContribuciones.ts`). El número que
-- llega así no es lo mismo que el que escribe una corredora a mano: conviene
-- poder decir cuál es cuál y de cuándo es.
--
--   `property_taxes_source`     — 'sii' cuando lo trajo la consulta; NULL cuando
--                                 lo escribió una persona.
--   `property_taxes_checked_at` — cuándo se consultó (no cuándo se emitió la
--                                 cuota: eso lo dice el año del monto).
--
-- Son opcionales y no cambian ninguna ficha: `get_property_by_id` **no** las
-- devuelve, porque la ficha pública solo muestra el monto, sin metadatos
-- internos. La migración no toca datos ni la función del detalle.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS` y `COMMENT` se pueden repetir.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_taxes_source TEXT;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_taxes_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.properties.property_taxes_source IS
    'Origen del monto de contribuciones: ''sii'' = consultado en el SII con el
     ROL; NULL = ingresado a mano. No se publica en la ficha.';

COMMENT ON COLUMN public.properties.property_taxes_checked_at IS
    'Momento de la consulta al SII que produjo `property_taxes`. NULL si el monto
     se ingresó a mano. No se publica en la ficha.';
