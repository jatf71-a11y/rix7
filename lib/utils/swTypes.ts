/**
 * Tipos mínimos del ciclo de vida del Service Worker.
 *
 * Existen para que `swRuntime.ts` (y sus tests) puedan describir registros
 * falsos sin acoplarse a la API completa de `ServiceWorkerRegistration` —
 * la que expone el navegador incluye propiedades y eventos que aquí no
 * importan. Estructura compatible con la real: castear es seguro.
 */

/** Un worker (instalando, en espera o activo) reducido a lo que usamos. */
export interface WaitingWorker {
  /** `parsed` existe en lib.dom y no puede omitirse: sin él, el registro
   * real del navegador deja de ser asignable a esta forma. */
  state: 'parsed' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';
  scriptURL: string;
  postMessage(message: unknown): void;
}

/** Registro del SW según lo que `swRuntime` necesita conocer. */
export interface ServiceWorkerRegistrationLike {
  waiting: WaitingWorker | null;
  installing?: WaitingWorker | null;
  active?: WaitingWorker | null;
  scope: string;
  /** Re-consulta al navegador si hay un SW nuevo esperando. `unknown` y no
   * `void`: la API real devuelve el registro, y el tipo debe admitirla. */
  update(): Promise<unknown>;
}
