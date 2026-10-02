-- ════════════════════════════════════════════════════════════════════════════
-- 0012 · Visitas de la ficha (public.property_views)
-- ════════════════════════════════════════════════════════════════════════════
-- El velocímetro de demanda de la ficha en arriendo necesita saber cuántas
-- veces se abrió la propiedad. Se guarda un **contador agregado por propiedad**
-- (una fila, no una por visita): no hay IP, ni user agent, ni identificador de
-- nadie. Es la misma decisión que en `share_views`, pero con otro alcance —
-- allí se cuenta un enlace abierto, acá la ficha visitada.
--
-- `property_id` es TEXT y sin clave foránea, igual que en `share_views`: los
-- ids del catálogo son legibles ("scl-depto-marco-polo"), no UUID.
CREATE TABLE IF NOT EXISTS public.property_views (
    property_id TEXT NOT NULL PRIMARY KEY,
    views BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- El informe/orden eventual mira las más visitadas primero.
CREATE INDEX IF NOT EXISTS property_views_views_idx
    ON public.property_views (views DESC);

ALTER TABLE public.property_views ENABLE ROW LEVEL SECURITY;

-- Nadie escribe la tabla directamente: el único camino es la función de abajo,
-- que solo suma de a uno. Sin política de INSERT/UPDATE, la anon key no puede
-- inventar filas ni fijar un contador arbitrario.
DROP POLICY IF EXISTS "Lectura de visitas solo para admin" ON public.property_views;
CREATE POLICY "Lectura de visitas solo para admin"
ON public.property_views
FOR SELECT
TO authenticated
USING (public.is_rix7_admin());

-- ── RPC: suma una visita y devuelve el total ya actualizado ──────────────────
-- Devuelve el total para que la ficha pueda refrescar el número sin una segunda
-- consulta. `SECURITY DEFINER` porque quien llama es la visita (sin sesión) y la
-- tabla no tiene política de escritura.
--
-- Límite honesto: cualquiera puede invocarla repetidamente para inflar el
-- contador de una propiedad. El rate limit de la API route lo frena, pero un
-- contador público nunca es a prueba de manipulación; sirve para mostrar
-- interés relativo, no para facturar.
CREATE OR REPLACE FUNCTION public.increment_property_view(
    p_property_id TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_views BIGINT;
BEGIN
    INSERT INTO public.property_views (property_id, views)
    VALUES (p_property_id, 1)
    ON CONFLICT (property_id)
    DO UPDATE SET
        views = public.property_views.views + 1,
        updated_at = timezone('utc'::text, now())
    RETURNING public.property_views.views INTO new_views;

    RETURN new_views;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_property_view(TEXT) TO anon, authenticated;

-- ── RPC: lee el total sin escribirlo ─────────────────────────────────────────
-- La ficha se sirve cacheada (ISR) y lee el contador en el render; el ping del
-- navegador solo actualiza el número en pantalla. Esta función es de solo
-- lectura y también `SECURITY DEFINER` para no exponer la tabla por RLS.
CREATE OR REPLACE FUNCTION public.get_property_views(
    p_property_id TEXT
)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT views FROM public.property_views WHERE property_id = p_property_id),
        0
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_property_views(TEXT) TO anon, authenticated;
