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
-- 1. Vitacura (VIP)
(
    'Exclusiva Residencia VIP con Terraza Panorámica en Nueva Costanera',
    'Impresionante residencia VIP en Nueva Costanera con vista despejada a la cordillera y Parque Bicentenario. Finas terminaciones, piso de madera de ingeniería, cocina italiana con isla de cuarzo y terraza privada con quincho integrado.',
    890000000,
    'vip',
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
-- 6. Zapallar (VIP)
(
    'Exclusiva Casa de Playa con Vista a la Bahía en Zapallar',
    'Residencia en lomaje de Zapallar con arquitectura en piedra y maderas nobles. Senderos privados, jardines costeros y terraza con vista a la bahía.',
    1450000000,
    'vip',
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
-- 9. Pucón (VIP)
(
    'Casa VIP a Orillas del Lago Villarrica con Muelle Privado en Pucón',
    'Maravillosa casa construida en ciprés y piedra volcánica a orillas del Lago Villarrica. Muelle para embarcaciones, playa privada y vista despejada al Volcán.',
    980000000,
    'vip',
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
-- 12. Valdivia (VIP)
(
    'Casona Ribereña con Muelle en Isla Teja / Valdivia',
    'Impresionante propiedad en Isla Teja con 60 metros de orilla de río y muelle privado para kayak y lanchas. Bosque de arrayanes y calefacción a leña con radiadores.',
    680000000,
    'vip',
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
-- Migración de las 11 corredoras que antes vivían en memoria en
-- `lib/data/partners.ts`. Los teléfonos son PLACEHOLDER con el patrón de
-- relleno del proyecto (+56 2 2000 00XX / +56 9 0000 00XX): reemplazarlos por
-- los reales de cada corredora desde /admin/empresas.
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
     '+56 2 2000 0008', '+56 9 0000 0008', 'contacto@inelbrok.cl', 7),

    ('.portal-inmobiliario', 'portal-inmobiliario', 'Portal Inmobiliario', '/logos/portalinmobiliario.png',
     'El portal líder de propiedades en Chile', 'https://www.portalinmobiliario.com', '#FF6600',
     '+56 2 2000 0009', '+56 9 0000 0009', 'contacto@portalinmobiliario.com', 8),

    ('toctoc', 'toctoc', 'Toctoc.com', '/logos/toctoc.png',
     'Plataforma digital de compra y arriendo de propiedades', 'https://www.toctoc.com', '#00C853',
     '+56 2 2000 0010', '+56 9 0000 0010', 'contacto@toctoc.com', 9),

    ('yapo', 'yapo', 'Yapo.cl', '/logos/yapo.png',
     'Portal de clasificados con sección inmobiliaria líder', 'https://www.yapo.cl', '#FFC107',
     '+56 2 2000 0011', '+56 9 0000 0011', 'contacto@yapo.cl', 10)
ON CONFLICT (id) DO NOTHING;
