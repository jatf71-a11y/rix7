-- ════════════════════════════════════════════════════════════════════════════
-- 0021 · El camino del propietario se llama `propuestas`
-- ════════════════════════════════════════════════════════════════════════════
-- `licitacion` describía el mecanismo —una licitación— y no lo que el
-- propietario hace con ella: recibir propuestas de corredoras y elegir con
-- quién trabajar. El portal ya usa ese vocabulario en el formulario, en la
-- página de publicación y en el panel, así que la clave interna se alinea.
--
-- Es un cambio de **vocabulario**, no de flujo: la fila guarda los mismos
-- campos en `payload`, la política de INSERT exige lo mismo y el panel lee los
-- mismos datos.
--
-- Tres lugares dependen del valor y hay que moverlos en este orden, o la
-- migración falla a mitad de camino:
--
--   1. el CHECK `solicitudes_kind_check` — rechaza `propuestas` mientras siga
--      la lista vieja, y rechaza el UPDATE mientras el valor viejo sea el
--      válido;
--   2. las filas existentes — se renombran con la tabla sin CHECK;
--   3. la política de INSERT — vuelve a validar el tipo en el servidor.
--
-- Las migraciones `0018` y `0020` **no se editan**: describen el esquema tal
-- como quedó cuando se aplicaron, y `db:push` las re-ejecutaría si cambia su
-- huella. Una base nueva las aplica primero y llega igual a este archivo, así
-- que termina igual que una base vieja que solo corre este.
--
-- Idempotente: el DROP del CHECK es `IF EXISTS`, el UPDATE no encuentra nada la
-- segunda vez y la política se suelta antes de recrearse.

-- ── 1. Sin CHECK no hay valor que renombrar ────────────────────────────────
-- Postgres no permite modificar un CHECK existente: se elimina y se crea otro.
-- El nombre es el que Postgres asigna al CHECK declarado en línea en `0018`
-- (`solicitudes_kind_check`), verificado contra la base real.
ALTER TABLE public.solicitudes DROP CONSTRAINT IF EXISTS solicitudes_kind_check;

-- ── 2. Las filas que ya existen ────────────────────────────────────────────
-- Se hace sin CHECK a propósito: con la lista vieja el valor nuevo se rechaza,
-- y con la lista nueva el valor viejo se rechaza. No borra nada: renombra la
-- clave y conserva contacto, payload, consentimiento, estado y fecha.
UPDATE public.solicitudes
    SET kind = 'propuestas'
    WHERE kind = 'licitacion';

-- ── 3. El CHECK, con el vocabulario nuevo ──────────────────────────────────
ALTER TABLE public.solicitudes ADD CONSTRAINT solicitudes_kind_check
    CHECK (kind = ANY (ARRAY['propuestas', 'corredora', 'inmobiliaria', 'agente']));

-- ── 4. RLS: el alta pública con el vocabulario nuevo ───────────────────────
-- Es la misma política de `0020` con el `kind` renombrado: la forma mínima que
-- vuelve a validar la tabla para que no se convierta en un vertedero. Se
-- elimina y se recrea, que es la única forma de cambiar una política.
DROP POLICY IF EXISTS "Alta publica de solicitudes" ON public.solicitudes;
CREATE POLICY "Alta publica de solicitudes"
ON public.solicitudes
FOR INSERT
TO anon, authenticated
WITH CHECK (
    kind = ANY (ARRAY['propuestas', 'corredora', 'inmobiliaria', 'agente'])
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
