-- ════════════════════════════════════════════════════════════════════════════
-- 0008 · Favoritos (public.favorites)
-- ════════════════════════════════════════════════════════════════════════════
-- Los favoritos vivían en el navegador (`localStorage`), así que se quedaban en
-- ese dispositivo. Acá viven en la cuenta: siguen a la persona entre el celular
-- y el computador, y son la razón por la que conviene entrar.
--
-- `property_id` es TEXT y **no** tiene clave foránea, igual que en `leads`:
-- las propiedades del catálogo usan ids legibles ("scl-depto-marco-polo") que no
-- son UUID, así que una FK contra `properties(id)` los rechazaría.
CREATE TABLE IF NOT EXISTS public.favorites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- La misma propiedad no se puede guardar dos veces: si se aprieta dos veces
    -- el corazón, la segunda es inofensiva.
    PRIMARY KEY (user_id, property_id)
);

-- El listado siempre es "los míos, del más nuevo al más viejo".
CREATE INDEX IF NOT EXISTS favorites_user_idx
    ON public.favorites (user_id, created_at DESC);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Cada persona administra únicamente los suyos: ni lee ni escribe los de otro,
-- ni siquiera con la anon key. No hay política de lectura pública a propósito.
DROP POLICY IF EXISTS "Favoritos propios" ON public.favorites;
CREATE POLICY "Favoritos propios"
ON public.favorites
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
