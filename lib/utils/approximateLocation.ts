/**
 * Difumina una ubicación exacta para poder mostrarla en público.
 *
 * La landing compartible no puede publicar el punto exacto de la propiedad: la
 * dirección es justamente lo que la corredora entrega al interesado. Pero
 * tampoco sirve un mapa en blanco — el entorno es parte de lo que se vende.
 *
 * La solución es mostrar un punto **cercano pero falso**: se desplaza entre
 * ~130 y ~230 m en una dirección derivada del id de la propiedad. Con eso el
 * vecindario se reconoce, y quien amplíe el mapa hasta el último nivel de zoom
 * centra la vista en una manzana distinta, no en el edificio.
 *
 * El desplazamiento es **determinista**: la misma propiedad siempre da el mismo
 * punto. Uno aleatorio por render haría que dos personas mirando el mismo
 * enlace vieran mapas distintos (y que la página cambie al recargar, lo que
 * delata que el punto no es real).
 */

/** Distancia mínima y máxima del desplazamiento, en metros. */
export const MIN_OFFSET_M = 130;
export const MAX_OFFSET_M = 230;

/** Metros por grado de latitud (constante suficiente para esta escala). */
const M_PER_DEG_LAT = 111_320;

/**
 * Hash estable y sin dependencias (FNV-1a de 32 bits) sobre el texto.
 * Sirve para convertir el id en una dirección y una distancia reproducibles.
 */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface ApproximatePoint {
  lat: number;
  lng: number;
  /** Distancia desplazada, en metros (útil para tests y para el texto de la UI). */
  offsetM: number;
}

/**
 * Punto aproximado y estable para una propiedad.
 *
 * @param lat Latitud real.
 * @param lng Longitud real.
 * @param seed Semilla del desplazamiento (el id de la propiedad).
 */
export function approximatePoint(lat: number, lng: number, seed: string): ApproximatePoint {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { lat, lng, offsetM: 0 };
  }

  const h = hash32(seed || `${lat},${lng}`);
  // Dirección: 0–360° con dos decimales de resolución del hash
  const angle = ((h % 3600) / 3600) * 2 * Math.PI;
  // Distancia: siempre dentro del rango (nunca 0, nunca un punto exacto)
  const span = MAX_OFFSET_M - MIN_OFFSET_M;
  const offsetM = MIN_OFFSET_M + ((h >>> 12) % (span + 1));

  const dLat = (offsetM * Math.cos(angle)) / M_PER_DEG_LAT;
  // Un grado de longitud se acorta al alejarse del ecuador
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = (offsetM * Math.sin(angle)) / (M_PER_DEG_LAT * Math.max(cosLat, 0.01));

  return { lat: lat + dLat, lng: lng + dLng, offsetM };
}
