-- ════════════════════════════════════════════════════════════════════════════
-- 0024 · Tipo de socio: corredora, inmobiliaria o agente
-- ════════════════════════════════════════════════════════════════════════════
-- El panel tenía una sola lista de «Empresas / Socios» sin categorías. Un socio
-- del portal es una de tres cosas, y la diferencia no es cosmética: una
-- corredora y una inmobiliaria son empresas (razón social, RUT, cargo de quien
-- responde), mientras que un agente opera por cuenta propia y emite boleta de
-- honorarios. El panel ahora separa las tres y el alta exige elegir una.
--
-- `kind` queda **nullable** a propósito: las fichas históricas que no son
-- ninguno de los tres —los portales inmobiliarios del catálogo— no se
-- reclasifican a la fuerza. El panel las muestra como «Sin clasificar» y se
-- pueden categorizar a mano si alguna vez corresponde.
--
-- Los ids que se clasifican acá son los del catálogo (`lib/data/partners.ts` y
-- `supabase/seed.sql`). `WHERE kind IS NULL` hace la migración idempotente y no
-- pisa una categoría que el equipo ya haya cambiado desde el panel.

ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS kind TEXT;

-- Postgres no permite modificar un CHECK: se elimina y se crea otro.
ALTER TABLE public.partners DROP CONSTRAINT IF EXISTS partners_kind_check;
ALTER TABLE public.partners ADD CONSTRAINT partners_kind_check
    CHECK (kind IS NULL OR kind = ANY (ARRAY['corredora', 'inmobiliaria', 'agente']));

-- El panel filtra por categoría y ordena por `sort_order`; el índice sirve a
-- ese listado y no cambia ninguna lectura existente.
CREATE INDEX IF NOT EXISTS partners_kind_idx
    ON public.partners (kind, sort_order, name);

-- Corredoras: brókers de propiedades.
UPDATE public.partners SET kind = 'corredora'
    WHERE kind IS NULL AND id IN ('catedral', 'inelbrok');

-- Inmobiliarias: consultoras y desarrolladoras con empresa detrás.
UPDATE public.partners SET kind = 'inmobiliaria'
    WHERE kind IS NULL AND id IN (
        'cushman-wakefield', 'cbre', 'colliers', 'jll-chile', 'savills', 'torre-blanca'
    );
