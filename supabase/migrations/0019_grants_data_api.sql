-- ════════════════════════════════════════════════════════════════════════════
-- 0019 · Grants explícitos para la Data API (cambio de Supabase del 2026-10-30)
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta ahora Supabase concedía los privilegios de la Data API
-- automáticamente a cada tabla nueva de `public`. Desde el **2026-10-30** eso
-- deja de pasar en los proyectos existentes: una tabla creada después de esa
-- fecha necesita su `GRANT` explícito o `supabase-js`, PostgREST y GraphQL
-- responden «permission denied». Afecta a todo lo que se crea desde estas
-- migraciones: una base nueva, un preview branch y `supabase db reset`.
--
-- Estos grants son la puerta de **esquema**; la de **filas** sigue siendo RLS,
-- que ya está habilitado en las diez tablas. Por eso se concede lo mínimo que
-- cada rol necesita y nunca `ALL` (incluiría TRUNCATE, que no pasa por RLS):
--
--   anon            SELECT en las tablas del portal (las políticas devuelven
--                   solo lo público) e INSERT en las cuatro altas públicas:
--                   leads, signups, share_events y solicitudes.
--   authenticated   SELECT/INSERT/UPDATE/DELETE en las diez; RLS decide qué
--                   filas y qué operaciones.
--   service_role    SELECT/INSERT/UPDATE/DELETE en las diez; salta RLS y es el
--                   rol de los jobs (alertas, informes).
--
-- `public.rix7_migrations` queda fuera a propósito: la lee el script de
-- migraciones con la Management API (rol `postgres`), nunca la API pública.
--
-- Es idempotente: repetir un `GRANT` no cambia nada. En la base actual los
-- grants viejos siguen ahí (Supabase no los retira); esto garantiza que una
-- base creada desde cero los tenga aunque el auto-grant ya no exista.
--
-- Regla para las próximas migraciones (la vigila `scripts/db-push.test.ts`):
-- toda tabla nueva de `public` lleva sus `GRANT` en el mismo archivo que la
-- crea, o en una migración posterior que la incluya acá.

-- ── anon: lectura pública + altas públicas ──────────────────────────────────
GRANT SELECT ON public.partners TO anon;
GRANT SELECT ON public.properties TO anon;
GRANT SELECT ON public.leads TO anon;
GRANT SELECT ON public.saved_searches TO anon;
GRANT SELECT ON public.favorites TO anon;
GRANT SELECT ON public.share_views TO anon;
GRANT SELECT ON public.signups TO anon;
GRANT SELECT ON public.property_views TO anon;
GRANT SELECT ON public.share_events TO anon;
GRANT SELECT ON public.solicitudes TO anon;

GRANT INSERT ON public.leads TO anon;
GRANT INSERT ON public.signups TO anon;
GRANT INSERT ON public.share_events TO anon;
GRANT INSERT ON public.solicitudes TO anon;

-- ── authenticated: tablas del portal (RLS decide las filas) ─────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_views TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_views TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes TO authenticated;

-- ── service_role: jobs y tareas del servidor ─────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_views TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_views TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes TO service_role;
