-- ════════════════════════════════════════════════════════════════════════════
-- 0013 · Vocabulario de tipos: vip → premium
-- ════════════════════════════════════════════════════════════════════════════
-- La base nació con el tipo 'vip' (0003 y seed) mientras que la UI y el
-- catálogo del código hablan de 'premium' (el chip con destellos del
-- buscador). Esa divergencia dejaba las propiedades vip fuera de todo: el
-- chip Premium mostraba 0, el filtro propertyType=premium no las matcheaba y
-- los contadores por categoría no las contabilizaban. La ruta /api/properties
-- lo compensaba con un puente en el código (vip → premium al leer); esta
-- migración alinea la fuente para poder retirar ese puente.
--
-- Es solo un UPDATE de datos (sin cambio de esquema) y es idempotente:
-- aplicarla dos veces no hace nada la segunda vez, porque después de la
-- primera ya no queda ningún 'vip' que convertir. Cumple las reglas de
-- supabase/migrations/LEEME.md: no borra filas ni columnas y se puede
-- aplicar sin preguntar.
UPDATE public.properties
SET property_type = 'premium'
WHERE property_type = 'vip';

-- El comentario de la columna en 0003 sigue nombrando 'vip' como valor
-- válido; como las migraciones aplicadas no se editan (la huella del ledger
-- lo detectaría como drift), el vocabulario vigente queda documentado acá.
COMMENT ON COLUMN public.properties.property_type IS
    'apartment (Departamentos), house (Casas), premium (Premium, antes vip),
     parcel (Parcelas), office (Oficinas), land (Terrenos),
     parking (Estacionamientos), local (Locales), warehouse (Bodegas)';
