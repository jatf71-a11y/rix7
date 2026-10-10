-- ════════════════════════════════════════════════════════════════════════════
-- 0015 · Identificación de la publicación: ROL (SII) y video
-- ════════════════════════════════════════════════════════════════════════════
-- Tres ampliaciones de esquema para el panel de socios, todas idempotentes y
-- sin borrar nada (reglas de supabase/migrations/LEEME.md):
--
-- 1. `rol` — el Rol de Propiedad del SII con que se identifica un inmueble en
--    Chile. Es dato de **identificación interna**: viaja en el panel y en la
--    respuesta de `/api/partner/properties` (que exige sesión y corredora
--    vinculada), pero **no** en los RPC públicos (`0005` selecciona columnas
--    explícitas y no lo incluye), así que nunca llega a la ficha ni al HTML
--    público.
-- 2. `video_url` / `video_poster` — el video de la ficha (`VideoReels`) ya
--    existía en el código y en el catálogo del build, pero no había columna:
--    las propiedades de la base no podían tener video. Se agregan las dos
--    columnas y, en `0005` (editado, huella nueva → se re-aplica idempotente),
--    `get_property_by_id` las devuelve para que la ficha las muestre.
-- 3. `COMMENT` del vocabulario de `status`, que gana el estado **rented**
--    (arriendo concretado), el análogo de `sold` para la venta. La columna es
--    TEXT sin CHECK, así que el estado no necesita ALTER: queda documentado
--    acá, igual que hizo 0013 con `property_type`.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS rol TEXT;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS video_poster TEXT;

COMMENT ON COLUMN public.properties.rol IS
    'Rol de propiedad según el SII (ej: 15234-67). Identificación interna:
     se muestra en el panel del socio y NUNCA en la ficha pública ni en los
     RPC del portal.';

COMMENT ON COLUMN public.properties.status IS
    'for_sale (En venta), for_rent (En arriendo), sold (Vendido),
     rented (Arrendado: arriendo concretado, análogo de sold)';

COMMENT ON COLUMN public.properties.video_url IS
    'Video de la ficha (URL http(s), ruta local o archivo subido a Storage).
     Se publica en la ficha y en la landing /compartir.';

COMMENT ON COLUMN public.properties.video_poster IS
    'Fotograma de portada del video: evita el recuadro negro mientras carga.';
