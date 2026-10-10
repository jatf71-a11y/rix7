-- ════════════════════════════════════════════════════════════════════════════
-- 0014 · Publicaciones de socios: helper de corredora en la sesión y su RLS
-- ════════════════════════════════════════════════════════════════════════════
-- El rol `member` ya se reconocía en el código (lib/utils/roles.ts) pero no
-- habilitaba nada: el vínculo entre la cuenta y su corredora no existía en la
-- base, así que las políticas de `properties` solo conocían al creador
-- individual (`auth.uid() = user_id`). Con eso no se puede administrar el
-- stock de una empresa: si dos personas de la misma corredora publican, cada
-- una ve solo lo suyo, y si la cuenta de una se va, sus fichas quedan huérfanas
-- para el resto del equipo.
--
-- Este archivo introduce el vínculo y lo hace valer en las tres operaciones:
--
-- 1. `rix7_partner_id()` lee `app_metadata.partner_id` del JWT. Ese claim lo
--    escribe **solo el servidor** (rol admin, desde /admin), igual que el rol:
--    el usuario no puede ascenderse editando su propio token.
-- 2. INSERT: el socio puede dar de alta propiedades **de su corredora** (y solo
--    de esas), o atribuirlas al portal (`partner_id IS NULL`) siendo su creador
--    — que era la capacidad que ya daba la política anterior.
-- 3. UPDATE/DELETE: admin, el socio de la corredora dueña, o el creador
--    individual. La comprobación en UPDATE impide además que un socio mueva
--    una ficha a otra corredora.
--
-- Las tres políticas del 0004 se descartan con sus nombres originales y se
-- reemplazan por estas: misma superficie de lectura pública, escritura con
-- dueño. Cumple las reglas de supabase/migrations/LEEME.md (solo DROP POLICY,
-- sin borrar datos, creaciones idempotentes).

-- ── Helper: la corredora del usuario que hace la consulta ───────────────────
-- Devuelve NULL cuando la cuenta no está vinculada: `partner_id = NULL` es
-- NULL (falso), así que las políticas de abajo no necesitan un caso extra.
CREATE OR REPLACE FUNCTION public.rix7_partner_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(BTRIM(COALESCE(auth.jwt() -> 'app_metadata' ->> 'partner_id', '')), '');
$$;

-- ── INSERT: alta de publicaciones ───────────────────────────────────────────
-- Se descarta la política del 0004 («WITH CHECK (true)»: cualquier
-- autenticado podía crear filas con el partner_id que quisiera) y se pone la
-- misma condición que rige la edición.
DROP POLICY IF EXISTS "Creacion permitida para usuarios autenticados" ON public.properties;
DROP POLICY IF EXISTS "Creacion de publicaciones de socio" ON public.properties;
CREATE POLICY "Creacion de publicaciones de socio"
ON public.properties
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_rix7_admin()
    OR (public.rix7_partner_id() IS NOT NULL AND partner_id = public.rix7_partner_id())
    OR (partner_id IS NULL AND auth.uid() = user_id)
);

-- ── UPDATE: edición de publicaciones ────────────────────────────────────────
-- Se descarta la política del 0004 (solo el creador) por la versión que
-- agrega al dueño de la corredora y al admin. El WITH CHECK es el mismo que
-- el USING: así una ficha no se puede «traspasar» a otra corredora en la misma
-- escritura.
DROP POLICY IF EXISTS "Actualizacion de propiedades del creador" ON public.properties;
DROP POLICY IF EXISTS "Actualizacion de publicaciones de socio" ON public.properties;
CREATE POLICY "Actualizacion de publicaciones de socio"
ON public.properties
FOR UPDATE
TO authenticated
USING (
    public.is_rix7_admin()
    OR (public.rix7_partner_id() IS NOT NULL AND partner_id = public.rix7_partner_id())
    OR auth.uid() = user_id
)
WITH CHECK (
    public.is_rix7_admin()
    OR (public.rix7_partner_id() IS NOT NULL AND partner_id = public.rix7_partner_id())
    OR auth.uid() = user_id
);

-- ── DELETE: baja de publicaciones ───────────────────────────────────────────
DROP POLICY IF EXISTS "Eliminacion de propiedades del creador" ON public.properties;
DROP POLICY IF EXISTS "Eliminacion de publicaciones de socio" ON public.properties;
CREATE POLICY "Eliminacion de publicaciones de socio"
ON public.properties
FOR DELETE
TO authenticated
USING (
    public.is_rix7_admin()
    OR (public.rix7_partner_id() IS NOT NULL AND partner_id = public.rix7_partner_id())
    OR auth.uid() = user_id
);
