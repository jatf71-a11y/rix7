-- ════════════════════════════════════════════════════════════════════════════
-- 0022 · Gastos comunes, contribuciones y garantía en la ficha
-- ════════════════════════════════════════════════════════════════════════════
-- Tres datos de costo que un arriendo o una venta necesitan y que hasta ahora
-- solo podían vivir en la descripción libre: lo que cuesta mantener el
-- inmueble (gastos comunes), lo que se paga al fisco (contribuciones) y lo que
-- se exige de garantía al arrendar. Como texto en la descripción no se pueden
-- comparar, ni filtrar, ni sumar al precio.
--
-- Son **opcionales y en CLP** (`NUMERIC(14,2)`, el mismo tipo que `price`).
-- NULL es «no informado» y la ficha simplemente no muestra esa línea: una
-- propiedad publicada sin estos datos se ve igual que antes, así que la
-- migración no cambia ninguna ficha existente.
--
-- `get_property_by_id` se recrea porque su `RETURNS TABLE` crece con las tres
-- columnas. Postgres no deja cambiar el tipo de retorno con `CREATE OR REPLACE`
-- («cannot change return type of existing function»), así que se suelta y se
-- vuelve a crear en este mismo archivo — la excepción que permite la regla 3 de
-- `supabase/migrations/LEEME.md`. La migración `0005` **no se edita**: su
-- cuerpo describe la función como estaba al aplicarse, y `db:push` la
-- re-ejecutaría si cambiara su huella. En una base nueva, `0005` crea la
-- versión vieja y este archivo la reemplaza; en una base existente, este
-- archivo es el único que corre.
--
-- A propósito NO se toca `get_properties_filtered`: el listado y el mapa no
-- muestran estos datos, solo la ficha.

-- ── Columnas ───────────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS common_expenses NUMERIC(14, 2);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_taxes NUMERIC(14, 2);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS deposit NUMERIC(14, 2);

COMMENT ON COLUMN public.properties.common_expenses IS
    'Gastos comunes mensuales en CLP. NULL = no informado (la ficha no muestra
     la línea). Se escribe desde el panel del socio.';

COMMENT ON COLUMN public.properties.property_taxes IS
    'Contribuciones en CLP. Es el monto que informa el propietario; NULL = no
     informado. Solo se publica en la ficha.';

COMMENT ON COLUMN public.properties.deposit IS
    'Garantía exigida en CLP (típicamente un mes de arriendo). NULL = no
     informada o no aplica. Solo se publica en la ficha.';

-- ── Detalle de la ficha, con los tres datos nuevos ─────────────────────────
DROP FUNCTION IF EXISTS public.get_property_by_id(TEXT);

CREATE OR REPLACE FUNCTION public.get_property_by_id(
    property_id TEXT
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    price NUMERIC,
    property_type TEXT,
    status TEXT,
    bedrooms INTEGER,
    bathrooms NUMERIC,
    area_sqm NUMERIC,
    parking_spots INTEGER,
    year_built INTEGER,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    images TEXT[],
    features TEXT[],
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    agent_name TEXT,
    agent_email TEXT,
    agent_phone TEXT,
    agent_avatar TEXT,
    partner_id TEXT,
    video_url TEXT,
    video_poster TEXT,
    -- 0022: costos de la ficha. Opcionales: NULL = no informado.
    common_expenses NUMERIC,
    property_taxes NUMERIC,
    deposit NUMERIC,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        p.price,
        p.property_type,
        p.status,
        p.bedrooms,
        p.bathrooms,
        p.area_sqm,
        p.parking_spots,
        p.year_built,
        p.address,
        p.city,
        p.state,
        p.zip_code,
        p.images,
        p.features,
        ST_Y(p.location::geometry) AS lat,
        ST_X(p.location::geometry) AS lng,
        p.agent_name,
        p.agent_email,
        p.agent_phone,
        p.agent_avatar,
        p.partner_id,
        p.video_url,
        p.video_poster,
        p.common_expenses,
        p.property_taxes,
        p.deposit,
        p.created_at
    FROM public.properties p
    WHERE p.id::TEXT = property_id
    LIMIT 1;
END;
$$;
