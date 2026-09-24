/**
 * Regla de «una apertura por sesión del navegador» para el aviso de la landing.
 *
 * Vive aparte del componente porque es la única parte del aviso que tiene una
 * decisión adentro (¿este enlace ya se contó en esta pestaña?), y porque en el
 * proyecto no hay biblioteca de tests de componentes: adentro del componente la
 * regla solo se podría probar a mano.
 *
 * Lo que se mide es **cuántas veces se abre el enlace**, así que recargar la
 * página o volver a ella en la misma pestaña no vuelve a contar. Cerrar la
 * pestaña y abrir el enlace de nuevo sí: para la corredora eso es un enlace que
 * volvió a circular.
 */

/** Lo mínimo de `sessionStorage` que hace falta (permite inyectar un doble). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function shareViewMarkerKey(propertyId: string): string {
  return `rix7_share_view_${propertyId}`;
}

/**
 * Intenta marcar la apertura de esta propiedad en esta sesión.
 *
 * @returns `true` si hay que avisar al servidor (recién reclamado), `false` si
 * esta sesión ya la había contado.
 *
 * Si el almacenamiento falla (modo privado estricto, cuota, navegador sin
 * `sessionStorage`), devuelve `true`: se prefiere contar de más a perder una
 * apertura que sí ocurrió.
 */
export function claimShareViewMarker(
  storage: KeyValueStore | null | undefined,
  propertyId: string
): boolean {
  const key = shareViewMarkerKey(propertyId);

  if (!storage) return true;

  try {
    if (storage.getItem(key)) return false;
    // Se marca **antes** de enviar: si la persona recarga mientras el aviso
    // viaja, no se manda por segunda vez.
    storage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}
