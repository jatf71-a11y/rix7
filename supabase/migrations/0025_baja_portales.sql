-- ════════════════════════════════════════════════════════════════════════════
-- 0025 · Baja de las fichas de portales: la clave foránea deja de bloquearla
-- ════════════════════════════════════════════════════════════════════════════
-- Portal Inmobiliario, Toctoc y Yapo estaban en `partners` como fichas de origen
-- del catálogo. Son competencia directa del portal y se dan de baja desde el
-- panel (`/admin/empresas`), que es donde se administran las fichas.
--
-- Lo que impedía terminar la baja era la clave foránea: `properties.partner_id`
-- referencia `partners(id)` sin acción de borrado, así que eliminar una ficha
-- que todavía tiene propiedades falla con un error de integridad. Con
-- `ON DELETE SET NULL`, borrar la ficha suelta sus propiedades —quedan
-- atribuidas al portal, «Rix7 / Portal», y conservan enlace, visitas y
-- contactos— en vez de bloquear el borrado.
--
-- La migración **no borra filas**: dar de baja un socio es una acción del panel,
-- no del esquema. Solo cambia qué pasa con sus propiedades cuando se borra.
ALTER TABLE public.properties
    DROP CONSTRAINT IF EXISTS properties_partner_id_fkey;

ALTER TABLE public.properties
    ADD CONSTRAINT properties_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
