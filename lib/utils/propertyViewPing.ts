/**
 * Regla de «una visita por sesión del navegador» para la ficha de una propiedad.
 *
 * Lo que se mide es cuántas veces se abre la ficha, no cuánta gente la vio: la
 * misma mecánica del aviso de enlaces compartidos (ver `claimSessionMarker`),
 * con su propia clave para no mezclar contadores. Recargar la ficha en la misma
 * pestaña no vuelve a sumar; abrirla en otra pestaña o en otro dispositivo sí.
 */

import { claimSessionMarker, type KeyValueStore } from './sessionMarker';

export type { KeyValueStore };

export function propertyViewMarkerKey(propertyId: string): string {
  return `rix7_property_view_${propertyId}`;
}

/**
 * Intenta marcar la visita de esta propiedad en esta sesión.
 *
 * @returns `true` si corresponde avisar al servidor (recién reclamado),
 * `false` si esta sesión ya la había contado.
 */
export function claimPropertyViewMarker(
  storage: KeyValueStore | null | undefined,
  propertyId: string
): boolean {
  return claimSessionMarker(storage, propertyViewMarkerKey(propertyId));
}
