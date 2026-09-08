export interface Commune {
  name: string;
  lat: number;
  lng: number;
  zoom?: number;
}

export interface Region {
  code: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  communes: Commune[];
}

export const CHILE_REGIONS: Region[] = [
  // ═══════════════════════════════════════════════════════════════
  // 1. REGIÓN DE ARICA Y PARINACOTA (4 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XV',
    name: 'Arica y Parinacota',
    lat: -18.4783,
    lng: -70.3126,
    zoom: 11,
    communes: [
      { name: 'Arica', lat: -18.4783, lng: -70.3126, zoom: 13 },
      { name: 'Camarones', lat: -19.0142, lng: -69.8647, zoom: 12 },
      { name: 'General Lagos', lat: -17.7011, lng: -69.6056, zoom: 11 },
      { name: 'Putre', lat: -18.1965, lng: -69.5594, zoom: 12 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. REGIÓN DE TARAPACÁ (7 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'I',
    name: 'Tarapacá',
    lat: -20.2167,
    lng: -70.1500,
    zoom: 11,
    communes: [
      { name: 'Alto Hospicio', lat: -20.2678, lng: -70.1089, zoom: 13 },
      { name: 'Camiña', lat: -19.3142, lng: -69.4261, zoom: 12 },
      { name: 'Colchane', lat: -19.2778, lng: -68.6389, zoom: 12 },
      { name: 'Huara', lat: -19.9961, lng: -69.7711, zoom: 12 },
      { name: 'Iquique', lat: -20.2167, lng: -70.1500, zoom: 13 },
      { name: 'Pica', lat: -20.4897, lng: -69.3297, zoom: 13 },
      { name: 'Pozo Almonte', lat: -20.2597, lng: -69.7861, zoom: 12 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. REGIÓN DE ANTOFAGASTA (9 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'II',
    name: 'Antofagasta',
    lat: -23.6500,
    lng: -70.4000,
    zoom: 11,
    communes: [
      { name: 'Antofagasta', lat: -23.6500, lng: -70.4000, zoom: 13 },
      { name: 'Calama', lat: -22.4667, lng: -68.9333, zoom: 13 },
      { name: 'María Elena', lat: -22.3456, lng: -69.6644, zoom: 13 },
      { name: 'Mejillones', lat: -23.1000, lng: -70.4500, zoom: 13 },
      { name: 'Ollagüe', lat: -21.2222, lng: -68.2528, zoom: 12 },
      { name: 'San Pedro de Atacama', lat: -22.9167, lng: -68.2000, zoom: 13 },
      { name: 'Sierra Gorda', lat: -22.8833, lng: -69.3167, zoom: 12 },
      { name: 'Taltal', lat: -25.4000, lng: -70.4833, zoom: 13 },
      { name: 'Tocopilla', lat: -22.0833, lng: -70.2000, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 4. REGIÓN DE ATACAMA (9 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'III',
    name: 'Atacama',
    lat: -27.3667,
    lng: -70.3333,
    zoom: 11,
    communes: [
      { name: 'Alto del Carmen', lat: -28.7583, lng: -70.4861, zoom: 12 },
      { name: 'Caldera', lat: -27.0667, lng: -70.8167, zoom: 13 },
      { name: 'Chañaral', lat: -26.3500, lng: -70.6167, zoom: 13 },
      { name: 'Copiapó', lat: -27.3667, lng: -70.3333, zoom: 13 },
      { name: 'Diego de Almagro', lat: -26.3917, lng: -70.0472, zoom: 13 },
      { name: 'Freirina', lat: -28.5083, lng: -71.0778, zoom: 13 },
      { name: 'Huasco', lat: -28.4667, lng: -71.2167, zoom: 13 },
      { name: 'Tierra Amarilla', lat: -27.4833, lng: -70.2667, zoom: 13 },
      { name: 'Vallenar', lat: -28.5750, lng: -70.7583, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 5. REGIÓN DE COQUIMBO (15 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'IV',
    name: 'Coquimbo',
    lat: -29.9027,
    lng: -71.2519,
    zoom: 11,
    communes: [
      { name: 'Andacollo', lat: -30.2319, lng: -71.0850, zoom: 13 },
      { name: 'Canela', lat: -31.4000, lng: -71.4500, zoom: 12 },
      { name: 'Combarbalá', lat: -31.1794, lng: -71.0033, zoom: 13 },
      { name: 'Coquimbo', lat: -29.9533, lng: -71.3436, zoom: 13 },
      { name: 'Illapel', lat: -31.6308, lng: -71.1653, zoom: 13 },
      { name: 'La Higuera', lat: -29.5100, lng: -71.2000, zoom: 12 },
      { name: 'La Serena', lat: -29.9027, lng: -71.2519, zoom: 13 },
      { name: 'Los Vilos', lat: -31.9133, lng: -71.5119, zoom: 13 },
      { name: 'Monte Patria', lat: -30.6947, lng: -70.9572, zoom: 13 },
      { name: 'Ovalle', lat: -30.5983, lng: -71.2003, zoom: 13 },
      { name: 'Paiguano', lat: -30.0269, lng: -70.5183, zoom: 13 },
      { name: 'Punitaqui', lat: -30.8286, lng: -71.2592, zoom: 13 },
      { name: 'Río Hurtado', lat: -30.2789, lng: -70.6978, zoom: 12 },
      { name: 'Salamanca', lat: -31.7789, lng: -70.9639, zoom: 13 },
      { name: 'Vicuña', lat: -30.0319, lng: -70.7081, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 6. REGIÓN DE VALPARAÍSO (38 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'V',
    name: 'Valparaíso',
    lat: -33.0472,
    lng: -71.6127,
    zoom: 11,
    communes: [
      { name: 'Algarrobo', lat: -33.3667, lng: -71.6667, zoom: 14 },
      { name: 'Cabildo', lat: -32.4289, lng: -71.0667, zoom: 13 },
      { name: 'Calle Larga', lat: -32.8592, lng: -70.6231, zoom: 13 },
      { name: 'Cartagena', lat: -33.5539, lng: -71.6081, zoom: 13 },
      { name: 'Casablanca', lat: -33.3167, lng: -71.4000, zoom: 13 },
      { name: 'Catemu', lat: -32.7781, lng: -70.9639, zoom: 13 },
      { name: 'Concón', lat: -32.9233, lng: -71.5175, zoom: 13 },
      { name: 'El Quisco', lat: -33.3981, lng: -71.6967, zoom: 14 },
      { name: 'El Tabo', lat: -33.4542, lng: -71.6667, zoom: 14 },
      { name: 'Hijuelas', lat: -32.7972, lng: -71.1444, zoom: 13 },
      { name: 'Isla de Pascua', lat: -27.1127, lng: -109.3497, zoom: 12 },
      { name: 'Juan Fernández', lat: -33.6369, lng: -78.8319, zoom: 12 },
      { name: 'La Calera', lat: -32.7878, lng: -71.1919, zoom: 13 },
      { name: 'La Cruz', lat: -32.8278, lng: -71.2289, zoom: 13 },
      { name: 'La Ligua', lat: -32.4500, lng: -71.2333, zoom: 13 },
      { name: 'Limache', lat: -32.9856, lng: -71.2678, zoom: 13 },
      { name: 'Llaillay', lat: -32.8444, lng: -70.9556, zoom: 13 },
      { name: 'Los Andes', lat: -32.8339, lng: -70.5983, zoom: 13 },
      { name: 'Nogales', lat: -32.7389, lng: -71.2000, zoom: 13 },
      { name: 'Olmué', lat: -32.9972, lng: -71.1861, zoom: 13 },
      { name: 'Panquehue', lat: -32.7667, lng: -70.8333, zoom: 13 },
      { name: 'Papudo', lat: -32.5083, lng: -71.4500, zoom: 14 },
      { name: 'Petorca', lat: -32.2533, lng: -70.9322, zoom: 13 },
      { name: 'Puchuncaví', lat: -32.7214, lng: -71.4111, zoom: 13 },
      { name: 'Putaendo', lat: -32.6275, lng: -70.7164, zoom: 13 },
      { name: 'Quillota', lat: -32.8800, lng: -71.2486, zoom: 13 },
      { name: 'Quilpué', lat: -33.0494, lng: -71.4428, zoom: 13 },
      { name: 'Quintero', lat: -32.7781, lng: -71.5317, zoom: 13 },
      { name: 'Rinconada', lat: -32.8681, lng: -70.7022, zoom: 13 },
      { name: 'San Antonio', lat: -33.5936, lng: -71.6078, zoom: 13 },
      { name: 'San Esteban', lat: -32.7969, lng: -70.5786, zoom: 13 },
      { name: 'San Felipe', lat: -32.7506, lng: -70.7256, zoom: 13 },
      { name: 'Santa María', lat: -32.7483, lng: -70.6592, zoom: 13 },
      { name: 'Santo Domingo', lat: -33.6361, lng: -71.6278, zoom: 14 },
      { name: 'Valparaíso', lat: -33.0472, lng: -71.6127, zoom: 13 },
      { name: 'Villa Alemana', lat: -33.0431, lng: -71.3736, zoom: 13 },
      { name: 'Viña del Mar', lat: -33.0245, lng: -71.5518, zoom: 13 },
      { name: 'Zapallar', lat: -32.5539, lng: -71.4608, zoom: 14 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 7. REGIÓN METROPOLITANA DE SANTIAGO (52 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XIII',
    name: 'Región Metropolitana de Santiago',
    lat: -33.4489,
    lng: -70.6693,
    zoom: 11,
    communes: [
      { name: 'Alhué', lat: -34.0333, lng: -71.1000, zoom: 12 },
      { name: 'Buin', lat: -33.7333, lng: -70.7333, zoom: 13 },
      { name: 'Calera de Tango', lat: -33.6333, lng: -70.7833, zoom: 13 },
      { name: 'Cerrillos', lat: -33.5000, lng: -70.7167, zoom: 14 },
      { name: 'Cerro Navia', lat: -33.4228, lng: -70.7381, zoom: 14 },
      { name: 'Colina', lat: -33.2000, lng: -70.6833, zoom: 12 },
      { name: 'Conchalí', lat: -33.3839, lng: -70.6781, zoom: 14 },
      { name: 'Curacaví', lat: -33.4089, lng: -71.1367, zoom: 13 },
      { name: 'El Bosque', lat: -33.5606, lng: -70.6739, zoom: 14 },
      { name: 'El Monte', lat: -33.6806, lng: -71.0189, zoom: 13 },
      { name: 'Estación Central', lat: -33.4619, lng: -70.6978, zoom: 14 },
      { name: 'Huechuraba', lat: -33.3742, lng: -70.6389, zoom: 14 },
      { name: 'Independencia', lat: -33.4167, lng: -70.6667, zoom: 14 },
      { name: 'Isla de Maipo', lat: -33.7500, lng: -70.9000, zoom: 13 },
      { name: 'La Cisterna', lat: -33.5289, lng: -70.6631, zoom: 14 },
      { name: 'La Florida', lat: -33.5228, lng: -70.5639, zoom: 13 },
      { name: 'La Granja', lat: -33.5350, lng: -70.6231, zoom: 14 },
      { name: 'La Pintana', lat: -33.5833, lng: -70.6333, zoom: 13 },
      { name: 'La Reina', lat: -33.4419, lng: -70.5369, zoom: 14 },
      { name: 'Lampa', lat: -33.2833, lng: -70.8667, zoom: 12 },
      { name: 'Las Condes', lat: -33.4117, lng: -70.5678, zoom: 13 },
      { name: 'Lo Barnechea', lat: -33.3500, lng: -70.5167, zoom: 13 },
      { name: 'Lo Espejo', lat: -33.5222, lng: -70.6917, zoom: 14 },
      { name: 'Lo Prado', lat: -33.4444, lng: -70.7250, zoom: 14 },
      { name: 'Macul', lat: -33.4889, lng: -70.5989, zoom: 14 },
      { name: 'Maipú', lat: -33.5108, lng: -70.7572, zoom: 13 },
      { name: 'María Pinto', lat: -33.5167, lng: -71.1167, zoom: 12 },
      { name: 'Melipilla', lat: -33.6897, lng: -71.2156, zoom: 13 },
      { name: 'Padre Hurtado', lat: -33.5667, lng: -70.8167, zoom: 13 },
      { name: 'Paine', lat: -33.8167, lng: -70.7500, zoom: 13 },
      { name: 'Pedro Aguirre Cerda', lat: -33.4889, lng: -70.6806, zoom: 14 },
      { name: 'Peñaflor', lat: -33.6083, lng: -70.8778, zoom: 13 },
      { name: 'Peñalolén', lat: -33.4833, lng: -70.5333, zoom: 13 },
      { name: 'Pirque', lat: -33.6333, lng: -70.5667, zoom: 13 },
      { name: 'Providencia', lat: -33.4314, lng: -70.6128, zoom: 14 },
      { name: 'Pudahuel', lat: -33.4400, lng: -70.7600, zoom: 13 },
      { name: 'Puente Alto', lat: -33.6167, lng: -70.5833, zoom: 13 },
      { name: 'Quilicura', lat: -33.3667, lng: -70.7333, zoom: 13 },
      { name: 'Quinta Normal', lat: -33.4267, lng: -70.6933, zoom: 14 },
      { name: 'Recoleta', lat: -33.4072, lng: -70.6369, zoom: 14 },
      { name: 'Renca', lat: -33.4056, lng: -70.7297, zoom: 14 },
      { name: 'San Bernardo', lat: -33.6000, lng: -70.7000, zoom: 13 },
      { name: 'San Joaquín', lat: -33.4950, lng: -70.6278, zoom: 14 },
      { name: 'San José de Maipo', lat: -33.6397, lng: -70.3517, zoom: 12 },
      { name: 'San Miguel', lat: -33.4939, lng: -70.6517, zoom: 14 },
      { name: 'San Pedro', lat: -33.9000, lng: -71.4500, zoom: 12 },
      { name: 'San Ramón', lat: -33.5333, lng: -70.6433, zoom: 14 },
      { name: 'Santiago', lat: -33.4489, lng: -70.6693, zoom: 13 },
      { name: 'Talagante', lat: -33.6644, lng: -70.9272, zoom: 13 },
      { name: 'Til Til', lat: -33.0833, lng: -70.9333, zoom: 12 },
      { name: 'Vitacura', lat: -33.3833, lng: -70.5667, zoom: 14 },
      { name: 'Ñuñoa', lat: -33.4569, lng: -70.5975, zoom: 14 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 8. REGIÓN DEL LIBERTADOR GRAL. BERNARDO O'HIGGINS (33 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'VI',
    name: "Libertador Gral. Bernardo O'Higgins",
    lat: -34.1708,
    lng: -70.7444,
    zoom: 11,
    communes: [
      { name: 'Chimbarongo', lat: -34.7083, lng: -71.0444, zoom: 13 },
      { name: 'Chépica', lat: -34.7361, lng: -71.2833, zoom: 13 },
      { name: 'Codegua', lat: -34.0333, lng: -70.6667, zoom: 13 },
      { name: 'Coinco', lat: -34.2700, lng: -70.9700, zoom: 13 },
      { name: 'Coltauco', lat: -34.2833, lng: -71.0833, zoom: 13 },
      { name: 'Doñihue', lat: -34.2333, lng: -70.9667, zoom: 13 },
      { name: 'Graneros', lat: -34.0667, lng: -70.7333, zoom: 13 },
      { name: 'La Estrella', lat: -34.2000, lng: -71.7500, zoom: 12 },
      { name: 'Las Cabras', lat: -34.2900, lng: -71.3100, zoom: 13 },
      { name: 'Litueche', lat: -34.1200, lng: -71.7200, zoom: 12 },
      { name: 'Lolol', lat: -34.7200, lng: -71.6400, zoom: 13 },
      { name: 'Machalí', lat: -34.1833, lng: -70.6500, zoom: 13 },
      { name: 'Malloa', lat: -34.4400, lng: -70.9500, zoom: 13 },
      { name: 'Marchigüe', lat: -34.3900, lng: -71.6200, zoom: 12 },
      { name: 'Mostazal', lat: -33.9833, lng: -70.7000, zoom: 13 },
      { name: 'Nancagua', lat: -34.6700, lng: -71.2000, zoom: 13 },
      { name: 'Navidad', lat: -33.9547, lng: -71.8319, zoom: 13 },
      { name: 'Olivar', lat: -34.2000, lng: -70.8200, zoom: 13 },
      { name: 'Palmilla', lat: -34.6000, lng: -71.3700, zoom: 13 },
      { name: 'Paredones', lat: -34.6600, lng: -71.9000, zoom: 13 },
      { name: 'Peralillo', lat: -34.4900, lng: -71.4900, zoom: 13 },
      { name: 'Peumo', lat: -34.4000, lng: -71.1700, zoom: 13 },
      { name: 'Pichidegua', lat: -34.3700, lng: -71.2800, zoom: 13 },
      { name: 'Pichilemu', lat: -34.3878, lng: -72.0047, zoom: 14 },
      { name: 'Placilla', lat: -34.6200, lng: -71.0800, zoom: 13 },
      { name: 'Pumanque', lat: -34.5700, lng: -71.6800, zoom: 13 },
      { name: 'Quinta de Tilcoco', lat: -34.3600, lng: -71.0300, zoom: 13 },
      { name: 'Rancagua', lat: -34.1708, lng: -70.7444, zoom: 13 },
      { name: 'Rengo', lat: -34.4081, lng: -70.8589, zoom: 13 },
      { name: 'Requínoa', lat: -34.2833, lng: -70.8167, zoom: 13 },
      { name: 'San Fernando', lat: -34.5839, lng: -70.9889, zoom: 13 },
      { name: 'San Vicente', lat: -34.4394, lng: -71.0772, zoom: 13 },
      { name: 'Santa Cruz', lat: -34.6392, lng: -71.3644, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 9. REGIÓN DEL MAULE (30 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'VII',
    name: 'Maule',
    lat: -35.4264,
    lng: -71.6556,
    zoom: 11,
    communes: [
      { name: 'Cauquenes', lat: -35.9667, lng: -72.3167, zoom: 13 },
      { name: 'Chanco', lat: -35.7333, lng: -72.5333, zoom: 13 },
      { name: 'Colbún', lat: -35.6833, lng: -71.4833, zoom: 13 },
      { name: 'Constitución', lat: -35.3333, lng: -72.4167, zoom: 13 },
      { name: 'Curepto', lat: -35.0833, lng: -72.0167, zoom: 13 },
      { name: 'Curicó', lat: -34.9833, lng: -71.2333, zoom: 13 },
      { name: 'Empedrado', lat: -35.6000, lng: -72.2833, zoom: 13 },
      { name: 'Hualañé', lat: -34.9700, lng: -71.8000, zoom: 13 },
      { name: 'Licantén', lat: -34.9800, lng: -72.0200, zoom: 13 },
      { name: 'Linares', lat: -35.8500, lng: -71.6000, zoom: 13 },
      { name: 'Longaví', lat: -35.9700, lng: -71.6833, zoom: 13 },
      { name: 'Maule', lat: -35.5200, lng: -71.7200, zoom: 13 },
      { name: 'Molina', lat: -35.1167, lng: -71.2833, zoom: 13 },
      { name: 'Parral', lat: -36.1500, lng: -71.8333, zoom: 13 },
      { name: 'Pelarco', lat: -35.3333, lng: -71.4333, zoom: 13 },
      { name: 'Pelluhue', lat: -35.8200, lng: -72.5700, zoom: 13 },
      { name: 'Pencahue', lat: -35.4000, lng: -71.8200, zoom: 13 },
      { name: 'Rauco', lat: -34.9300, lng: -71.2800, zoom: 13 },
      { name: 'Retiro', lat: -36.0500, lng: -71.7500, zoom: 13 },
      { name: 'Romeral', lat: -34.9700, lng: -71.1300, zoom: 13 },
      { name: 'Río Claro', lat: -35.2833, lng: -71.2500, zoom: 13 },
      { name: 'Sagrada Familia', lat: -35.0000, lng: -71.3833, zoom: 13 },
      { name: 'San Clemente', lat: -35.5333, lng: -71.4833, zoom: 13 },
      { name: 'San Javier', lat: -35.5833, lng: -71.7333, zoom: 13 },
      { name: 'San Rafael', lat: -35.3000, lng: -71.5200, zoom: 13 },
      { name: 'Talca', lat: -35.4264, lng: -71.6556, zoom: 13 },
      { name: 'Teno', lat: -34.8700, lng: -71.1700, zoom: 13 },
      { name: 'Vichuquén', lat: -34.8400, lng: -72.0000, zoom: 13 },
      { name: 'Villa Alegre', lat: -35.6833, lng: -71.7333, zoom: 13 },
      { name: 'Yerbas Buenas', lat: -35.7500, lng: -71.5700, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 10. REGIÓN DE ÑUBLE (21 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XVI',
    name: 'Ñuble',
    lat: -36.6200,
    lng: -72.1000,
    zoom: 11,
    communes: [
      { name: 'Bulnes', lat: -36.7433, lng: -72.3000, zoom: 13 },
      { name: 'Chillán', lat: -36.6000, lng: -72.1000, zoom: 13 },
      { name: 'Chillán Viejo', lat: -36.6333, lng: -72.1333, zoom: 13 },
      { name: 'Cobquecura', lat: -36.1333, lng: -71.9000, zoom: 12 },
      { name: 'Coelemu', lat: -36.4833, lng: -72.7000, zoom: 13 },
      { name: 'Coihueco', lat: -36.6333, lng: -71.8333, zoom: 13 },
      { name: 'El Carmen', lat: -36.9000, lng: -72.0200, zoom: 13 },
      { name: 'Ñiquén', lat: -36.4000, lng: -71.9000, zoom: 13 },
      { name: 'Ninhue', lat: -36.4000, lng: -72.4000, zoom: 13 },
      { name: 'Pemuco', lat: -36.9833, lng: -72.1000, zoom: 13 },
      { name: 'Pinto', lat: -36.6333, lng: -71.9000, zoom: 13 },
      { name: 'Portezuelo', lat: -36.5333, lng: -72.4333, zoom: 13 },
      { name: 'Quillón', lat: -36.7833, lng: -72.4700, zoom: 13 },
      { name: 'Quirihue', lat: -36.2833, lng: -72.5500, zoom: 13 },
      { name: 'Ranquil', lat: -36.6200, lng: -72.6200, zoom: 12 },
      { name: 'San Carlos', lat: -36.4200, lng: -71.9500, zoom: 13 },
      { name: 'San Fabián', lat: -36.5500, lng: -71.5500, zoom: 13 },
      { name: 'San Ignacio', lat: -36.8000, lng: -72.0200, zoom: 13 },
      { name: 'San Nicolás', lat: -36.5000, lng: -72.2200, zoom: 13 },
      { name: 'Treguaco', lat: -36.4400, lng: -72.6800, zoom: 13 },
      { name: 'Yungay', lat: -37.1200, lng: -72.0200, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 11. REGIÓN DEL BIOBÍO (33 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'VIII',
    name: 'Biobío',
    lat: -36.8270,
    lng: -73.0503,
    zoom: 11,
    communes: [
      { name: 'Alto Biobío', lat: -37.8833, lng: -71.7167, zoom: 11 },
      { name: 'Antuco', lat: -37.3333, lng: -71.6833, zoom: 12 },
      { name: 'Arauco', lat: -37.2333, lng: -73.3167, zoom: 13 },
      { name: 'Cabrero', lat: -37.0333, lng: -72.4000, zoom: 13 },
      { name: 'Cañete', lat: -37.8000, lng: -73.3833, zoom: 13 },
      { name: 'Chiguayante', lat: -36.9167, lng: -73.0333, zoom: 13 },
      { name: 'Concepción', lat: -36.8270, lng: -73.0503, zoom: 13 },
      { name: 'Contulmo', lat: -38.0167, lng: -73.2333, zoom: 13 },
      { name: 'Coronel', lat: -37.0167, lng: -73.1500, zoom: 13 },
      { name: 'Curanilahue', lat: -37.4667, lng: -73.3500, zoom: 13 },
      { name: 'Florida', lat: -36.8167, lng: -72.6667, zoom: 13 },
      { name: 'Hualpén', lat: -36.7889, lng: -73.0972, zoom: 13 },
      { name: 'Hualqui', lat: -36.9667, lng: -72.9333, zoom: 13 },
      { name: 'Laja', lat: -37.2833, lng: -72.7167, zoom: 13 },
      { name: 'Lebu', lat: -37.6000, lng: -73.6500, zoom: 13 },
      { name: 'Los Álamos', lat: -37.6333, lng: -73.4667, zoom: 13 },
      { name: 'Los Ángeles', lat: -37.4667, lng: -72.3500, zoom: 13 },
      { name: 'Lota', lat: -37.0833, lng: -73.1667, zoom: 13 },
      { name: 'Mulchén', lat: -37.7167, lng: -72.2333, zoom: 13 },
      { name: 'Nacimiento', lat: -37.5000, lng: -72.6667, zoom: 13 },
      { name: 'Negrete', lat: -37.5833, lng: -72.5167, zoom: 13 },
      { name: 'Penco', lat: -36.7333, lng: -72.9833, zoom: 13 },
      { name: 'Quilaco', lat: -37.6833, lng: -72.7167, zoom: 13 },
      { name: 'Quilleco', lat: -37.4667, lng: -72.4667, zoom: 13 },
      { name: 'San Pedro de la Paz', lat: -36.8406, lng: -73.1006, zoom: 13 },
      { name: 'San Rosendo', lat: -37.2667, lng: -72.7167, zoom: 13 },
      { name: 'Santa Bárbara', lat: -37.6667, lng: -72.0167, zoom: 13 },
      { name: 'Santa Juana', lat: -37.1667, lng: -72.9333, zoom: 13 },
      { name: 'Talcahuano', lat: -36.7167, lng: -73.1167, zoom: 13 },
      { name: 'Tirúa', lat: -38.3333, lng: -73.5000, zoom: 13 },
      { name: 'Tomé', lat: -36.6167, lng: -72.9500, zoom: 13 },
      { name: 'Tucapel', lat: -37.4500, lng: -72.5667, zoom: 13 },
      { name: 'Yumbel', lat: -37.1000, lng: -72.5667, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 12. REGIÓN DE LA ARAUCANÍA (32 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'IX',
    name: 'La Araucanía',
    lat: -38.7359,
    lng: -72.5904,
    zoom: 11,
    communes: [
      { name: 'Angol', lat: -37.8000, lng: -72.7167, zoom: 13 },
      { name: 'Carahue', lat: -38.7000, lng: -73.1667, zoom: 13 },
      { name: 'Cholchol', lat: -38.6000, lng: -72.8500, zoom: 13 },
      { name: 'Collipulli', lat: -37.9500, lng: -72.4333, zoom: 13 },
      { name: 'Cunco', lat: -38.9333, lng: -72.0333, zoom: 13 },
      { name: 'Curacautín', lat: -38.4333, lng: -71.8833, zoom: 13 },
      { name: 'Curarrehue', lat: -39.3667, lng: -71.5833, zoom: 12 },
      { name: 'Ercilla', lat: -38.0667, lng: -72.3833, zoom: 13 },
      { name: 'Freire', lat: -38.9500, lng: -72.6333, zoom: 13 },
      { name: 'Galvarino', lat: -38.4000, lng: -72.7833, zoom: 13 },
      { name: 'Gorbea', lat: -39.1000, lng: -72.6667, zoom: 13 },
      { name: 'Lautaro', lat: -38.5333, lng: -72.4500, zoom: 13 },
      { name: 'Loncoche', lat: -39.0667, lng: -72.6833, zoom: 13 },
      { name: 'Lonquimay', lat: -38.4333, lng: -71.2333, zoom: 12 },
      { name: 'Los Sauces', lat: -37.9667, lng: -72.8333, zoom: 13 },
      { name: 'Lumaco', lat: -38.1500, lng: -72.9000, zoom: 13 },
      { name: 'Melipeuco', lat: -38.8500, lng: -71.6833, zoom: 13 },
      { name: 'Nueva Imperial', lat: -38.7333, lng: -72.9500, zoom: 13 },
      { name: 'Padre Las Casas', lat: -38.7667, lng: -72.6000, zoom: 13 },
      { name: 'Perquenco', lat: -38.4167, lng: -72.3833, zoom: 13 },
      { name: 'Pitrufquén', lat: -38.9833, lng: -72.6333, zoom: 13 },
      { name: 'Pucón', lat: -39.2817, lng: -71.9753, zoom: 14 },
      { name: 'Purén', lat: -38.0167, lng: -73.0833, zoom: 13 },
      { name: 'Renaico', lat: -37.6667, lng: -72.5833, zoom: 13 },
      { name: 'Saavedra', lat: -38.7833, lng: -73.3833, zoom: 13 },
      { name: 'Temuco', lat: -38.7359, lng: -72.5904, zoom: 13 },
      { name: 'Teodoro Schmidt', lat: -38.9833, lng: -73.1000, zoom: 13 },
      { name: 'Toltén', lat: -39.2167, lng: -73.2167, zoom: 13 },
      { name: 'Traiguén', lat: -38.2500, lng: -72.6667, zoom: 13 },
      { name: 'Victoria', lat: -38.2333, lng: -72.3333, zoom: 13 },
      { name: 'Vilcún', lat: -38.6833, lng: -72.2333, zoom: 13 },
      { name: 'Villarrica', lat: -39.2833, lng: -72.2333, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 13. REGIÓN DE LOS RÍOS (12 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XIV',
    name: 'Los Ríos',
    lat: -39.8142,
    lng: -73.2459,
    zoom: 11,
    communes: [
      { name: 'Corral', lat: -39.8833, lng: -73.4333, zoom: 13 },
      { name: 'Futrono', lat: -40.1333, lng: -72.4000, zoom: 13 },
      { name: 'La Unión', lat: -40.2942, lng: -73.0819, zoom: 13 },
      { name: 'Lago Ranco', lat: -40.3167, lng: -72.4833, zoom: 13 },
      { name: 'Lanco', lat: -39.4500, lng: -72.7833, zoom: 13 },
      { name: 'Los Lagos', lat: -39.6500, lng: -72.8000, zoom: 13 },
      { name: 'Mariquina', lat: -39.5167, lng: -72.9667, zoom: 13 },
      { name: 'Máfil', lat: -39.6667, lng: -72.9500, zoom: 13 },
      { name: 'Paillaco', lat: -40.0667, lng: -72.8667, zoom: 13 },
      { name: 'Panguipulli', lat: -39.6444, lng: -72.3319, zoom: 13 },
      { name: 'Río Bueno', lat: -40.3167, lng: -72.9667, zoom: 13 },
      { name: 'Valdivia', lat: -39.8142, lng: -73.2459, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 14. REGIÓN DE LOS LAGOS (30 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'X',
    name: 'Los Lagos',
    lat: -41.4693,
    lng: -72.9424,
    zoom: 11,
    communes: [
      { name: 'Ancud', lat: -41.8667, lng: -73.8333, zoom: 13 },
      { name: 'Calbuco', lat: -41.7667, lng: -73.1333, zoom: 13 },
      { name: 'Castro', lat: -42.4722, lng: -73.7731, zoom: 13 },
      { name: 'Chaitén', lat: -42.9167, lng: -72.7167, zoom: 12 },
      { name: 'Chonchi', lat: -42.6167, lng: -73.7833, zoom: 13 },
      { name: 'Cochamó', lat: -41.5000, lng: -72.3000, zoom: 12 },
      { name: 'Curaco de Vélez', lat: -42.4333, lng: -73.6000, zoom: 13 },
      { name: 'Dalcahue', lat: -42.3833, lng: -73.6500, zoom: 13 },
      { name: 'Fresia', lat: -41.1500, lng: -73.4167, zoom: 13 },
      { name: 'Frutillar', lat: -41.1303, lng: -73.0489, zoom: 14 },
      { name: 'Futaleufú', lat: -43.1833, lng: -71.8667, zoom: 12 },
      { name: 'Hualaihué', lat: -42.0500, lng: -72.6833, zoom: 12 },
      { name: 'Llanquihue', lat: -41.2556, lng: -73.0083, zoom: 13 },
      { name: 'Los Muermos', lat: -41.4000, lng: -73.4667, zoom: 13 },
      { name: 'Maullín', lat: -41.6167, lng: -73.6000, zoom: 13 },
      { name: 'Osorno', lat: -40.5739, lng: -73.1336, zoom: 13 },
      { name: 'Palena', lat: -43.6167, lng: -71.8000, zoom: 12 },
      { name: 'Puerto Montt', lat: -41.4693, lng: -72.9424, zoom: 13 },
      { name: 'Puerto Octay', lat: -40.9667, lng: -72.8833, zoom: 13 },
      { name: 'Puerto Varas', lat: -41.3197, lng: -72.9856, zoom: 14 },
      { name: 'Puqueldón', lat: -42.5833, lng: -73.7167, zoom: 13 },
      { name: 'Purranque', lat: -40.9167, lng: -73.1667, zoom: 13 },
      { name: 'Puyehue', lat: -40.6667, lng: -72.6000, zoom: 13 },
      { name: 'Queilén', lat: -42.4667, lng: -73.4667, zoom: 13 },
      { name: 'Quellón', lat: -43.1167, lng: -73.6167, zoom: 13 },
      { name: 'Quemchi', lat: -42.1500, lng: -73.4833, zoom: 13 },
      { name: 'Quinchao', lat: -42.4667, lng: -73.4833, zoom: 13 },
      { name: 'Río Negro', lat: -40.7833, lng: -73.2167, zoom: 13 },
      { name: 'San Juan de la Costa', lat: -40.5167, lng: -73.3833, zoom: 13 },
      { name: 'San Pablo', lat: -40.4167, lng: -73.0167, zoom: 13 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 15. REGIÓN DE AYSÉN DEL GRAL. CARLOS IBÁÑEZ DEL CAMPO (10 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XI',
    name: 'Aysén del Gral. Carlos Ibáñez del Campo',
    lat: -45.5712,
    lng: -72.0685,
    zoom: 11,
    communes: [
      { name: 'Aysén', lat: -45.4000, lng: -72.7000, zoom: 13 },
      { name: 'Chile Chico', lat: -46.5400, lng: -71.7200, zoom: 13 },
      { name: 'Cisnes', lat: -44.7500, lng: -72.7000, zoom: 13 },
      { name: 'Cochrane', lat: -47.2500, lng: -72.5833, zoom: 12 },
      { name: 'Coyhaique', lat: -45.5712, lng: -72.0685, zoom: 13 },
      { name: 'Guaitecas', lat: -43.8833, lng: -73.7500, zoom: 12 },
      { name: 'Lago Verde', lat: -44.2333, lng: -71.8667, zoom: 12 },
      { name: 'O\'Higgins', lat: -48.4667, lng: -72.5667, zoom: 12 },
      { name: 'Río Ibáñez', lat: -46.2833, lng: -71.9333, zoom: 13 },
      { name: 'Tortel', lat: -47.8000, lng: -73.5333, zoom: 12 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 16. REGIÓN DE MAGALLANES Y DE LA ANTÁRTICA CHILENA (11 comunas)
  // ═══════════════════════════════════════════════════════════════
  {
    code: 'XII',
    name: 'Magallanes y de la Antártica Chilena',
    lat: -53.1638,
    lng: -70.9171,
    zoom: 11,
    communes: [
      { name: 'Antártica', lat: -62.1900, lng: -58.9600, zoom: 10 },
      { name: 'Cabo de Hornos', lat: -55.0167, lng: -67.6167, zoom: 11 },
      { name: 'Laguna Blanca', lat: -52.4833, lng: -71.2500, zoom: 12 },
      { name: 'Natales', lat: -51.7269, lng: -72.5064, zoom: 13 },
      { name: 'Porvenir', lat: -53.2967, lng: -70.3703, zoom: 13 },
      { name: 'Primavera', lat: -52.7167, lng: -69.2500, zoom: 12 },
      { name: 'Punta Arenas', lat: -53.1638, lng: -70.9171, zoom: 13 },
      { name: 'Río Verde', lat: -52.6500, lng: -70.7500, zoom: 12 },
      { name: 'San Gregorio', lat: -52.3167, lng: -69.7500, zoom: 12 },
      { name: 'Timaukel', lat: -54.0000, lng: -69.8500, zoom: 11 },
      { name: 'Torres del Paine', lat: -51.2533, lng: -72.8800, zoom: 11 },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════
// UTILIDADES DE BÚSQUEDA
// ═══════════════════════════════════════════════════════════════════════

export function findLocation(query: string): {
  type: 'region' | 'commune';
  name: string;
  regionName: string;
  lat: number;
  lng: number;
  zoom: number;
} | null {
  const clean = query.trim().toLowerCase();
  if (!clean) return null;

  // 1. Buscar en comunas
  for (const reg of CHILE_REGIONS) {
    for (const com of reg.communes) {
      if (
        com.name.toLowerCase() === clean ||
        com.name.toLowerCase().includes(clean)
      ) {
        return {
          type: 'commune',
          name: com.name,
          regionName: reg.name,
          lat: com.lat,
          lng: com.lng,
          zoom: com.zoom || 13,
        };
      }
    }
  }

  // 2. Buscar en regiones
  for (const reg of CHILE_REGIONS) {
    if (
      reg.name.toLowerCase().includes(clean) ||
      reg.code.toLowerCase() === clean
    ) {
      return {
        type: 'region',
        name: reg.name,
        regionName: reg.name,
        lat: reg.lat,
        lng: reg.lng,
        zoom: reg.zoom,
      };
    }
  }

  return null;
}

/**
 * Retorna el total de comunas en el dataset.
 */
export function getTotalCommunes(): number {
  return CHILE_REGIONS.reduce((sum, r) => sum + r.communes.length, 0);
}
