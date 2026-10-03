/**
 * Regla de «contar una vez por sesión del navegador».
 *
 * Nació para las aperturas de enlaces compartidos y ahora la comparte el
 * contador de visitas de la ficha: la decisión (¿esta pestaña ya lo contó?) es
 * idéntica, solo cambia la clave. Vive aparte porque en el proyecto no hay
 * biblioteca de tests de componentes y, adentro de un componente, esta regla
 * solo se podría probar a mano.
 */

/** Lo mínimo de `sessionStorage` que hace falta (permite inyectar un doble). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Intenta marcar `key` en esta sesión.
 *
 * @returns `true` si hay que avisar al servidor (recién reclamado), `false` si
 * esta sesión ya lo había contado.
 *
 * Si el almacenamiento falla (modo privado estricto, cuota, navegador sin
 * `sessionStorage`), devuelve `true`: se prefiere contar de más a perder un
 * evento que sí ocurrió.
 */
export function claimSessionMarker(
  storage: KeyValueStore | null | undefined,
  key: string
): boolean {
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
