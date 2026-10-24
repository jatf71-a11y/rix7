-- ==============================================================================
-- DATOS SEMILLA (SEED DATA) RIX7 CON COORDENADAS GEOESPACIALES DE CHILE
-- (SANTIAGO, VALPARAÍSO, COQUIMBO, ARAUCANÍA, LOS LAGOS, ANTOFAGASTA, BIOBÍO, MAGALLANES)
-- ==============================================================================

INSERT INTO public.properties (
    title,
    description,
    price,
    property_type,
    status,
    bedrooms,
    bathrooms,
    area_sqm,
    parking_spots,
    year_built,
    address,
    city,
    state,
    zip_code,
    images,
    features,
    location,
    agent_name,
    agent_email,
    agent_phone
) VALUES
-- 1. Vitacura (Premium)
(
    'Exclusiva Residencia VIP con Terraza Panorámica en Nueva Costanera',
    'Impresionante residencia VIP en Nueva Costanera con vista despejada a la cordillera y Parque Bicentenario. Finas terminaciones, piso de madera de ingeniería, cocina italiana con isla de cuarzo y terraza privada con quincho integrado.',
    890000000,
    'premium',
    'for_sale',
    3,
    3.5,
    240.0,
    3,
    2022,
    'Av. Nueva Costanera 3900',
    'Vitacura',
    'Región Metropolitana de Santiago',
    '7630000',
    ARRAY[
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Terraza privada con quincho', 'Ascensor directo', 'Termopanel acústico', '3 Estacionamientos', 'Seguridad 24/7'],
    ST_SetSRID(ST_MakePoint(-70.5980, -33.3980), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 2. Las Condes (Depto)
(
    'Moderno Departamento en Barrio El Golf',
    'A pasos de Isidora Goyenechea y Metro El Golf. Excelente conectividad, cercano a restaurantes, bancos y comercio.',
    340000000,
    'apartment',
    'for_sale',
    2,
    2.0,
    95.0,
    1,
    2020,
    'Calle Gertrudis Echeñique 250',
    'Las Condes',
    'Región Metropolitana de Santiago',
    '7550000',
    ARRAY[
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Piscina panorámica', 'Gimnasio equipado', 'Sala de eventos'],
    ST_SetSRID(ST_MakePoint(-70.5960, -33.4175), 4326)::geography,
    'Matías Larraín',
    'matias.larrain@rix7.cl',
    '+56 9 9123 4567'
),
-- 3. Lo Barnechea (Casa)
(
    'Casa Mediterránea con Piscina y Gran Jardín en La Dehesa',
    'Espectacular casa mediterránea de hormigón a la vista en condominio consolidado. 4 dormitorios en suite, piscina temperada, quincho techado y estacionamiento para 4 autos.',
    1250000000,
    'house',
    'for_sale',
    5,
    5.0,
    480.0,
    4,
    2021,
    'Camino El Huinganal 4500',
    'Lo Barnechea',
    'Región Metropolitana de Santiago',
    '7690000',
    ARRAY[
        'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Piscina temperada', 'Jardín 1.200 m²', 'Quincho gourmet', 'Condominio cerrado'],
    ST_SetSRID(ST_MakePoint(-70.5280, -33.3450), 4326)::geography,
    'Ignacio Valdés',
    'ignacio.valdes@rix7.cl',
    '+56 9 7654 3210'
),
-- 4. Colina / Chicureo (Parcela)
(
    'Parcela de Agrado 5.000 m² con Casa de Campo y Frutales en Chicureo',
    'Hermosa parcela plana en sector Piedra Roja. Casa de 320 m² construidos con maderas nobles, piscina de 10x5, quincho rústico, árboles frutales y derechos de agua.',
    520000000,
    'parcel',
    'for_sale',
    4,
    3.5,
    5000.0,
    6,
    2019,
    'Camino Chicureo Km 3.5',
    'Colina',
    'Región Metropolitana de Santiago',
    '9340000',
    ARRAY[
        'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['5.000 m² de terreno', 'Derechos de agua', 'Piscina y quincho', 'Árboles frutales'],
    ST_SetSRID(ST_MakePoint(-70.6750, -33.2850), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 5. Viña del Mar (Depto Venta)
(
    'Departamento Primera Línea Frente al Mar en Reñaca / Viña del Mar',
    'Espectacular departamento en sector 5 de Reñaca con terraza panorámica cerrada y vista directa al océano Pacífico y puestas de sol.',
    360000000,
    'apartment',
    'for_sale',
    3,
    2.0,
    120.0,
    2,
    2021,
    'Av. Borgoño 15000',
    'Viña del Mar',
    'Valparaíso',
    '2520000',
    ARRAY[
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Primera línea frente al mar', 'Piscina temperada', 'Acceso directo a playa'],
    ST_SetSRID(ST_MakePoint(-71.5540, -32.9730), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 6. Zapallar (Premium)
(
    'Exclusiva Casa de Playa con Vista a la Bahía en Zapallar',
    'Residencia en lomaje de Zapallar con arquitectura en piedra y maderas nobles. Senderos privados, jardines costeros y terraza con vista a la bahía.',
    1450000000,
    'premium',
    'for_sale',
    5,
    5.0,
    450.0,
    4,
    2020,
    'Camino Costero Zapallar 800',
    'Zapallar',
    'Valparaíso',
    '2060000',
    ARRAY[
        'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Vista panorámica a la bahía', 'Piscina sinfín', 'Jardín con paisajismo'],
    ST_SetSRID(ST_MakePoint(-71.4608, -32.5539), 4326)::geography,
    'Ignacio Valdés',
    'ignacio.valdes@rix7.cl',
    '+56 9 7654 3210'
),
-- 7. Olmué (Parcela)
(
    'Parcela de 5.000 m² con Casona Quinta y Frutales en Olmué',
    'Microclima privilegiado a los pies del Cerro La Campana. Casa quinta de 240 m², piscina, quincho rústico, pozo profundo y más de 80 paltos en producción.',
    310000000,
    'parcel',
    'for_sale',
    4,
    3.0,
    5000.0,
    6,
    2018,
    'Av. Granizo Paradero 32',
    'Olmué',
    'Valparaíso',
    '2300000',
    ARRAY[
        'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['80 Paltos Hass en producción', 'Pozo con derechos de agua', 'Piscina y quincho'],
    ST_SetSRID(ST_MakePoint(-71.1861, -32.9972), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 8. La Serena (Depto)
(
    'Departamento en Avenida del Mar / Primera Línea en La Serena',
    'Acogedor departamento con terraza frente a la playa en Avenida del Mar. Living comedor, cocina americana, estacionamiento y áreas verdes comunes.',
    165000000,
    'apartment',
    'for_sale',
    2,
    2.0,
    72.0,
    1,
    2019,
    'Av. del Mar 4500',
    'La Serena',
    'Coquimbo',
    '1700000',
    ARRAY[
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Frente a la playa', 'Piscina y quinchos', 'Estacionamiento'],
    ST_SetSRID(ST_MakePoint(-71.2519, -29.9027), 4326)::geography,
    'Ignacio Valdés',
    'ignacio.valdes@rix7.cl',
    '+56 9 7654 3210'
),
-- 9. Pucón (Premium)
(
    'Casa VIP a Orillas del Lago Villarrica con Muelle Privado en Pucón',
    'Maravillosa casa construida en ciprés y piedra volcánica a orillas del Lago Villarrica. Muelle para embarcaciones, playa privada y vista despejada al Volcán.',
    980000000,
    'premium',
    'for_sale',
    4,
    4.0,
    380.0,
    4,
    2022,
    'Camino Villarrica Pucón Km 12',
    'Pucón',
    'La Araucanía',
    '4920000',
    ARRAY[
        'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Orilla de lago y muelle', 'Playa privada', 'Hot tub de ciprés', 'Bosque nativo'],
    ST_SetSRID(ST_MakePoint(-71.9753, -39.2817), 4326)::geography,
    'Matías Larraín',
    'matias.larrain@rix7.cl',
    '+56 9 9123 4567'
),
-- 10. Puerto Varas (Parcela)
(
    'Parcela de 5.000 m² con Vista al Volcán Osorno en Puerto Varas',
    'Parcela en condominio cerrado con orilla de estero y vista despejada a los Volcanes Osorno y Calbuco. Red de agua, luz soterrada y fibra óptica.',
    185000000,
    'parcel',
    'for_sale',
    0,
    0.0,
    5000.0,
    0,
    2023,
    'Ruta 225 Km 8 / Camino a Ensenada',
    'Puerto Varas',
    'Los Lagos',
    '5550000',
    ARRAY[
        'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['5.000 m² planos', 'Vista a volcanes Osorno y Calbuco', 'Luz soterrada y fibra óptica'],
    ST_SetSRID(ST_MakePoint(-72.9856, -41.3197), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 11. Antofagasta (Depto)
(
    'Departamento Vista al Mar en Costanera Sur / Antofagasta',
    'Moderno departamento en piso 15 frente a Playa Huáscar y Balneario Municipal. Cocina equipada con encimera vitrocerámica, terraza con vista panorámica y 2 estacionamientos.',
    235000000,
    'apartment',
    'for_sale',
    3,
    2.0,
    98.0,
    2,
    2021,
    'Av. Ejército 1200',
    'Antofagasta',
    'Antofagasta',
    '1240000',
    ARRAY[
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Vista al mar', 'Piscina panorámica', '2 Estacionamientos', 'Gimnasio'],
    ST_SetSRID(ST_MakePoint(-70.4000, -23.6500), 4326)::geography,
    'Matías Larraín',
    'matias.larrain@rix7.cl',
    '+56 9 9123 4567'
),
-- 12. Valdivia (Premium)
(
    'Casona Ribereña con Muelle en Isla Teja / Valdivia',
    'Impresionante propiedad en Isla Teja con 60 metros de orilla de río y muelle privado para kayak y lanchas. Bosque de arrayanes y calefacción a leña con radiadores.',
    680000000,
    'premium',
    'for_sale',
    5,
    4.0,
    390.0,
    4,
    2019,
    'Los Lingues 420',
    'Valdivia',
    'Los Ríos',
    '5090000',
    ARRAY[
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Orilla de río navegable', 'Muelle privado', 'Isla Teja consolidada'],
    ST_SetSRID(ST_MakePoint(-73.2459, -39.8142), 4326)::geography,
    'Matías Larraín',
    'matias.larrain@rix7.cl',
    '+56 9 9123 4567'
),
-- 13. Providencia (Arriendo)
(
    'Moderno Departamento Amoblado en Pocuro / Providencia',
    'Excelente departamento totalmente amoblado frente a ciclovía Pocuro. Terraza con parrilla a gas, dormitorio en suite, estacionamiento y bodega.',
    850000,
    'apartment',
    'for_rent',
    2,
    2.0,
    85.0,
    1,
    2021,
    'Av. Pocuro 2250',
    'Providencia',
    'Región Metropolitana de Santiago',
    '7500000',
    ARRAY[
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Completamente amoblado', 'Estacionamiento y bodega', 'Gimnasio y piscina'],
    ST_SetSRID(ST_MakePoint(-70.6080, -33.4380), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
),
-- 14. Viña del Mar (Arriendo)
(
    'Departamento Vista al Mar en Reñaca / Viña del Mar (Arriendo)',
    'Departamento frente a la costa en Reñaca. Terraza con vista panorámica a la bahía de Valparaíso, piscina temperada, acceso directo a la playa y estacionamiento.',
    920000,
    'apartment',
    'for_rent',
    2,
    2.0,
    90.0,
    1,
    2021,
    'Av. Borgoño 14500',
    'Viña del Mar',
    'Valparaíso',
    '2520000',
    ARRAY[
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80'
    ],
    ARRAY['Primera línea frente al mar', 'Piscina temperada', 'Estacionamiento techado'],
    ST_SetSRID(ST_MakePoint(-71.5540, -32.9730), 4326)::geography,
    'Camila Undurraga',
    'camila.undurraga@rix7.cl',
    '+56 9 8765 4321'
);

-- ==============================================================================
-- CORREDORAS INSCRITAS (PARTNERS)
-- ==============================================================================
-- Migración de los socios que antes vivían en memoria en
-- `lib/data/partners.ts`. Los teléfonos son PLACEHOLDER con el patrón de
-- relleno del proyecto (+56 2 2000 00XX / +56 9 0000 00XX): reemplazarlos por
-- los reales de cada corredora desde /admin/empresas.
--
-- Los portales de la competencia (Portal Inmobiliario, Toctoc, Yapo) ya no
-- están en la semilla: la migración 0025 los da de baja.
--
-- `ON CONFLICT DO NOTHING` a propósito: la semilla solo crea las que faltan y
-- nunca pisa lo que el equipo haya editado desde el panel.
INSERT INTO public.partners (
    id, slug, name, logo, description, website, color,
    contact_phone, contact_whatsapp, contact_email, sort_order
) VALUES
    ('catedral', 'catedral', 'Catedral Propiedades', '/logos/catedral.png',
     'Corredora de propiedades con atención personalizada y trato cercano', NULL, '#3B82F6',
     '+56 2 2000 0001', '+56 9 0000 0001', 'contacto@catedralpropiedades.cl', 0),

    ('cushman-wakefield', 'cushman-wakefield', 'Cushman & Wakefield', '/logos/cushmanwakefield.png',
     'Líder mundial en servicios inmobiliarios comerciales', 'https://www.cushmanwakefield.com', '#003366',
     '+56 2 2000 0002', '+56 9 0000 0002', 'contacto@cushmanwakefield.com', 1),

    ('cbre', 'cbre', 'CBRE Chile', '/logos/cbre.png',
     'La consultora inmobiliaria más grande del mundo', 'https://www.cbre.com', '#0050AA',
     '+56 2 2000 0003', '+56 9 0000 0003', 'contacto@cbre.com', 2),

    ('colliers', 'colliers', 'Colliers International', '/logos/colliers.png',
     'Servicios inmobiliarios y de gestión de inversiones', 'https://www.colliers.com', '#ED1C24',
     '+56 2 2000 0004', '+56 9 0000 0004', 'contacto@colliers.com', 3),

    ('jll-chile', 'jll-chile', 'JLL Chile', '/logos/jll.ico',
     'Consultoría inmobiliaria y gestión de inversiones', 'https://www.jll.com', '#CC0000',
     '+56 2 2000 0005', '+56 9 0000 0005', 'contacto@jll.com', 4),

    ('savills', 'savills', 'Savills Chile', '/logos/savills.png',
     'Asesoría inmobiliaria de prestigio internacional', 'https://www.savills.com', '#00263A',
     '+56 2 2000 0006', '+56 9 0000 0006', 'contacto@savills.com', 5),

    ('torre-blanca', 'torre-blanca', 'Torre Blanca SpA', '/logos/torreblanca.svg',
     'Desarrolladora inmobiliaria con más de 30 años de trayectoria', 'https://www.torreblanca.cl', '#1A5276',
     '+56 2 2000 0007', '+56 9 0000 0007', 'contacto@torreblanca.cl', 6),

    ('inelbrok', 'inelbrok', 'Inelbrok', '/logos/inelbrok.svg',
     'Corredora de propiedades con presencia nacional', 'https://www.inelbrok.cl', '#E67E22',
     '+56 2 2000 0008', '+56 9 0000 0008', 'contacto@inelbrok.cl', 7)
ON CONFLICT (id) DO NOTHING;

-- Categorías de socio (`kind`, migración 0024). Va como UPDATE y no como
-- columna del INSERT para que una base que ya tenía las filas también quede
-- clasificada. `WHERE kind IS NULL` respeta lo que se haya cambiado a mano.
UPDATE public.partners SET kind = 'corredora'
    WHERE kind IS NULL AND id IN ('catedral', 'inelbrok');
UPDATE public.partners SET kind = 'inmobiliaria'
    WHERE kind IS NULL AND id IN (
        'cushman-wakefield', 'cbre', 'colliers', 'jll-chile', 'savills', 'torre-blanca'
    );

-- Catálogo de las corredoras (fase 3, 2.1): las 35 fichas que
-- atribuye `lib/data/propertyCatalog.ts`, cargadas como filas de la base.
--
-- Por qué están acá y no solo en el código: la página de empresa y el feed
-- público leen la base (el catálogo del build es solo el contenido de arranque de
-- una base que todavía no tiene las fichas de esa corredora). Con estas filas, lo
-- que la corredora publica, edita o borra desde /socio es exactamente lo que su
-- página muestra.
--
-- El id es el **uuid v5 (RFC 4122) de https://rix7.cl/catalogo/<id-del-catálogo>** con el
-- namespace URL: derivable por cualquiera, así que volver a insertar produce los
-- mismos ids. Textos, precios, fotos y fechas salen del catálogo.
--
-- Va después de las corredoras: `properties.partner_id` tiene clave foránea
-- contra `partners`, y sin la fila de la corredora el INSERT fallaría.
INSERT INTO public.properties (
    id, title, description, price, property_type,
    status, bedrooms, bathrooms, area_sqm, parking_spots,
    year_built, address, city, state, zip_code,
    images, features,
    location,
    agent_name, agent_email, agent_phone, agent_avatar,
    video_url, video_poster, partner_id, created_at
) VALUES

  -- catedral (9)
  ('4f732c01-ff9b-5627-80ea-039d2c2aace5', 'Casa Familiar con Jardín y Quincho en La Reina', 'Amplia casa familiar de 4 dormitorios en sector residencial de La Reina.', 580000000, 'house',
   'for_sale', 4, 3, 220, 2,
   2018, 'Av. Larraín 5650', 'La Reina', 'Región Metropolitana de Santiago', '7850000',
   ARRAY['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=800&q=80'], ARRAY['Jardín con pasto natural', 'Quincho techado a gas', 'Chimenea', 'Cocina integral'],
   ST_SetSRID(ST_MakePoint(-70.542, -33.4515), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-01T10:00:00Z'),

  ('504856b7-bee1-5299-886f-98575f6bf014', 'Departamento Amoblado Entrega Inmediata en Concepción', 'Departamento totalmente amoblado y listo para habitar.', 260000000, 'apartment',
   'for_sale', 2, 1, 75, 1,
   2026, 'Av. Condell 850', 'Concepción', 'Región del Biobío', '4030000',
   ARRAY['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80'], ARRAY['Completamente amoblado', 'Entrega inmediata', 'Cerca del centro', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-73.05, -36.827), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-02T10:00:00Z'),

  ('7f5501ae-2b96-5cb8-bfeb-651b6dc293a2', 'Casa con Piscina en La Serena', 'Casa de 3 dormitorios con piscina, quincho y jardín.', 380000000, 'house',
   'for_sale', 3, 2, 180, 2,
   2026, 'Calle Los Carrera 1200', 'La Serena', 'Región de Coquimbo', '1700000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Piscina', 'Quincho', 'Jardín con riego', 'Escrituras al día'],
   ST_SetSRID(ST_MakePoint(-71.252, -29.902), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-01T10:00:00Z'),

  ('5e3aa9e7-96cf-59eb-af29-dbf6e9ca8075', 'Bodega Industrial en Rancagua', 'Amplia bodega industrial de 350m² con altura de 8 metros.', 180000000, 'warehouse',
   'for_sale', 0, 1, 350, 4,
   2015, 'Camino a San Fernando km 5', 'Rancagua', 'Región de O''Higgins', '2820000',
   ARRAY['https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1200&q=80'], ARRAY['Altura 8m', 'Piso hormigón pulido', 'Oficina integrada', 'Acceso camiones'],
   ST_SetSRID(ST_MakePoint(-70.74, -34.17), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-01T10:00:00Z'),

  ('a816984f-a987-552c-9b40-1e915536511a', 'Local Comercial en el Centro de Pucón', 'Local comercial de alto tránsito en plena arteria comercial de Pucón.', 250000000, 'local',
   'for_sale', 0, 2, 120, 2,
   2019, 'Av. Bernardo O''Higgins 520', 'Pucón', 'Región de La Araucanía', '4920000',
   ARRAY['https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista al Volcán', 'Alto tránsito', 'Amoblado', 'Calefacción por leña'],
   ST_SetSRID(ST_MakePoint(-71.967, -39.267), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-06T12:00:00Z'),

  ('07b86ec6-f31a-5a02-bede-7fa5c60250f2', 'Departamento 2D/1B Arriendo en Santiago Centro', 'Departamento moderno con vista a la Cordillera, cerca del Metro Sta. Lucía.', 450000, 'apartment',
   'for_rent', 2, 1, 65, 0,
   2020, 'Calle José Miguel de la Barra 450', 'Santiago', 'Región Metropolitana de Santiago', '8320000',
   ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista Cordillera', 'Cerca Metro', 'Amoblado', 'Bodega'],
   ST_SetSRID(ST_MakePoint(-70.6504, -33.4389), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-05T10:00:00Z'),

  ('85632416-6c51-5cda-bf10-40dfe6804006', 'Casa 3D/2B Arriendo en Viña del Mar', 'Casa residencial con jardín a pasos del mar.', 850000, 'house',
   'for_rent', 3, 2, 160, 2,
   2015, 'Av. Valparaíso 1800', 'Viña del Mar', 'Región de Valparaíso', '2520000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Jardín', 'Cerca del mar', 'Dos niveles', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-71.5532, -33.0153), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-04T10:00:00Z'),

  ('7f4b11ae-b5bf-5b70-829c-b07d276a517a', 'Oficina 80m² Arriendo en Providencia', 'Oficina luminosa con vista al parque, ideal para empresas pequeñas.', 650000, 'office',
   'for_rent', 0, 1, 80, 1,
   2018, 'Av. Providencia 1200', 'Providencia', 'Región Metropolitana de Santiago', '7500000',
   ARRAY['https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'], ARRAY['Luminosa', 'Vista parque', 'Sala de reuniones', 'Recepción'],
   ST_SetSRID(ST_MakePoint(-70.61, -33.425), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-03T10:00:00Z'),

  ('da4f148e-e7b7-5e76-9bb9-4e127795c0b7', 'Departamento Amoblado en Torre Marco Polo, Las Condes', 'Moderno departamento amoblado en la icónica Torre Marco Polo. Ubicado en el corazón de Las Condes, con vistas espectaculares a la ciudad y a la cordillera. Ideal para profesionales que buscan comodidad y una ubicación premium.', 1800000, 'apartment',
   'for_rent', 2, 2, 95, 1,
   2020, 'Av. Isabel Montt 1160, Piso 14', 'Las Condes', 'Región Metropolitana de Santiago', '7560000',
   ARRAY['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80'], ARRAY['Amoblado completo', 'Vista cordillera', 'Gimnasio', 'Salón de fiestas', 'Seguridad 24h', 'Estacionamiento techado'],
   ST_SetSRID(ST_MakePoint(-70.598, -33.4175), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   '/videos/promo-marco-polo.mp4', '/videos/promo-marco-polo-poster.jpg', 'catedral', '2026-09-15T10:00:00Z'),

  -- savills (6)
  ('08b4401a-df2e-51d8-a585-b4c38a89a8c0', 'Casa de Lujo con Vista Panorámica a los Andes en Lo Barnechea', 'Exclusiva residencia de lujo con vista panorámica a la Cordillera.', 1900000000, 'premium',
   'for_sale', 5, 4, 450, 3,
   2022, 'Av. La Dehesa 2340', 'Lo Barnechea', 'Región Metropolitana de Santiago', '7690000',
   ARRAY['https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista a los Andes', 'Piscina climatizada', 'Domótica', 'Seguridad 24h'],
   ST_SetSRID(ST_MakePoint(-70.5167, -33.352), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'savills', '2026-08-28T10:00:00Z'),

  ('fcd27135-b6fe-5071-8dd6-b0b0fa14277a', 'Departamento 3D/2B Venta en Providencia', 'Departamento premium con acabados de primera.', 520000000, 'apartment',
   'for_sale', 3, 2, 110, 1,
   2021, 'Av. Isabel Montt 800', 'Providencia', 'Región Metropolitana de Santiago', '7500000',
   ARRAY['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80'], ARRAY['Acabados premium', 'Bodega', 'Estacionamiento', 'Cerca Metro'],
   ST_SetSRID(ST_MakePoint(-70.605, -33.42), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'savills', '2026-09-01T10:00:00Z'),

  ('3619dcf3-061f-5123-b779-00b9d0253af9', 'Departamento 2D/2B Venta en Vitacura', 'Departamento moderno en sector premium de Vitacura.', 680000000, 'apartment',
   'for_sale', 2, 2, 95, 2,
   2023, 'Av. Isidora Goyenechea 3000', 'Vitacura', 'Región Metropolitana de Santiago', '7630000',
   ARRAY['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80'], ARRAY['Diseño moderno', 'Terraza', 'Gimnasio', 'Conserjería'],
   ST_SetSRID(ST_MakePoint(-70.57, -33.39), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'savills', '2026-09-02T10:00:00Z'),

  ('d9b06da7-81f9-5182-817c-f940828ca815', 'Departamento 3D/2B Arriendo en Las Condes', 'Departamento amplio con vista a la cordillera, sector premium.', 950000, 'apartment',
   'for_rent', 3, 2, 120, 2,
   2020, 'Av. Apoquindo 4500', 'Las Condes', 'Región Metropolitana de Santiago', '7550000',
   ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista cordillera', 'Amoblado', 'Gimnasio', 'Piscina'],
   ST_SetSRID(ST_MakePoint(-70.575, -33.405), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'savills', '2026-09-05T10:00:00Z'),

  ('ad034537-57cf-5762-90e6-0be72b6f9470', 'Departamento 2D/1B Arriendo en Vitacura', 'Departamento luminoso cerca del Mall Sport.', 650000, 'apartment',
   'for_rent', 2, 1, 75, 1,
   2019, 'Av. Bocanárita 200', 'Vitacura', 'Región Metropolitana de Santiago', '7630000',
   ARRAY['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80'], ARRAY['Luminoso', 'Cerca Mall Sport', 'Bodega', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-70.565, -33.395), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'savills', '2026-09-04T10:00:00Z'),

  ('1e925c81-11eb-5f34-9e7d-56d4192d6335', 'Casa 4D/3B Arriendo en Ñuñoa', 'Casaamiliar con amplio jardín en zona residencial.', 1200000, 'house',
   'for_rent', 4, 3, 200, 2,
   2010, 'Calle Grecia 1800', 'Ñuñoa', 'Región Metropolitana de Santiago', '7750000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Amplio jardín', 'Quincho', 'Dos niveles', 'Zona tranquila'],
   ST_SetSRID(ST_MakePoint(-70.595, -33.45), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'savills', '2026-09-03T10:00:00Z'),

  -- cbre (7)
  ('c55c2534-4463-58f2-b041-6217ce70bf2f', 'Proyecto Casas del Acantilado en Viña del Mar', '6 casas pareadas de diseño contemporáneo con vista al Pacífico.', 780000000, 'house',
   'for_sale', 4, 3, 280, 2,
   2027, 'Av. España 2100', 'Viña del Mar', 'Región de Valparaíso', '2520000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista al Pacífico', 'Piscina compartida', 'Diseño contemporáneo', 'Acceso al costanero'],
   ST_SetSRID(ST_MakePoint(-71.55, -33.015), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cbre', '2026-09-02T10:00:00Z'),

  ('a73f907e-3bc1-577d-ae2b-1c7fb456bcc0', 'Departamento 3D/2B Venta en Concepción', 'Departamento moderno cerca del centro comercial.', 290000000, 'apartment',
   'for_sale', 3, 2, 95, 1,
   2022, 'Av. Freire 650', 'Concepción', 'Región del Biobío', '4030000',
   ARRAY['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80'], ARRAY['Cerca centro comercial', 'Bodega', 'Estacionamiento', 'Salón de eventos'],
   ST_SetSRID(ST_MakePoint(-73.045, -36.825), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cbre', '2026-09-01T10:00:00Z'),

  ('46ee66ea-6da2-50da-9c28-2c3bd7af3939', 'Departamento 2D/1B Venta en Temuco', 'Departamento nuevo con vista al Lago.', 220000000, 'apartment',
   'for_sale', 2, 1, 70, 1,
   2023, 'Av. Alemania 1000', 'Temuco', 'Región de La Araucanía', '4780000',
   ARRAY['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista Lago', 'Nuevo', 'Bodega', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-72.6, -38.735), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cbre', '2026-09-02T10:00:00Z'),

  ('0fb9160f-913f-59d0-909f-c123ed585697', 'Departamento 2D/1B Arriendo en Santiago Centro', 'Departamento céntrico con vista a la Plaza de Armas.', 520000, 'apartment',
   'for_rent', 2, 1, 60, 0,
   2018, 'Calle Moneda 500', 'Santiago', 'Región Metropolitana de Santiago', '8320000',
   ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'], ARRAY['Céntrico', 'Vista Plaza', 'Cerca Metro', 'Amoblado'],
   ST_SetSRID(ST_MakePoint(-70.653, -33.442), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cbre', '2026-09-05T10:00:00Z'),

  ('24a7c84f-0d8c-57f5-95da-72b938282b0a', 'Casa 3D/2B Arriendo en La Florida', 'Casaamiliar con jardín en zona residencial tranquila.', 750000, 'house',
   'for_rent', 3, 2, 150, 2,
   2012, 'Av. Vicuña Mackenna 8000', 'La Florida', 'Región Metropolitana de Santiago', '8240000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Jardín', 'Quincho', 'Dos niveles', 'Zona tranquila'],
   ST_SetSRID(ST_MakePoint(-70.595, -33.515), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cbre', '2026-09-04T10:00:00Z'),

  ('693fd991-5602-5235-94d3-bad54142a48b', 'Oficina 120m² Arriendo en Santiago', 'Oficina corporativa con vista panorámica.', 1100000, 'office',
   'for_rent', 0, 2, 120, 2,
   2019, 'Av. Isidora Goyenechea 2800', 'Las Condes', 'Región Metropolitana de Santiago', '7550000',
   ARRAY['https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista panorámica', 'Sala de juntas', 'Recepción', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-70.585, -33.408), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cbre', '2026-09-03T10:00:00Z'),

  ('5653f4d8-0f0b-503b-801c-de2d25626016', 'Estacionamiento Subterráneo Nivel -1 en El Golf, Las Condes', 'Estacionamiento con acceso controlado y seguridad 24/7 en pleno barrio financiero El Golf. Excelente maniobrabilidad y cercanía a ascensores.', 24000000, 'parking',
   'for_sale', 0, 0, 14, 1,
   2020, 'Av. Apoquindo 3000', 'Las Condes', 'Región Metropolitana de Santiago', '7550000',
   ARRAY['https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1200&q=80', 'https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80'], ARRAY['Subterráneo nivel -1', 'Acceso TAG / Tarjeta', 'Seguridad 24/7', 'Portón automático'],
   ST_SetSRID(ST_MakePoint(-70.598, -33.417), 4326)::geography,
   'Maximiliano Vial', 'maximiliano.vial@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cbre', '2026-09-02T10:00:00Z'),

  -- cushman-wakefield (6)
  ('fb7081e2-5852-5ded-95d4-a3332fb1a93a', 'Torre Residencial Penthouse Premium en Las Condes', 'Exclusivo Penthouse de 380m² con vista 360° a la Cordillera.', 2500000000, 'premium',
   'for_sale', 4, 4, 380, 4,
   2028, 'Av. Apoquindo 3500', 'Las Condes', 'Región Metropolitana de Santiago', '7550000',
   ARRAY['https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista 360° Cordillera', 'Penthouse en azotea', 'Coworking privado', 'Conserjería 24/7'],
   ST_SetSRID(ST_MakePoint(-70.595, -33.41), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-04T10:00:00Z'),

  ('23ceaad7-84f7-5995-a4c7-8058197c3070', 'Oficina 200m² Venta en Santiago', 'Oficina corporativa con certificación LEED.', 850000000, 'office',
   'for_sale', 0, 3, 200, 3,
   2021, 'Av. Libertador Bernardo O''Higgins 1400', 'Santiago', 'Región Metropolitana de Santiago', '8320000',
   ARRAY['https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80'], ARRAY['Certificación LEED', 'Acceso metro', 'Módulos flexibles', 'Lobby de mármol'],
   ST_SetSRID(ST_MakePoint(-70.653, -33.443), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-01T10:00:00Z'),

  ('a3be7cca-3c82-59b5-a863-339fecce3abe', 'Departamento 3D/2B Venta en Providencia', 'Departamento premium con vista al río Mapocho.', 620000000, 'apartment',
   'for_sale', 3, 2, 105, 1,
   2022, 'Av. Andrés Bello 2000', 'Providencia', 'Región Metropolitana de Santiago', '7500000',
   ARRAY['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista Río Mapocho', 'Terraza', 'Bodega', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-70.602, -33.418), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-01T10:00:00Z'),

  ('3a488e1b-50b0-5bfb-be1a-9855d8ea772a', 'Departamento 4D/3B Arriendo en Las Condes', 'Departamento de lujo con vista a la cordillera.', 1500000, 'apartment',
   'for_rent', 4, 3, 180, 2,
   2021, 'Av. Apoquindo 5000', 'Las Condes', 'Región Metropolitana de Santiago', '7550000',
   ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'], ARRAY['Lujo', 'Vista cordillera', 'Amoblado', 'Piscina'],
   ST_SetSRID(ST_MakePoint(-70.58, -33.4), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-05T10:00:00Z'),

  ('03c9b70e-c8d7-5ccf-8fb0-4595a6b99ebe', 'Oficina 150m² Arriendo en Providencia', 'Oficina moderna con vista al parque bustamante.', 980000, 'office',
   'for_rent', 0, 2, 150, 2,
   2020, 'Av. Italia 600', 'Providencia', 'Región Metropolitana de Santiago', '7500000',
   ARRAY['https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'], ARRAY['Vista parque', 'Sala de juntas', 'Recepción', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-70.615, -33.435), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-04T10:00:00Z'),

  ('29a11d16-9703-57e4-9afb-b4f624de2e21', 'Casa 4D/3B Arriendo en Maipú', 'Casaamiliar con amplio jardín y quincho.', 850000, 'house',
   'for_rent', 4, 3, 180, 2,
   2015, 'Av. 5 de Abril 3000', 'Maipú', 'Región Metropolitana de Santiago', '9250000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Amplio jardín', 'Quincho', 'Dos niveles', 'Zona familiar'],
   ST_SetSRID(ST_MakePoint(-70.755, -33.51), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'cushman-wakefield', '2026-09-03T10:00:00Z'),

  -- Temuco / Concepción (6) — atribuidas a Catedral
  ('2452df8c-46b0-5761-a825-9ddb48928922', 'Parque Industrial Temuco — Terrenos Habilitados', 'Terrenos industriales de 2.000m² a 5.000m² con servicios básicos.', 45000000, 'land',
   'for_sale', 0, 0, 3500, 0,
   2028, 'Ruta 5 Sur km 830', 'Temuco', 'Región de La Araucanía', '4780000',
   ARRAY['https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80'], ARRAY['Servicios básicos', 'Closura perimetral', 'Acceso camionero', 'Zona industrial'],
   ST_SetSRID(ST_MakePoint(-72.6, -38.735), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-03T10:00:00Z'),

  ('9aa9f014-c012-58ff-a17d-92e9b21ab4f5', 'Departamento 2D/1B Venta en Temuco', 'Departamento nuevo con vista al Lago.', 195000000, 'apartment',
   'for_sale', 2, 1, 65, 1,
   2023, 'Av. Caupolicán 500', 'Temuco', 'Región de La Araucanía', '4780000',
   ARRAY['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80'], ARRAY['Nuevo', 'Vista Lago', 'Bodega', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-72.598, -38.738), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-02T10:00:00Z'),

  ('593b85d3-3deb-50ef-8e98-4f8349d563ce', 'Casa 3D/2B Venta en Concepción', 'Casaamiliar con jardín en sector residencial.', 320000000, 'house',
   'for_sale', 3, 2, 160, 2,
   2018, 'Calle Higgins 1500', 'Concepción', 'Región del Biobío', '4030000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Jardín', 'Quincho', 'Dos niveles', 'Zona residencial'],
   ST_SetSRID(ST_MakePoint(-73.055, -36.83), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-01T10:00:00Z'),

  ('12410d01-200c-5c11-8947-192c9d45b55b', 'Departamento 2D/1B Arriendo en Temuco', 'Departamento céntrico cerca de la Universidad.', 380000, 'apartment',
   'for_rent', 2, 1, 55, 0,
   2019, 'Av. Arturo Prat 800', 'Temuco', 'Región de La Araucanía', '4780000',
   ARRAY['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'], ARRAY['Céntrico', 'Cerca Universidad', 'Amoblado', 'Bodega'],
   ST_SetSRID(ST_MakePoint(-72.602, -38.736), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-05T10:00:00Z'),

  ('143baf7d-6cab-5c11-9d35-5f21e2c70833', 'Casa 3D/2B Arriendo en Concepción', 'Casaamiliar con jardín cerca del centro.', 650000, 'house',
   'for_rent', 3, 2, 140, 2,
   2016, 'Av. Lincoyán 900', 'Concepción', 'Región del Biobío', '4030000',
   ARRAY['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'], ARRAY['Jardín', 'Cerca centro', 'Dos niveles', 'Zona tranquila'],
   ST_SetSRID(ST_MakePoint(-73.048, -36.828), 4326)::geography,
   'Rodrigo Altamirano', 'rodrigo.altamirano@rix7.cl', '+56 9 5555 1234', NULL,
   NULL, NULL, 'catedral', '2026-09-04T10:00:00Z'),

  ('b633effd-231f-567e-a9e9-935f93b49e8b', 'Local Comercial 100m² Arriendo en Temuco', 'Local comercial en zona de alto tránsito.', 550000, 'local',
   'for_rent', 0, 1, 100, 1,
   2017, 'Av. Pedro de Valdivia 1200', 'Temuco', 'Región de La Araucanía', '4780000',
   ARRAY['https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80'], ARRAY['Alto tránsito', 'Amoblado', 'Calefacción', 'Estacionamiento'],
   ST_SetSRID(ST_MakePoint(-72.601, -38.737), 4326)::geography,
   'Camila Undurraga', 'camila.undurraga@rix7.cl', '+56 9 8765 4321', NULL,
   NULL, NULL, 'catedral', '2026-09-03T10:00:00Z'),

  -- colliers (1)
  ('5a3e4b40-1942-567f-8e4a-31273bd9245e', 'Estacionamiento Techado con TAG en Providencia', 'Estacionamiento individual con acceso directo y portón automático a pasos de Metro Manuel Montt.', 110000, 'parking',
   'for_rent', 0, 0, 13, 1,
   2018, 'Av. Providencia 1350', 'Providencia', 'Región Metropolitana de Santiago', '7500000',
   ARRAY['https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80'], ARRAY['Cámaras CCTV', 'Conserjería 24 hrs', 'Control remoto', 'Techado'],
   ST_SetSRID(ST_MakePoint(-70.615, -33.428), 4326)::geography,
   'Ignacio Valdés', 'ignacio.valdes@rix7.cl', '+56 9 4444 7890', NULL,
   NULL, NULL, 'colliers', '2026-09-01T10:00:00Z')
ON CONFLICT (id) DO NOTHING;
