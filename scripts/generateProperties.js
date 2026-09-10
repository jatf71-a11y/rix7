// Generator: one of each type per commune in Chile for sale AND rent (except Premium)
const fs = require('fs');
const path = require('path');

const locationsContent = fs.readFileSync(path.join(__dirname, '../lib/data/chileLocations.ts'), 'utf8');

// Parse regions
const regions = [];
const codeRegex = /code:\s*'([^']+)'/g;
let codeMatch;
const codePositions = [];

while ((codeMatch = codeRegex.exec(locationsContent)) !== null) {
  const afterCode = locationsContent.slice(codeMatch.index, codeMatch.index + 200);
  const nameMatch = afterCode.match(/name:\s*['"]([^'"]+)['"]/);
  const latMatch = afterCode.match(/lat:\s*([-\d.]+)/);
  const lngMatch = afterCode.match(/lng:\s*([-\d.]+)/);

  if (nameMatch) {
    codePositions.push({
      code: codeMatch[1],
      name: nameMatch[1],
      lat: latMatch ? parseFloat(latMatch[1]) : 0,
      lng: lngMatch ? parseFloat(lngMatch[1]) : 0,
      start: codeMatch.index,
    });
  }
}

for (let i = 0; i < codePositions.length; i++) {
  const start = codePositions[i].start;
  const end = i + 1 < codePositions.length ? codePositions[i + 1].start : locationsContent.length;
  const block = locationsContent.slice(start, end);

  const communes = [];
  const communeRegex = /\{\s*name:\s*['"]([^'"]+)['"].*?lat:\s*([-\d.]+).*?lng:\s*([-\d.]+).*?zoom:\s*(\d+)/g;
  let cm;
  while ((cm = communeRegex.exec(block)) !== null) {
    communes.push({ name: cm[1], lat: parseFloat(cm[2]), lng: parseFloat(cm[3]), zoom: parseInt(cm[4]) });
  }

  regions.push({
    code: codePositions[i].code, name: codePositions[i].name,
    lat: codePositions[i].lat, lng: codePositions[i].lng, communes,
  });
}

const totalCommunes = regions.reduce((s, r) => s + r.communes.length, 0);
console.log(`Found ${regions.length} regions, ${totalCommunes} communes`);

const existingCommunes = new Set(['La Reina']);

// ═══ DIRECCIONES REALES POR COMUNA ═══
const communeAddresses = {
  // ─── ARICA Y PARINACOTA ───
  'Arica': { streets: ['Av. 18 de Septiembre', 'Av. Comandante San Martín', 'Av. Pedro Lagos', 'Calle 21 de Mayo', 'Av. Bolognesi', 'Av. Ejército', 'Calle Serrano', 'Av. Los Fronterizos'], neighborhoods: ['Centro', 'Villa Fronteriza', 'Los Heroes', 'El Morro', 'Chacalluta'] },
  'Camarones': { streets: ['Calle Los Robles', 'Camino al Mar', 'Ruta 5'], neighborhoods: ['Centro', 'Sector Alto'] },
  'Putre': { streets: ['Calle San Miguel', 'Av. Tarapacá', 'Calle Las Begonias'], neighborhoods: ['Centro', 'Alto Putre'] },
  'General Lagos': { streets: ['Calle Principal', 'Av. Los Andes'], neighborhoods: ['Visviri', 'Coya'] },
  'Arica (Putre)': { streets: ['Calle Putre'], neighborhoods: ['Putre'] },
  // ─── TARAPACÁ ───
  'Iquique': { streets: ['Av. Baquedano', 'Av. Arturo Prat', 'Calle Plaza Arturo Prat', 'Av. Peters Restovic', 'Av. Los Riquelme', 'Calle Tarapacá', 'Av. Copa Cabana', 'Av. Aeropuerto'], neighborhoods: ['Centro', 'Bravo', 'Los Altos de Cantarrana', 'Huayquique', 'Llanquihue', 'La Florida'] },
  'Alto Hospicio': { streets: ['Av. San Martín', 'Av. Chile', 'Calle Los Andes', 'Av. Los Pinos'], neighborhoods: ['Centro', 'Juan de Salas', 'Villa Entre Ríos', 'Pampa Unión'] },
  'Camiñapi': { streets: ['Av. Tarapacá'], neighborhoods: ['Centro'] },
  'Camarones (Iquique)': { streets: ['Calle Principal'], neighborhoods: ['Centro'] },
  'Huara': { streets: ['Ruta 16'], neighborhoods: ['Centro'] },
  'Pozo Almonte': { streets: ['Av. Pedro de Valdivia', 'Calle Freire'], neighborhoods: ['Centro', 'Las Salitreras'] },
  'Pisagua': { streets: ['Calle Costanera', 'Av. Punta de Totoral'], neighborhoods: ['Centro', 'Alto Pisagua'] },
  // ─── ANTOFAGASTA ───
  'Antofagasta': { streets: ['Av. Angamos', 'Av. Coloso', 'Av. Urmeneta', 'Calle 21 de Mayo', 'Av. España', 'Calle Baquedano', 'Av. Portales', 'Calle O\'Higgins', 'Av. Argentina', 'Calle Tocopilla'], neighborhoods: ['Centro', 'Coloso', 'López de Gere', '14 de Febrero', 'Pedro Aguirre Cerda', 'Juan López', 'Bellavista', 'Cachimba del Rey', 'Las Salinas'] },
  'Calama': { streets: ['Av. García Hurtado de Mendoza', 'Av. Chile', 'Calle Baquedano', 'Av. Myriam Sepúlveda', 'Av. Loa'], neighborhoods: ['Centro', 'Chuquicamata', 'Campamento 21', 'Los Andes', 'Lomas del Norte'] },
  'Tocopilla': { streets: ['Av. Arturo Prat', 'Calle Calvo', 'Av. Ejército'], neighborhoods: ['Centro', 'Coya Norte'] },
  'Taltal': { streets: ['Calle Bolognesi', 'Av. Paposo'], neighborhoods: ['Centro'] },
  'María Elena': { streets: ['Av. Serrano', 'Calle Los Andes'], neighborhoods: ['Centro', 'Pedro de Valdivia'] },
  'Ollagüe': { streets: ['Ruta 21'], neighborhoods: ['Centro'] },
  // ─── ATACAMA ───
  'Copiapó': { streets: ['Av. Atacama', 'Calle José Miguel Carrera', 'Av. Los Carrera', 'Calle Freire', 'Av. Universidad Católica', 'Calle Pizarro'], neighborhoods: ['Centro', 'San Fernando', 'Ceheín', 'Alto del Pino', 'Los Domos'] },
  'Vallenar': { streets: ['Av. Santa Rosa', 'Calle 21 de Mayo', 'Av. Arturo Prat'], neighborhoods: ['Centro', 'Alto Hospicio', 'Palmira'] },
  'Huasco': { streets: ['Av. Freire', 'Calle Serrano', 'Costanera'], neighborhoods: ['Centro', 'Salado', 'Los Ríos'] },
  'Chañaral': { streets: ['Calle O\'Higgins', 'Av. Freire'], neighborhoods: ['Centro', 'Diego de Almagro'] },
  'Diego de Almagro': { streets: ['Av. Carlos Condell', 'Calle Baquedano'], neighborhoods: ['Centro'] },
  'Caldera': { streets: ['Av. Arturo Prat', 'Calle Matta', 'Costanera'], neighborhoods: ['Centro', 'Puerto Caldera', 'Sierra Negra'] },
  'Freirina': { streets: ['Av. 18 de Septiembre', 'Calle Los Andes'], neighborhoods: ['Centro', 'Gualliguatica'] },
  // ─── COQUIMBO ───
  'La Serena': { streets: ['Av. del Mar', 'Calle Los Carrera', 'Av. Pedro Pablo Muñoz', 'Calle Delicias', 'Av. Balmaceda', 'Calle Recreo', 'Av. San Martín', 'Calle Coquimbo', 'Calle Baltra', 'Av. Tres Reyes'], neighborhoods: ['Centro', 'El Golf', 'Los Conquistadores', 'San Carlos', 'Avenida del Mar', 'El Quillay', 'Peñablanca', 'La Pampa'] },
  'Coquimbo': { streets: ['Av. Cuatro Esquinas', 'Calle Baquedano', 'Av. Pedro de Valdivia', 'Calle Los Ríos', 'Av. La Mar'], neighborhoods: ['Centro', 'El Llano', 'Las Rocas', 'Villa Iglesia', 'Los Peñascos'] },
  'Viña del Mar': { streets: ['Av. Valparaíso', 'Calle 15 Norte', 'Av. Libertad', 'Calle 3 Norte', 'Av. España', 'Av. Buenos Aires', 'Calle Millán', 'Av. San Martín'], neighborhoods: ['Centro', 'Miraflores', 'Recreo', 'Rodelillo', 'Vergara', 'Bellavista', 'Los Viñedos'] },
  'Valparaíso': { streets: ['Av. Pedro Montt', 'Calle Condell', 'Av. Uruguay', 'Calle Pedro Lagos', 'Av. España', 'Av. Barón', 'Calle Santo Domingo', 'Av. Matta'], neighborhoods: ['Centro', 'Cerro Alegre', 'Cerro Concepción', 'Playa Ancha', 'Barón', 'Florida', 'Pedro Montt'] },
  'Quillota': { streets: ['Av. San Martín', 'Calle 21 de Mayo', 'Av. Argentina'], neighborhoods: ['Centro', 'La Cruz', 'Zapata'] },
  'San Antonio': { streets: ['Av. Barón', 'Calle 5 de Abril', 'Av. Punta Peñasco', 'Costanera'], neighborhoods: ['Centro', 'El Manzano', 'Bahía Aventuras', 'Llolleo'] },
  'Isla de Pascua': { streets: ['Av. Atamu Tekena', 'Calle Hanga Piko'], neighborhoods: ['Hanga Roa', 'Mataveri'] },
  'Petorca': { streets: ['Av. Los Carrera', 'Calle La Palca'], neighborhoods: ['Centro'] },
  'La Ligua': { streets: ['Av. Balmaceda', 'Calle San Martín'], neighborhoods: ['Centro', 'Cabbrugada'] },
  'Zapallar': { streets: ['Calle Costanera', 'Av. Los Palos Verdes'], neighborhoods: ['Centro', 'Papudo'] },
  'Papudo': { streets: ['Calle Pichidangui', 'Av. Costanera'], neighborhoods: ['Centro'] },
  'Costerilla': { streets: ['Calle 2 Norte'], neighborhoods: ['Centro'] },
  'Catemu': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Limache': { streets: ['Av. Valparaíso', 'Calle Matta'], neighborhoods: ['Centro', 'Olmué'] },
  'Olmué': { streets: ['Calle La Cruz', 'Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Putaendo': { streets: ['Av. Arturo Prat', 'Calle 5 de Abril'], neighborhoods: ['Centro'] },
  'Santa María': { streets: ['Av. San Martín'], neighborhoods: ['Centro'] },
  'Panquehue': { streets: ['Camino al Panul'], neighborhoods: ['Centro'] },
  'Las Cabras': { streets: ['Calle del Río'], neighborhoods: ['Centro'] },
  'Nogales': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Hijuelas': { streets: ['Av. Carlos Condell'], neighborhoods: ['Centro'] },
  'La Cruz': { streets: ['Av. Quebrada', 'Calle Las Palmas'], neighborhoods: ['Centro'] },
  'Calle Larga': { streets: ['Calle Baquedano'], neighborhoods: ['Centro'] },
  'Los Andes': { streets: ['Av. Los Andes', 'Calle San Martín', 'Av. Edmundo Pérez Zujovic'], neighborhoods: ['Centro', 'San Esteban', 'Calle Larga'] },
  'San Esteban': { streets: ['Calle Las Palmas'], neighborhoods: ['Centro'] },
  'Rinconada': { streets: ['Calle Principal'], neighborhoods: ['Centro'] },
  'Juncal': { streets: ['Calle Portezuelo'], neighborhoods: ['Centro'] },
  'Río Hurtado': { streets: ['Camino al Río'], neighborhoods: ['Centro'] },
  'Combarbalá': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Illapel': { streets: ['Av. Balmaceda', 'Calle O\'Higgins'], neighborhoods: ['Centro', 'Salamanca', 'Los Vilos'] },
  'Salamanca': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Los Vilos': { streets: ['Av. Costanera', 'Calle Los Andes'], neighborhoods: ['Centro', 'Pichidangui'] },
  'Canela': { streets: ['Calle Barón'], neighborhoods: ['Centro'] },
  // ─── METROPOLITANA ───
  'Santiago': { streets: ['Av. Libertador Bernardo O\'Higgins', 'Calle Moneda', 'Av. Presidente Ibáñez', 'Calle Morandé', 'Av. Tarapacá', 'Calle Santa Rosa', 'Av. Vicuña Mackenna', 'Calle Huérfanos', 'Calle Agustinas', 'Av. Recoleta'], neighborhoods: ['Centro', 'Barrio Lastarria', 'Barrio Bellavista', 'Barrio Yungay', 'Barrio Italia', 'Estación Central'] },
  'Providencia': { streets: ['Av. Providencia', 'Calle Isidora Goyenechea', 'Av. Los Leones', 'Calle Pedro de Valdivia', 'Av. Salvador', 'Calle Manuel Montt', 'Av. Eugenio Crosque'], neighborhoods: ['Centro', 'Barrio Italia', 'Barrio Pedro de Valdivia', 'Barrio Los Leones', 'Barrio Manuel Montt'] },
  'Las Condes': { streets: ['Av. Apoquindo', 'Av. Isidora Goyenechea', 'Av. Vitacura', 'Av. Kennedy', 'Calle Alonso de Córdova', 'Av. Vitacura', 'Av. Nueva Las Condes'], neighborhoods: ['Centro', 'Barrio El Golf', 'Sanhattan', 'Nueva Las Condes', 'Lo Curro', 'Parque Araucano', 'Los Militares'] },
  'Vitacura': { streets: ['Av. Vitacura', 'Av. Bicycleta', 'Calle San Sebastián', 'Av. Apoquindo', 'Calle Isidora Goyenechea'], neighborhoods: ['Centro', 'Nueva Vitacura', 'San Carlos de Apoquindo', 'El Golf'] },
  'Lo Barnechea': { streets: ['Av. La Dehesa', 'Av. Los Marcadores', 'Camino Las Acacias', 'Av. Chicureo'], neighborhoods: ['Centro', 'Chicureo', 'La Dehesa', 'La Dehesa Norte', 'El Abrazo'] },
  'La Reina': { streets: ['Av. Larraín', 'Av. José Arrieta', 'Calle Guallecura', 'Av. Los Leones', 'Calle San Carlos de Apoquindo'], neighborhoods: ['Centro', 'Barrio Larraín', 'Macul'] },
  'Ñuñoa': { streets: ['Av. Irarrázaval', 'Calle José Arrieta', 'Av. Santa Isabel', 'Calle Caupolicán', 'Av. Julio Covarrubias'], neighborhoods: ['Centro', 'Barrio Ñuñoa', 'Barrio Jardín', 'Barrio Matta'] },
  'Maipú': { streets: ['Av. 5 de Abril', 'Av. Los Pajaritos', 'Calle San Carlos', 'Av. Los Morros', 'Av. Américo Vespucio'], neighborhoods: ['Centro', 'Los Pajaritos', 'Villa Frei', 'Ciudad Satélite'] },
  'San Miguel': { streets: ['Av. Moneda', 'Calle Gran Avenida', 'Av. Santa Rosa', 'Calle Lo Vodanovic'], neighborhoods: ['Centro', 'Barrio San Miguel', 'Lo Vodanovic'] },
  'La Florida': { streets: ['Av. Vicuña Mackenna', 'Av. Larraín', 'Calle San Carlos', 'Av. José Arrieta', 'Av. Concha y Toro'], neighborhoods: ['Centro', 'Lo Hermida', 'Macul Sur', 'Villa Macul'] },
  'San Joaquín': { streets: ['Av. Santa Rosa', 'Calle Quilicura', 'Av. Franklin', 'Calle Departamental'], neighborhoods: ['Centro', 'Franklin', 'Estación Franklin'] },
  'La Granja': { streets: ['Av. Santa Rosa', 'Calle La Granja', 'Av. San Martín'], neighborhoods: ['Centro', 'Santa Rosa'] },
  'Recoleta': { streets: ['Av. Recoleta', 'Calle Dávila', 'Av. Independencia', 'Calle Panamericana'], neighborhoods: ['Centro', 'Dávila', 'Panamericana'] },
  'Puente Alto': { streets: ['Av. Concha y Toro', 'Av. San José de Maipo', 'Calle Los Toros', 'Av. Gabriela', 'Calle El Peñón'], neighborhoods: ['Centro', 'San José de Maipo', 'El Peñón', 'El Peñón Sur'] },
  'Pirque': { streets: ['Camino Las Acacias', 'Av. Concha y Toro', 'Calle Los Aromos'], neighborhoods: ['Centro', 'Concha y Toro'] },
  'Macul': { streets: ['Av. Macul', 'Calle Quilín', 'Av. Grecia'], neighborhoods: ['Centro'] },
  'Peñalolén': { streets: ['Av. Grecia', 'Av. José Arrieta', 'Calle Los Orientales'], neighborhoods: ['Centro', 'Villa Olímpica'] },
  'Estación Central': { streets: ['Av. Matta', 'Av. Portales', 'Calle San Carlos', 'Av. Departamental'], neighborhoods: ['Centro'] },
  'Cerrillos': { streets: ['Av. Pedro Aguirre Cerda', 'Calle Lo Martínez', 'Av. Los Morros'], neighborhoods: ['Centro'] },
  'San Bernardo': { streets: ['Av. Portales', 'Av. Concha y Toro', 'Calle Los Leones'], neighborhoods: ['Centro', 'El Abrazo', 'Lo Herrero'] },
  'Colina': { streets: ['Av. Los Andes', 'Calle San Carlos', 'Av. Batuco'], neighborhoods: ['Centro', 'Batuco', 'Lampa'] },
  'Quilicura': { streets: ['Av. Los Libertadores', 'Calle El Tongoy', 'Av. Américo Vespucio'], neighborhoods: ['Centro', 'El Tongoy', 'Los Libertadores'] },
  'Lampa': { streets: ['Av. La Estrella', 'Calle Los Andes'], neighborhoods: ['Centro'] },
  'Cerro Navia': { streets: ['Av. La Estrella', 'Calle Marcoleta'], neighborhoods: ['Centro'] },
  'Conchalí': { streets: ['Av. Lo Marcoleta', 'Calle Los liberté'], neighborhoods: ['Centro'] },
  'El Bosque': { streets: ['Av. Santa Rosa', 'Calle Lo Martínez'], neighborhoods: ['Centro'] },
  'Estación Central (Pedro Aguirre Cerda)': { streets: ['Av. Pedro Aguirre Cerda'], neighborhoods: ['Centro'] },
  'Independencia': { streets: ['Av. Independencia', 'Calle Recoleta'], neighborhoods: ['Centro'] },
  'La Cisterna': { streets: ['Av. Santa Rosa', 'Calle Los Pajaritos'], neighborhoods: ['Centro'] },
  'Lo Espejo': { streets: ['Av. Pedro Aguirre Cerda', 'Calle Los Toros'], neighborhoods: ['Centro'] },
  'Lo Prado': { streets: ['Av. Mapocho', 'Calle San Carlos'], neighborhoods: ['Centro'] },
  'Macul (Pedro Aguirre Cerda)': { streets: ['Av. Macul'], neighborhoods: ['Centro'] },
  'Pedro Aguirre Cerda': { streets: ['Av. Pedro Aguirre Cerda', 'Calle Los Acacios'], neighborhoods: ['Centro'] },
  'Pudahuel': { streets: ['Av. La Estrella', 'Calle Mapocho'], neighborhoods: ['Centro', 'Cerrillos'] },
  'Quinta Normal': { streets: ['Av. Carrascal', 'Calle Lo Blanco'], neighborhoods: ['Centro'] },
  'Renca': { streets: ['Av. Los Libertadores', 'Calle Limache'], neighborhoods: ['Centro'] },
  'San Ramón': { streets: ['Av. Santa Rosa', 'Calle Departamental'], neighborhoods: ['Centro'] },
  'San Ramón (La Granja)': { streets: ['Av. Santa Rosa'], neighborhoods: ['Centro'] },
  'Talagante': { streets: ['Av. Los Quillayes', 'Calle El Ángel'], neighborhoods: ['Centro'] },
  'El Monte': { streets: ['Av. Los Carrera', 'Calle Los Aromos'], neighborhoods: ['Centro'] },
  'Isla de Maipo': { streets: ['Av. Los Andes', 'Calle 18 de Septiembre'], neighborhoods: ['Centro'] },
  'Peñaflor': { streets: ['Av. Los Aromos', 'Calle San Carlos'], neighborhoods: ['Centro'] },
  'Buin': { streets: ['Av. Los Carrera', 'Calle Arturo Prat'], neighborhoods: ['Centro', 'Paine'] },
  'Paine': { streets: ['Av. Los Andes', 'Calle Portales'], neighborhoods: ['Centro'] },
  'Calera de Tango': { streets: ['Camino las Praderas'], neighborhoods: ['Centro'] },
  'San José de Maipo': { streets: ['Av. San José de Maipo', 'Calle Los Cipreses'], neighborhoods: ['Centro', 'El Volcán', 'San Alfonso'] },
  'San Pedro': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Melipilla': { streets: ['Av. Arturo Prat', 'Calle Los Carrera', 'Av. Los Andes'], neighborhoods: ['Centro', 'Las Acacias', 'Pumanque'] },
  'María Pinto': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Curacaví': { streets: ['Av. Los Andes', 'Calle Arturo Prat'], neighborhoods: ['Centro'] },
  'Talagante (RM)': { streets: ['Av. 5 de Abril'], neighborhoods: ['Centro'] },
  // ─── O'HIGGINS ───
  'Rancagua': { streets: ['Av. Bernardo O\'Higgins', 'Calle Estado', 'Av. Atacama', 'Calle San Martín', 'Av. Carlos Condell', 'Calle Los Carrera'], neighborhoods: ['Centro', 'El Roble', 'Puente Alto Rancagua', 'Los Andes'] },
  'San Fernando': { streets: ['Av. 18 de Septiembre', 'Calle Maipú'], neighborhoods: ['Centro'] },
  'Rengo': { streets: ['Av. San Martín', 'Calle O\'Higgins'], neighborhoods: ['Centro'] },
  'San Vicente de Tagua Tagua': { streets: ['Av. Los Andes', 'Calle O\'Higgins'], neighborhoods: ['Centro'] },
  'Pichilemu': { streets: ['Av. Punta de Lobos', 'Calle Aviador', 'Costanera'], neighborhoods: ['Centro', 'La Puntilla', 'Paredones'] },
  'Santa Cruz': { streets: ['Av. 18 de Octubre', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Chépica': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Chimbarongo': { streets: ['Av. San Martín'], neighborhoods: ['Centro'] },
  'Lolol': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Nancagua': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Placilla': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Fernando (Colchagua)': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'San Vicente': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Palmilla': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Peralillo': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Placilla (Colchagua)': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'San Esteban': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  // ─── MAULE ───
  'Talca': { streets: ['Av. 18 de Septiembre', 'Calle 1 Sur', 'Av. San Martín', 'Calle 1 Norte', 'Av. Circunvalación', 'Calle Linares'], neighborhoods: ['Centro', 'Bellavista', 'Pencahue', 'San Clemente'] },
  'Curicó': { streets: ['Av. San Martín', 'Calle 5 Norte', 'Av. Luis Cruz Martínez'], neighborhoods: ['Centro', 'Los Niches'] },
  'Linares': { streets: ['Av. San Martín', 'Calle 1 Norte', 'Av. Libre'], neighborhoods: ['Centro'] },
  'Cauquenes': { streets: ['Av. 18 de Julio', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Constitución': { streets: ['Av. Costanera', 'Calle Los Ríos'], neighborhoods: ['Centro', 'Bajo'] },
  'Curepto': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Empedrado': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Maule': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Molina': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Parral': { streets: ['Av. San Martín', 'Calle 1 Norte'], neighborhoods: ['Centro'] },
  'Retiro': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Río Claro': { streets: ['Calle Los Ríos'], neighborhoods: ['Centro'] },
  'San Clemente': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'San Javier': { streets: ['Av. San Martín', 'Calle O\'Higgins'], neighborhoods: ['Centro'] },
  'San Luis del Tarapacá': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Villa Alegre': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Yerbas Buenas': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Longaví': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'San Rafael': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  // ─── ÑUBLE ───
  'Chillán': { streets: ['Av. Chile', 'Calle 18 de Septiembre', 'Av. San Martín', 'Calle O\'Higgins', 'Av. Libertador', 'Calle Caupolicán'], neighborhoods: ['Centro', 'Ñuble', 'Chillán Viejo'] },
  'San Carlos': { streets: ['Av. San Martín', 'Calle Los Andes'], neighborhoods: ['Centro'] },
  'Quirihue': { streets: ['Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Cobquecura': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Coelemu': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Ninhue': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Portezuelo': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Ránquil': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'San Nicolás': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Pedro de la Paz': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Yungay': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Bulnes': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Pemuco': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Ignacio': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Chillán Viejo': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  // ─── BIOBÍO ───
  'Concepción': { streets: ['Av. Colo Colo', 'Av. Freire', 'Calle Barros Arana', 'Av. Chacabuco', 'Calle O\'Higgins', 'Av. Los Carrera', 'Calle Caupolicán'], neighborhoods: ['Centro', 'Barrio Universidad', 'Barrio Chiguata', 'Los Cóndores', 'Colón', 'Caupolicán'] },
  'Talcahuano': { streets: ['Av. Caupolicán', 'Calle Tucapel', 'Av. San Martín', 'Costanera'], neighborhoods: ['Centro', 'El Morro', 'Hualpén'] },
  'San Pedro de la Paz': { streets: ['Av. Los Ríos', 'Calle Los Andes', 'Av. Lomas de San Pedro'], neighborhoods: ['Centro', 'Lomas de San Pedro'] },
  'Hualpén': { streets: ['Av. Los Carrera', 'Calle 21 de Mayo'], neighborhoods: ['Centro', 'Las Salinas'] },
  'Chiguata': { streets: ['Av. Freire'], neighborhoods: ['Centro'] },
  'Tomé': { streets: ['Av. Costanera', 'Calle 18 de Septiembre'], neighborhoods: ['Centro', 'Bellavista'] },
  'Florida': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Penco': { streets: ['Av. Costanera', 'Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Lota': { streets: ['Av. Los Ríos', 'Calle 21 de Mayo'], neighborhoods: ['Centro'] },
  'Arauco': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Cañete': { streets: ['Av. Los Carrera', 'Calle O\'Higgins'], neighborhoods: ['Centro'] },
  'Contulmo': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Curanilahue': { streets: ['Av. Los Ríos'], neighborhoods: ['Centro'] },
  'Lebu': { streets: ['Av. Arturo Prat', 'Costanera'], neighborhoods: ['Centro'] },
  'Los Álamos': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Tirúa': { streets: ['Av. Costanera'], neighborhoods: ['Centro'] },
  'Alto Biobío': { streets: ['Camino al Volcán'], neighborhoods: ['Rucalhue'] },
  'Santa Juana': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  // ─── ARAUCANÍA ───
  'Temuco': { streets: ['Av. Alemania', 'Calle Caupolicán', 'Av. Cañete', 'Calle Lautaro', 'Av. Los Ríos', 'Calle Manzano', 'Av. San Martín'], neighborhoods: ['Centro', 'Barrio Alemania', 'Los Ríos', 'El Boldo', 'Playa Blanca', 'Cañete'] },
  'Padre Las Casas': { streets: ['Av. San Martín', 'Calle Los Andes'], neighborhoods: ['Centro'] },
  'Angol': { streets: ['Av. Los Carrera', 'Calle O\'Higgins'], neighborhoods: ['Centro'] },
  'Lautaro': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Villarrica': { streets: ['Av. Pedro de Valdivia', 'Calle Los Ríos', 'Costanera'], neighborhoods: ['Centro'] },
  'Pucón': { streets: ['Av. Los Arrayanes', 'Calle O\'Higgins', 'Costanera'], neighborhoods: ['Centro'] },
  'Nueva Imperial': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Carahue': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Cunco': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Curarrehue': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Galvarino': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Gorbea': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Loncoche': { streets: ['Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Lautaro (Temuco)': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Melipeuco': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Pitrufquén': { streets: ['Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Saavedra': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Teodoro Schmidt': { streets: ['Calle San Martín'], neighborhoods: ['Centro'] },
  'Toltén': { streets: ['Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Vilcún': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Villarrica (Temuco)': { streets: ['Av. Pedro de Valdivia'], neighborhoods: ['Centro'] },
  'Chol Chol': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  // ─── LOS RÍOS ───
  'Valdivia': { streets: ['Av. General Lagos', 'Calle O\'Higgins', 'Av. Aníbal Pinto', 'Calle Matta', 'Costanera'], neighborhoods: ['Centro', 'Isla Teja', 'Pichoy'] },
  'La Unión': { streets: ['Av. Los Carrera', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Río Bueno': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Panguipulli': { streets: ['Av. Los Ríos', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Máfil': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Mariquina': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Pablo': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Lanco': { streets: ['Av. Los Carrera', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Mariquina (Valdivia)': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Futrono': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Lago Ranco': { streets: ['Calle Los Ríos'], neighborhoods: ['Centro'] },
  // ─── LOS LAGOS ───
  'Puerto Montt': { streets: ['Av. del Mar', 'Calle Angelmó', 'Av. Carlos Richter', 'Calle Antonio Varas', 'Costanera'], neighborhoods: ['Centro', 'Angelmó', 'Losstile'] },
  'Puerto Varas': { streets: ['Av. Los Arrayanes', 'Costanera', 'Calle San Pedro'], neighborhoods: ['Centro'] },
  'Osorno': { streets: ['Av. 18 de Julio', 'Calle Mariano Prado', 'Av. 5 de Octubre', 'Calle Cuarto Cruz'], neighborhoods: ['Centro'] },
  'Castro': { streets: ['Av. Los Libertadores', 'Costanera'], neighborhoods: ['Centro'] },
  'Ancud': { streets: ['Av. San Carlos', 'Costanera'], neighborhoods: ['Centro'] },
  'Frutillar': { streets: ['Costanera', 'Calle Los Arrayanes'], neighborhoods: ['Centro'] },
  'Calbuco': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Chaitén': { streets: ['Calle Los Arrayanes'], neighborhoods: ['Centro'] },
  'Chonchi': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Curaco de Vélez': { streets: ['Calle San Pedro'], neighborhoods: ['Centro'] },
  'Dalcahue': { streets: ['Calle Los Libertadores'], neighborhoods: ['Centro'] },
  'Fresia': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'Frutillar (Osorno)': { streets: ['Costanera'], neighborhoods: ['Centro'] },
  'Futaleufú': { streets: ['Av. Los Carrera'], neighborhoods: ['Centro'] },
  'Huillingo': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Maullín': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Palena': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Puerto Octay': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Puerto Williams': { streets: ['Calle Piloto Pardo'], neighborhoods: ['Centro'] },
  'Puerto Williams': { streets: ['Calle Piloto Pardo'], neighborhoods: ['Centro'] },
  'Puqueldón': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Queilén': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Quellón': { streets: ['Costanera', 'Calle Los Andes'], neighborhoods: ['Centro'] },
  'Quemchi': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Quinchao': { streets: ['Calle San Pedro'], neighborhoods: ['Centro'] },
  'Río Negro': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  'San Juan de la Costa': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Pablo (Osorno)': { streets: ['Calle Los Carrera'], neighborhoods: ['Centro'] },
  // ─── AYSÉN ───
  'Coyhaique': { streets: ['Av. General Baquedano', 'Calle 21 de Mayo', 'Av. Pedro Aguirre Cerda'], neighborhoods: ['Centro'] },
  'Aysén': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Cisnes': { streets: ['Av. Los Andes'], neighborhoods: ['Centro'] },
  'Chile Chico': { streets: ['Av. Los Andes', 'Costanera'], neighborhoods: ['Centro'] },
  'Cochrane': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Coyhaique (Aysén)': { streets: ['Av. General Baquedano'], neighborhoods: ['Centro'] },
  'Guaitecas': { streets: ['Caletones'], neighborhoods: ['Melinka'] },
  'Higgins': { streets: ['Calle Los Andes'], neighborhoods: ['Villa Cerro Castillo'] },
  'O\'Higgins': { streets: ['Calle Los Andes'], neighborhoods: ['Puerto Aysén'] },
  'Río Ibáñez': { streets: ['Calle Los Andes'], neighborhoods: ['Cochrane'] },
  'Tortel': { streets: ['Pasarelas'], neighborhoods: ['Centro'] },
  // ─── MAGALLANES ───
  'Punta Arenas': { streets: ['Av. Bulnes', 'Calle O\'Higgins', 'Av. Pedro Montt', 'Costanera', 'Calle 21 de Mayo', 'Av. España'], neighborhoods: ['Centro', 'Mirador', 'Barrio Español'] },
  'Porvenir': { streets: ['Av. Los Andes', 'Calle San Martín'], neighborhoods: ['Centro'] },
  'Puerto Natales': { streets: ['Av. Arturo Prat', 'Costanera', 'Calle Balmaceda'], neighborhoods: ['Centro'] },
  'Puerto Williams': { streets: ['Calle Piloto Pardo', 'Av. Martín Gusinde'], neighborhoods: ['Centro'] },
  'Cabo de Hornos': { streets: ['Calle Pedro Aguirre Cerda'], neighborhoods: ['Centro'] },
  'Antártica': { streets: ['Av. 12 de Octubre'], neighborhoods: ['Villa Las Estrellas'] },
  'Laguna Blanca': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Río Verde': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'San Gregorio': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
  'Timaukel': { streets: ['Cerro Castillo'], neighborhoods: ['Centro'] },
  'Primavera': { streets: ['Calle Los Andes'], neighborhoods: ['Centro'] },
};

// Función para obtener una dirección real para una comuna
function getRealAddress(communeName, type, idx) {
  const data = communeAddresses[communeName];
  if (!data) {
    // Fallback para comunas no mapeadas
    const fallbackStreets = ['Los Andes', 'San Martín', 'O\'Higgins', 'Los Carrera', 'Arturo Prat', '21 de Mayo', 'Libertador', 'Los Robles'];
    const street = fallbackStreets[idx % fallbackStreets.length];
    const prefix = type === 'apartment' ? 'Av.' : type === 'office' ? 'Oficina' : type === 'land' || type === 'parcel' ? 'Camino' : 'Calle';
    const num = 100 + (idx * 37) % 2000;
    return `${prefix} ${street} ${num}`;
  }
  const street = data.streets[idx % data.streets.length];
  const num = 100 + (idx * 37) % 2000;
  if (type === 'apartment') return `${street} ${num}`;
  if (type === 'office') return `Oficina ${num}, ${street}`;
  if (type === 'land' || type === 'parcel') return `Camino ${street} ${num}`;
  return `${street} ${num}`;
}

function getRealDescription(communeName, type, bedrooms, bathrooms, area, idx, data) {
  const neighborhood = data?.neighborhoods ? data.neighborhoods[idx % data.neighborhoods.length] : communeName;
  if (type === 'house') return `Casa familiar ubicada en el sector ${neighborhood} de ${communeName}. ${bedrooms} dormitorios, ${bathrooms} baños, ${area} m². Excelente ubicación y conectividad.`;
  if (type === 'apartment') return `Departamento en ${neighborhood}, ${communeName}. ${bedrooms} dormitorio(s), ${bathrooms} baño(s), ${area} m². Moderna infraestructura y seguridad.`;
  if (type === 'parcel') return `Parcela de ${(area / 10000).toFixed(1)} hectáreas en ${neighborhood}, ${communeName}. Terreno con buenas vistas y acceso.`;
  if (type === 'office') return `Oficina de ${area} m² en ${neighborhood}, ${communeName}. ${data?.streets?.[0] || 'Centro comercial'}. Ideal para profesionales.`;
  if (type === 'land') return `Terreno de ${(area / 1000).toFixed(1)} hectáreas en ${neighborhood}, ${communeName}. Lote con potencial de desarrollo.`;
  return `${type} en ${communeName}, ${communeName}.`;
}

function generateId(regionCode, communeName, type, status) {
  const prefix = regionCode.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
  const slug = communeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const statusSlug = status === 'for_rent' ? 'arriendo' : 'venta';
  return `${prefix}-${type}-${slug}-${statusSlug}`;
}

const isUrban = (code) => ['XIII', 'V', 'VIII', 'IV', 'VI'].includes(code);

// ═══ HOUSE ═══
function genHouse(region, commune, idx, status) {
  const bedrooms = 2 + (idx % 3);
  const bathrooms = 1 + (idx % 3);
  const area = 80 + (idx * 13) % 200;
  const parking = idx % 3;
  const year = 2005 + (idx * 7) % 20;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 800000 : 350000000) : (status === 'for_rent' ? 300000 : 120000000);
  const price = Math.round((base + (idx * 73000000) % base) / (status === 'for_rent' ? 10000 : 1000000)) * (status === 'for_rent' ? 10000 : 1000000);
  const styles = ['Casa con Jardín y Quincho', 'Casa Familiar de 3 Dormitorios', 'Casa con Vista Panorámica',
    'Casa Rústica de Campo', 'Casa Moderna de 2 Plantas', 'Casa Campestre con Terreno',
    'Casa con Patio Trasero', 'Casa Típica del Pueblo', 'Casa de Chalet', 'Casa con Piscina'];
  const feats = [['Jardín', 'Quincho', 'Cocina integral'], ['Estacionamiento', 'Bodega', 'Patio'],
    ['Chimenea', 'Vista panorámica', 'Jardín'], ['Cocina americana', 'Terraza', 'Parrilla'],
    ['Dormitorio en suite', 'Walking closet', 'Jardín'], ['Calefacción', 'Bodega', 'Estacionamiento'],
    ['Patio delantero', 'Cocina equipada', 'Bodega'], ['Quincho techado', 'Jardín con pasto', 'Cochera']];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : '';
  const communeData = communeAddresses[commune.name];
  return {
    id: generateId(region.code, commune.name, 'casa', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: getRealDescription(commune.name, 'house', bedrooms, bathrooms, area, idx, communeData),
    price, property_type: 'house', status,
    bedrooms, bathrooms, area_sqm: area, parking_spots: parking, year_built: year,
    address: getRealAddress(commune.name, 'house', idx), city: commune.name, state: region.name,
    zip_code: `${1000000 + (idx * 7919) % 9000000}`,
    images: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80'],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.003) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.003) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7', agent_email: 'arriendos@rix7.cl', agent_phone: '+56 9 0000 0001',
  };
}

// ═══ APARTMENT ═══
function genApartment(region, commune, idx, status) {
  const bedrooms = 1 + (idx % 3);
  const bathrooms = 1 + (idx % 2);
  const area = 45 + (idx * 7) % 120;
  const parking = idx % 2;
  const year = 2010 + (idx * 5) % 15;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 500000 : 250000000) : (status === 'for_rent' ? 200000 : 90000000);
  const price = Math.round((base + (idx * 53000000) % base) / (status === 'for_rent' ? 10000 : 1000000)) * (status === 'for_rent' ? 10000 : 1000000);
  const styles = ['Departamento con Vista al Mar', 'Departamento Moderno Centro', 'Departamento de Lujo con Terraza',
    'Departamento Amoblado', 'Departamento con Gimnasio', 'Departamento Vista Panorámica',
    'Departamento Cerca del Metro', 'Departamento con Estacionamiento', 'Departamento Luminoso', 'Departamento con Bodega'];
  const feats = [['Vista al mar', 'Cocina equipada', 'Estacionamiento'], ['Gimnasio', 'Piscina', 'Salón de eventos'],
    ['Terraza', 'Bodega', 'Seguridad 24h'], ['Cerca del metro', 'Amoblado', 'Lavandería'],
    ['Vista panorámica', 'Calefacción', 'Bodega'], ['Piscina', 'Quincho', 'Estacionamiento techado'],
    ['Cerca del centro', 'Cocina americana', 'Bodega'], ['Terraza privada', 'Vista a la cordillera', 'Estacionamiento']];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : '';
  const communeData2 = communeAddresses[commune.name];
  return {
    id: generateId(region.code, commune.name, 'depto', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: getRealDescription(commune.name, 'apartment', bedrooms, bathrooms, area, idx, communeData2),
    price, property_type: 'apartment', status,
    bedrooms, bathrooms, area_sqm: area, parking_spots: parking, year_built: year,
    address: getRealAddress(commune.name, 'apartment', idx), city: commune.name, state: region.name,
    zip_code: `${2000000 + (idx * 6317) % 8000000}`,
    images: ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80'],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.004) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.004) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7', agent_email: 'arriendos@rix7.cl', agent_phone: '+56 9 0000 0001',
  };
}

// ═══ PARCEL ═══
function genParcel(region, commune, idx, status) {
  const area = 5000 + (idx * 1300) % 45000;
  const year = 2000 + (idx * 3) % 25;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 200000 : 150000000) : (status === 'for_rent' ? 80000 : 40000000);
  const price = Math.round((base + (idx * 31000000) % base) / (status === 'for_rent' ? 10000 : 1000000)) * (status === 'for_rent' ? 10000 : 1000000);
  const styles = ['Parcela con Vista al Valle', 'Parcela de Recreación', 'Parcela Agrícola',
    'Parcela con Viñedo', 'Parcela Turística', 'Parcela con Casa de Campo',
    'Parcela Boscosa', 'Parcela Cerca del Lago', 'Parcela Familiar', 'Parcela con Riego'];
  const feats = [['Riego', 'Pozo de agua', 'Cercada'], ['Casa de campo', 'Bodega', 'Establo'],
    ['Frutales', 'Riego por goteo', 'Pozo'], ['Viñedo', 'Bodega de vinos', 'Casa patronal'],
    ['Vista panorámica', 'Cercada', 'Acceso pavimentado'], ['Casa inclusa', 'Piscina', 'Quincho'],
    ['Bosque nativo', 'Agua potable', 'Luz'], ['Cerca del lago', 'Playa privada', 'Muelle'],
    ['Jardín', 'Parrilla', 'Estacionamiento'], ['Sistema de riego', 'Almacén', 'Terreno plano']];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : '';
  const communeData3 = communeAddresses[commune.name];
  return {
    id: generateId(region.code, commune.name, 'parcela', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: getRealDescription(commune.name, 'parcel', 0, 0, area, idx, communeData3),
    price, property_type: 'parcel', status,
    bedrooms: 0, bathrooms: 0, area_sqm: area, parking_spots: 0, year_built: year,
    address: getRealAddress(commune.name, 'parcel', idx), city: commune.name, state: region.name,
    zip_code: `${3000000 + (idx * 4519) % 7000000}`,
    images: ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80'],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.005) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.005) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7', agent_email: 'arriendos@rix7.cl', agent_phone: '+56 9 0000 0001',
  };
}

// ═══ OFFICE ═══
function genOffice(region, commune, idx, status) {
  const area = 60 + (idx * 11) % 200;
  const parking = 1 + (idx % 3);
  const year = 2008 + (idx * 4) % 18;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 400000 : 200000000) : (status === 'for_rent' ? 150000 : 50000000);
  const price = Math.round((base + (idx * 41000000) % base) / (status === 'for_rent' ? 10000 : 1000000)) * (status === 'for_rent' ? 10000 : 1000000);
  const styles = ['Oficina Moderna Centro', 'Oficina con Vista', 'Sala de Conferencias',
    'Coworking Space', 'Oficina Ejecutiva', 'Local Comercial',
    'Oficina Amoblada', 'Consultorio', 'Oficina Esquinera', 'Studio Creativo'];
  const feats = [['WiFi', 'Aire acondicionado', 'Sala de reuniones'], ['Vista panorámica', 'Cocina', 'Bodega'],
    ['Equipada', 'Proyector', 'Pizarra'], ['Flexibles', 'Imprenta', 'Cafetería'],
    ['Premium', 'Secretaría', 'Estacionamiento'], ['A-facing', 'Vidrios dobles', 'Bodega'],
    ['Mobiliario incluido', 'Internet', 'Recepción'], ['Consultorio equipado', 'Sala de espera', 'Baño privado']];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : '';
  const communeData4 = communeAddresses[commune.name];
  return {
    id: generateId(region.code, commune.name, 'oficina', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: getRealDescription(commune.name, 'office', 0, 1, area, idx, communeData4),
    price, property_type: 'office', status,
    bedrooms: 0, bathrooms: 1, area_sqm: area, parking_spots: parking, year_built: year,
    address: getRealAddress(commune.name, 'office', idx), city: commune.name, state: region.name,
    zip_code: `${4000000 + (idx * 3709) % 6000000}`,
    images: ['https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80'],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.002) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.002) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7', agent_email: 'arriendos@rix7.cl', agent_phone: '+56 9 0000 0001',
  };
}

// ═══ LAND ═══
function genLand(region, commune, idx, status) {
  const area = 200 + (idx * 800) % 9800;
  const year = 2015 + (idx * 2) % 10;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 150000 : 120000000) : (status === 'for_rent' ? 50000 : 25000000);
  const price = Math.round((base + (idx * 27000000) % base) / (status === 'for_rent' ? 10000 : 1000000)) * (status === 'for_rent' ? 10000 : 1000000);
  const styles = ['Terreno Urbanizado', 'Terreno con Vista', 'Lote Residencial',
    'Terreno Comercial', 'Terreno Industrial', 'Lote Esquinero',
    'Terreno Plano', 'Terreno en Altura', 'Lote con Servicios', 'Terreno de Inversión'];
  const feats = [['Servicios básicos', 'Pavimento', 'Cercado'], ['Vista panorámica', 'Acceso principal', 'Plano'],
    ['Zona residencial', 'Agua potable', 'Alcantarillado'], ['Localización comercial', 'Letrero', 'Estacionamiento'],
    ['Zona industrial', 'Carga pesada', 'Luz industrial'], ['Esquina doble frente', 'Pavimento', 'Semáforo'],
    ['Plano', 'Servicios en cota', 'Cercado'], ['Vista al valle', 'Pendiente suave', 'Acceso'],
    ['Agua, luz, gas', 'Pavimento', 'Alcantarillado'], ['Alta plusvalía', 'Zona en crecimiento', 'Acceso']];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : '';
  const communeData5 = communeAddresses[commune.name];
  return {
    id: generateId(region.code, commune.name, 'terreno', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: getRealDescription(commune.name, 'land', 0, 0, area, idx, communeData5),
    price, property_type: 'land', status,
    bedrooms: 0, bathrooms: 0, area_sqm: area, parking_spots: 0, year_built: year,
    address: getRealAddress(commune.name, 'land', idx), city: commune.name, state: region.name,
    zip_code: `${5000000 + (idx * 5113) % 5000000}`,
    images: ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80'],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.006) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.006) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7', agent_email: 'arriendos@rix7.cl', agent_phone: '+56 9 0000 0001',
  };
}

// ═══ PARKING (ESTACIONAMIENTOS) ═══
function genParking(region, commune, idx, status) {
  const area = 12 + (idx * 2) % 15;
  const year = 2012 + (idx * 3) % 12;
  const base = isUrban(region.code) ? (status === 'for_rent' ? 95000 : 18000000) : (status === 'for_rent' ? 45000 : 8000000);
  const price = Math.round((base + (idx * (status === 'for_rent' ? 12000 : 2500000)) % (base * 0.8)) / (status === 'for_rent' ? 5000 : 500000)) * (status === 'for_rent' ? 5000 : 500000);
  const styles = [
    'Estacionamiento Subterráneo Nivel -1',
    'Estacionamiento Techado con Control Remoto',
    'Estacionamiento con Acceso TAG y Seguridad 24/7',
    'Estacionamiento Amplio para Camioneta / SUV',
    'Estacionamiento en Edificio Residencial Moderno',
    'Estacionamiento en Sector Financiero y Comercial',
    'Estacionamiento Subterráneo con Portón Automático',
    'Estacionamiento con Circuito Cerrado TV',
    'Estacionamiento Cerca de Metro y Avenidas Principales',
  ];
  const feats = [
    ['Subterráneo nivel -1', 'Acceso con TAG / Tarjeta', 'Seguridad 24/7', 'Portón automático'],
    ['Cámaras CCTV', 'Conserjería 24 hrs', 'Control remoto', 'Techado'],
    ['Excelente maniobrabilidad', 'Gasto común bajo', 'Iluminación LED', 'Acceso a ascensores'],
    ['Para SUV / Camioneta grande', 'Portón eléctrico', 'Control de acceso', 'Cerca de salida'],
    ['Guardias permanentes', 'Acceso peatonal con tarjeta', 'Red seca y extintores', 'Nivel -2'],
  ];
  const titleSuffix = status === 'for_rent' ? ' en Arriendo' : ' en Venta';
  const communeData = communeAddresses[commune.name];
  const neighborhood = communeData?.neighborhoods ? communeData.neighborhoods[idx % communeData.neighborhoods.length] : commune.name;

  return {
    id: generateId(region.code, commune.name, 'estacionamiento', status),
    title: `${styles[idx % styles.length]}${titleSuffix} en ${commune.name}`,
    description: `Estacionamiento de ${area} m² en sector ${neighborhood}, ${commune.name}. Acceso controlado, seguridad 24 horas y excelente conectividad.`,
    price,
    property_type: 'parking',
    status,
    bedrooms: 0,
    bathrooms: 0,
    area_sqm: area,
    parking_spots: 1,
    year_built: year,
    address: getRealAddress(commune.name, 'parking', idx),
    city: commune.name,
    state: region.name,
    zip_code: `${6000000 + (idx * 3119) % 4000000}`,
    images: [
      'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1590674899484-d5640e854abe?auto=format&fit=crop&w=1200&q=80',
    ],
    features: feats[idx % feats.length],
    lat: Math.round((commune.lat + ((idx * 0.0035) % 0.01) - 0.005) * 10000) / 10000,
    lng: Math.round((commune.lng + ((idx * 0.0035) % 0.01) - 0.005) * 10000) / 10000,
    agent_name: 'Agente Rix7',
    agent_email: 'estacionamientos@rix7.cl',
    agent_phone: '+56 9 0000 0001',
  };
}

// ═══ GENERATE ALL ═══
const properties = [];
let idx = 0;
for (const region of regions) {
  for (const commune of region.communes) {
    // SALE: all types
    if (!existingCommunes.has(commune.name)) {
      properties.push(genHouse(region, commune, idx, 'for_sale'));
    }
    properties.push(genApartment(region, commune, idx, 'for_sale'));
    properties.push(genParcel(region, commune, idx, 'for_sale'));
    properties.push(genOffice(region, commune, idx, 'for_sale'));
    properties.push(genLand(region, commune, idx, 'for_sale'));
    properties.push(genParking(region, commune, idx, 'for_sale'));

    // RENT: all types (except premium)
    properties.push(genHouse(region, commune, idx, 'for_rent'));
    properties.push(genApartment(region, commune, idx, 'for_rent'));
    properties.push(genParcel(region, commune, idx, 'for_rent'));
    properties.push(genOffice(region, commune, idx, 'for_rent'));
    properties.push(genLand(region, commune, idx, 'for_rent'));
    properties.push(genParking(region, commune, idx, 'for_rent'));

    idx++;
  }
}

const counts = {};
const opCounts = { for_sale: 0, for_rent: 0 };
properties.forEach(p => {
  counts[p.property_type] = (counts[p.property_type] || 0) + 1;
  opCounts[p.status] = (opCounts[p.status] || 0) + 1;
});

console.log(`\nGenerated ${properties.length} properties:`);
console.log(`  By type:`, counts);
console.log(`  By operation:`, opCounts);
console.log(`  Sale: ${opCounts.for_sale} | Rent: ${opCounts.for_rent}`);

const tsContent = `import { Property } from '@/lib/types/property';

/**
 * Catálogo de muestra: 5 propiedades por comuna × 2 operaciones (venta + arriendo) = 10 por comuna.
 * Generado automáticamente desde chileLocations.ts
 */
export const SAMPLE_PROPERTIES: Property[] = ${JSON.stringify(properties, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, '../lib/data/sampleProperties.ts'), tsContent);
console.log('\nWritten to lib/data/sampleProperties.ts');
