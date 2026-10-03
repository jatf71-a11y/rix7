-- ════════════════════════════════════════════════════════════════════════════
-- 0004 · RLS de properties y bucket de Storage para las fotos
-- ════════════════════════════════════════════════════════════════════════════
-- El `schema.sql` anterior creaba estas cuatro políticas sin descartarlas antes:
-- a la segunda ejecución fallaba con «policy already exists» y dejaba el resto
-- del archivo sin aplicar. Acá cada política se descarta primero, que es lo que
-- hace idempotente al archivo (y lo que vigila `scripts/db-push.test.ts`).
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Lectura pública para cualquier usuario
DROP POLICY IF EXISTS "Lectura publica de propiedades" ON public.properties;
CREATE POLICY "Lectura publica de propiedades"
ON public.properties
FOR SELECT
USING (true);

-- Creación permitida solo para usuarios autenticados
DROP POLICY IF EXISTS "Creacion permitida para usuarios autenticados" ON public.properties;
CREATE POLICY "Creacion permitida para usuarios autenticados"
ON public.properties
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Actualización solo por el creador o administradores
DROP POLICY IF EXISTS "Actualizacion de propiedades del creador" ON public.properties;
CREATE POLICY "Actualizacion de propiedades del creador"
ON public.properties
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Eliminación solo por el creador
DROP POLICY IF EXISTS "Eliminacion de propiedades del creador" ON public.properties;
CREATE POLICY "Eliminacion de propiedades del creador"
ON public.properties
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ── Storage: bucket público de fotos ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('properties-media', 'properties-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Acceso publico de lectura a imagenes" ON storage.objects;
CREATE POLICY "Acceso publico de lectura a imagenes"
ON storage.objects FOR SELECT
USING (bucket_id = 'properties-media');

DROP POLICY IF EXISTS "Subida de imagenes para autenticados" ON storage.objects;
CREATE POLICY "Subida de imagenes para autenticados"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'properties-media');
