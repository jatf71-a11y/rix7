-- ════════════════════════════════════════════════════════════════════════════
-- 0009 · Aperturas de enlaces compartidos (public.share_views)
-- ════════════════════════════════════════════════════════════════════════════
-- La landing `/compartir/[id]` es lo que las corredoras mandan por WhatsApp, y
-- hasta ahora no había forma de saber si el enlace servía. Sumado a `leads`
-- (que ya guarda la corredora de cada contacto), esto permite responder la
-- pregunta que importa: **qué enlaces traen interesados**.
--
-- Decisión de diseño: se guarda un **contador agregado por propiedad y día**,
-- no una fila por visita. No hay IP, ni user agent, ni identificador de nadie:
-- el sistema cuenta enlaces abiertos, no personas. Con una fila por evento el
-- panel podría responder las mismas preguntas, pero además acumularía un
-- historial de quién abrió qué, que es exactamente lo que no hace falta.
--
-- `property_id` es TEXT y sin clave foránea, igual que en `leads` y `favorites`:
-- los ids del catálogo son legibles ("scl-depto-marco-polo"), no UUID.
CREATE TABLE IF NOT EXISTS public.share_views (
    property_id TEXT NOT NULL,

    -- Día UTC de las aperturas. Permite ver si el enlace funciona **ahora**, que
    -- es la pregunta real: un total histórico esconde que dejó de circular.
    day DATE NOT NULL DEFAULT (timezone('utc'::text, now()))::date,

    -- Corredora dueña de la propiedad, para poder agrupar el informe. Se guarda
    -- desnormalizado a propósito: si la propiedad cambia de corredora, las
    -- aperturas viejas siguen atribuidas a quien las generó.
    partner_id TEXT,

    views INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    PRIMARY KEY (property_id, day)
);

-- El informe agrupa por corredora en una ventana de tiempo.
CREATE INDEX IF NOT EXISTS share_views_partner_idx
    ON public.share_views (partner_id, day DESC);

ALTER TABLE public.share_views ENABLE ROW LEVEL SECURITY;

-- Nadie escribe la tabla directamente: el único camino es la función de abajo,
-- que solo suma de a uno. Sin política de INSERT/UPDATE, la anon key no puede
-- inventar filas ni fijar un contador arbitrario.
DROP POLICY IF EXISTS "Lectura de aperturas solo para admin" ON public.share_views;
CREATE POLICY "Lectura de aperturas solo para admin"
ON public.share_views
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- ── RPC: suma una apertura de forma atómica ──────────────────────────────────
-- `SECURITY DEFINER` porque quien llama es la visita (sin sesión) y la tabla no
-- tiene política de escritura. La función no recibe un valor a sumar, solo el
-- nombre del enlace: no se puede usar para fijar el contador en el número que
-- uno quiera, y no devuelve nada que no fuera ya público.
--
-- Límite honesto: cualquiera puede invocarla repetidamente para inflar el
-- número de un enlace propio. El rate limit de la API route lo frena, pero un
-- contador público nunca es a prueba de manipulación; sirve para decidir qué
-- enlace conviene seguir usando, no para facturar.
CREATE OR REPLACE FUNCTION public.increment_share_view(
    p_property_id TEXT,
    p_partner_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.share_views (property_id, day, partner_id, views)
    VALUES (
        p_property_id,
        (timezone('utc'::text, now()))::date,
        p_partner_id,
        1
    )
    ON CONFLICT (property_id, day)
    DO UPDATE SET
        views = public.share_views.views + 1,
        -- Se completa si faltaba, pero no se pisa una atribución ya guardada.
        partner_id = COALESCE(public.share_views.partner_id, EXCLUDED.partner_id),
        updated_at = timezone('utc'::text, now());
$$;

GRANT EXECUTE ON FUNCTION public.increment_share_view(TEXT, TEXT) TO anon, authenticated;
