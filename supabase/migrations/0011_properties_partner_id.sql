-- ════════════════════════════════════════════════════════════════════════════
-- 0011 · Convergencia: partner_id en bases creadas con el esquema anterior
-- ════════════════════════════════════════════════════════════════════════════
-- `CREATE TABLE IF NOT EXISTS` no toca la tabla si ya existe: una base creada con
-- una versión vieja queda sin las columnas nuevas aunque se apliquen todas las
-- migraciones. Este archivo existe para eso — es la versión numerada de
-- `supabase/migracion-partner-id.sql`— y en una base creada desde cero no hace
-- nada (la columna ya viene en 0003).
--
-- Regla de la casa: **toda ampliación de esquema se repite acá con ALTER**, de
-- forma idempotente, para que aplicar las migraciones deje la base al día sin
-- importar de qué versión venía. El cuerpo de los RPC no se repite: se recrean
-- con CREATE OR REPLACE en 0005 en cada aplicación.
--
-- Fase 3, 2.1 — atribución de propiedades a corredoras (feed XML, /empresas).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS partner_id TEXT REFERENCES public.partners(id);

CREATE INDEX IF NOT EXISTS idx_properties_partner
  ON public.properties (partner_id);
