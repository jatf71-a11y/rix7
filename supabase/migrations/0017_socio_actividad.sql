-- ════════════════════════════════════════════════════════════════════════════
-- 0017 · Actividad de la corredora: lectura de sus contactos y compartidos
-- ════════════════════════════════════════════════════════════════════════════
-- El panel `/socio` muestra, además del stock, qué pasó con los enlaces de la
-- corredora: compartidos, aperturas y contactos, por enlace y por canal. Hasta
-- acá esas tres tablas eran **solo del equipo**:
--
--   - `leads`        → «Lectura de contactos solo para admin» (0006)
--   - `share_views`  → «Lectura de aperturas solo para admin» (0009)
--   - `share_events` → «Lectura de compartidos solo para admin» (0016)
--
-- Con esas políticas, una cuenta `member` que entraba a su propio panel veía
-- cero actividad aunque sus enlaces se estuvieran moviendo: la RLS filtraba las
-- filas en silencio, sin error. Este archivo agrega una política de lectura por
-- tabla que deja al socio ver **solo las filas de su corredora**, usando el
-- mismo vínculo `app_metadata.partner_id` de la migración 0014
-- (`public.rix7_partner_id()`).
--
-- Lo que **no** cambia, a propósito:
--
--   - El alta sigue siendo pública (la visita no tiene cuenta) y sigue validada
--     por las políticas de inserción existentes.
--   - Borrar sigue siendo solo del equipo: el socio no puede hacer desaparecer
--     un contacto.
--   - `share_views` no gana política de escritura: se sigue sumando únicamente
--     por la RPC `increment_share_view`.
--   - El admin conserva la lectura completa, porque las políticas se suman
--     (OR) y su condición sigue en la lista.
--
-- Todas las políticas llevan su `DROP POLICY IF EXISTS` para poder aplicarlas
-- dos veces, como pide supabase/migrations/LEEME.md.

-- ── Contactos: el socio ve los de su corredora ──────────────────────────────
DROP POLICY IF EXISTS "Lectura de contactos de la propia corredora" ON public.leads;
CREATE POLICY "Lectura de contactos de la propia corredora"
ON public.leads
FOR SELECT
TO authenticated
USING (
    public.is_rix7_admin()
    OR (
        public.rix7_partner_id() IS NOT NULL
        AND partner_id = public.rix7_partner_id()
    )
);

-- ── Aperturas: el socio ve las de sus enlaces ───────────────────────────────
DROP POLICY IF EXISTS "Lectura de aperturas de la propia corredora" ON public.share_views;
CREATE POLICY "Lectura de aperturas de la propia corredora"
ON public.share_views
FOR SELECT
TO authenticated
USING (
    public.is_rix7_admin()
    OR (
        public.rix7_partner_id() IS NOT NULL
        AND partner_id = public.rix7_partner_id()
    )
);

-- ── Compartidos: el socio ve quién movió sus enlaces ────────────────────────
-- Incluye los compartidos que hizo una visita desde la ficha o la landing de
-- una propiedad suya, no solo los que hizo desde el panel: el panel necesita
-- ambos para atribuir los contactos por canal.
DROP POLICY IF EXISTS "Lectura de compartidos de la propia corredora" ON public.share_events;
CREATE POLICY "Lectura de compartidos de la propia corredora"
ON public.share_events
FOR SELECT
TO authenticated
USING (
    public.is_rix7_admin()
    OR (
        public.rix7_partner_id() IS NOT NULL
        AND partner_id = public.rix7_partner_id()
    )
);
