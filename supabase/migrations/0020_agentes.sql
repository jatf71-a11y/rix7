-- ════════════════════════════════════════════════════════════════════════════
-- 0020 · Agentes independientes (cuarto camino de «Publicar»)
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta ahora «Publicar» tenía tres caminos y los tres terminaban en una
-- solicitud: licitación de propietario, registro de corredora y registro de
-- inmobiliaria. Falta uno real: el **agente**, un corredor que opera por cuenta
-- propia, sin empresa detrás.
--
-- La diferencia no es de marketing: cambia qué se le puede pedir. A una empresa
-- se le pide razón social, RUT de empresa y cargo de quien responde; a un agente
-- ninguno de los tres aplica — no factura, emite **boleta de honorarios** con su
-- RUT de persona natural—, así que su registro deja `company` en `null` y no
-- hay «cargo» que declarar. Lo que sí comparte con las empresas es que su cuenta
-- queda vinculada a un stock propio en `/socio`, que es lo que hace agente al
-- agente.
--
-- Dos lugares nombran los caminos y hay que moverlos **juntos**, o la API
-- aceptaría un `kind` que la tabla rechaza — o la tabla aceptaría uno que la API
-- devuelve como inválido:
--
--   · `solicitudes_kind_check` — el CHECK de la columna.
--   · La política de INSERT — que vuelve a validar el tipo en el servidor.
--
-- Postgres no permite modificar un CHECK existente: se elimina y se crea otro.
-- El nombre es el que Postgres asigna al CHECK declarado en línea en `0018`
-- (`solicitudes_kind_check`), verificado contra la base real.

-- ── CHECK del tipo de solicitud ────────────────────────────────────────────
-- Idempotente por DROP IF EXISTS: re-ejecutar este archivo no falla.
ALTER TABLE public.solicitudes DROP CONSTRAINT IF EXISTS solicitudes_kind_check;
ALTER TABLE public.solicitudes ADD CONSTRAINT solicitudes_kind_check
    CHECK (kind = ANY (ARRAY['licitacion', 'corredora', 'inmobiliaria', 'agente']));

-- ── RLS: el alta pública, ahora con el cuarto camino ───────────────────────
-- Es la misma política de `0018` con el `kind` ampliado: la forma mínima que
-- vuelve a validar la tabla para que no se convierta en un vertedero. Se
-- elimina y se recrea, que es la única forma de cambiar una política.
DROP POLICY IF EXISTS "Alta publica de solicitudes" ON public.solicitudes;
CREATE POLICY "Alta publica de solicitudes"
ON public.solicitudes
FOR INSERT
TO anon, authenticated
WITH CHECK (
    kind = ANY (ARRAY['licitacion', 'corredora', 'inmobiliaria', 'agente'])
    AND consent = true
    AND length(trim(name)) BETWEEN 2 AND 120
    AND length(trim(email)) BETWEEN 5 AND 200
    AND length(trim(phone)) BETWEEN 6 AND 40
    AND (company IS NULL OR length(trim(company)) BETWEEN 2 AND 160)
    AND (message IS NULL OR length(message) <= 1200)
    AND jsonb_typeof(payload) = 'object'
    -- Un payload absurdo no entra: los formularios son acotados y el panel no
    -- tiene que defenderse de un JSON de megabytes.
    AND pg_column_size(payload) < 8192
);
