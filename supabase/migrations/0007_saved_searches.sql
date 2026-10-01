-- ════════════════════════════════════════════════════════════════════════════
-- 0007 · Búsquedas guardadas y sus alertas (public.saved_searches)
-- ════════════════════════════════════════════════════════════════════════════
-- Le dan un propósito a la cuenta: la persona guarda una búsqueda y recibe un
-- correo cuando aparece una propiedad que encaja. Sin esto, "crear cuenta" solo
-- servía para publicar, que es cosa de las corredoras.
CREATE TABLE IF NOT EXISTS public.saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Filtros tal como los usa el buscador (`lib/data/propertyFilters`), para que
    -- el aviso coincida exactamente con lo que la persona vio al guardar.
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Etiqueta legible calculada al guardar ("Venta · Departamentos en Las Condes"),
    -- para el correo y la lista del usuario.
    label TEXT NOT NULL DEFAULT '',

    -- Permite silenciar un aviso sin borrar la búsqueda.
    notify BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Cuándo se avisó por última vez: define qué propiedades son "nuevas". Se
    -- deja en NULL al crear para que la primera corrida solo fije la línea base
    -- y no mande un correo con todo el catálogo.
    last_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS saved_searches_user_idx
    ON public.saved_searches (user_id, created_at DESC);

-- El job de alertas solo mira las que tienen aviso activo.
CREATE INDEX IF NOT EXISTS saved_searches_notify_idx
    ON public.saved_searches (notify)
    WHERE notify;

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

-- Cada persona administra únicamente las suyas. El job de alertas no pasa por
-- acá: usa la clave de servicio, que no está sujeta a RLS.
DROP POLICY IF EXISTS "Busquedas propias" ON public.saved_searches;
CREATE POLICY "Busquedas propias"
ON public.saved_searches
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
