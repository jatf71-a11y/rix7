/**
 * Regla de «una apertura por sesión del navegador» para el aviso de la landing.
 *
 * Lo que se mide es **cuántas veces se abre el enlace**, así que recargar la
 * página o volver a ella en la misma pestaña no vuelve a contar. Cerrar la
 * pestaña y abrir el enlace de nuevo sí: para la corredora eso es un enlace que
 * volvió a circular.
 *
 * La mecánica vive en `claimSessionMarker`, que comparte con el contador de
 * visitas de la ficha; acá solo queda la clave propia de este aviso.
 */

import { claimSessionMarker, type KeyValueStore } from './sessionMarker';

export type { KeyValueStore };

export function shareViewMarkerKey(propertyId: string): string {
  return `rix7_share_view_${propertyId}`;
}

/**
 * Intenta marcar la apertura de esta propiedad en esta sesión.
 *
 * @returns `true` si hay que avisar al servidor (recién reclamado), `false` si
 * esta sesión ya la había contado.
 */
export function claimShareViewMarker(
  storage: KeyValueStore | null | undefined,
  propertyId: string
): boolean {
  return claimSessionMarker(storage, shareViewMarkerKey(propertyId));
}
