/**
 * Lógica pura del ciclo de vida del Service Worker (plan fase 3, ítem 1.1).
 *
 * El bug que motivó 1.1: el SW se registraba SIEMPRE contra `/sw.js` con la
 * misma caché `rix7-v2`, y `skipWaiting()` en install activaba cada SW nuevo
 * inmediatamente — un navegador recurrente podía quedar con HTML nuevo y
 * assets viejos (o viceversa) hasta desregistrar el SW a mano. La corrección
 * tiene dos mitades que deben evolucionar juntas:
 *
 * 1. La página registra `/sw.js?v=<commit>`: el navegador compara el script
 *    byte a byte en cada chequeo y baja el nuevo sin depender del HTTP
 *    caching. Este módulo provee esa URL y valida el contrato.
 *
 * 2. El SW nuevo queda en espera (el sw.js ya no hace `skipWaiting`
 *    automático) y la página decide: aviso "Nueva versión disponible" o
 *    auto-activación cuando es seguro recargar.
 *    `shouldReloadAfterActivate` es el decisor: recarga solo si hay
 *    controlador (la pestaña vive bajo el SW viejo) y el preload de la
 *    nueva versión terminó o venció su plazo de gracia. Jamás recarga sin
 *    controlador: una página que nunca tuvo SW no tiene nada que reponer.
 *
 * La mitad (1) queda guardada por `lib/utils/swResilience.test.ts`, que
 * extrae del código fuente de `public/sw.js` que el nombre de la caché
 * versionada deriva del `?v=` del scriptURL — si alguien rompe el contrato,
 * rompe el CI, no producción.
 */
import type { ServiceWorkerRegistrationLike, WaitingWorker } from './swTypes';

/** Query param con el que la página registra el SW: `?v=<commit>`. */
const SW_VERSION_PARAM = 'v';

/** Delay antes de recargar, para dar tiempo a que el aviso desaparezca. */
export const RELOAD_DELAY_MS = 800;

/** Plazo de gracia del preload antes de considerarlo vencido. */
const PRELOAD_GRACE_MS = 15_000;

/** Normaliza la versión del deploy: SHA de Vercel o fallback local. */
export function normalizeVersion(version?: string | null): string {
  if (version && version.trim()) return version.trim();
  return 'local';
}

/** Devuelve la URL de registro del SW para el deploy actual. */
export function swRegistrationUrl(version?: string | null): string {
  return `/sw.js?${SW_VERSION_PARAM}=${normalizeVersion(
    version ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  )}`;
}

/** Cadena que debe aparecer en `public/sw.js`: el `?v=` del que nace la caché. */
export const SW_VERSION_SOURCE_MARK = "scriptURL.split('?v=')";

/** Extrae el SW en espera de un registro, si lo hay. */
export function getWaitingWorker(
  registration: ServiceWorkerRegistrationLike | null | undefined
): WaitingWorker | null {
  if (!registration) return null;
  if (registration.waiting && registration.waiting.state === 'installed') {
    return registration.waiting;
  }
  return null;
}

/** ¿Esta página ya corre bajo el SW? (hay controlador activo) */
export function hasController(
  navigatorLike: Pick<Navigator, 'serviceWorker'> = navigator
): boolean {
  return !!navigatorLike.serviceWorker?.controller;
}

/** Estado del preload de los chunks de la nueva versión. */
type PreloadStatus = 'idle' | 'loading' | 'loaded';

/** Entrada del decisor de recarga (ver `shouldReloadAfterActivate`). */
export interface ShouldReloadInput {
  hasController: boolean;
  /** Estado del preload de la nueva versión (ver `PRELOAD_STATUS`). */
  preloadStatus?: PreloadStatus;
  /** Milisegundos desde que empezó el preload, si empezó. */
  preloadAgeMs?: number;
}

/**
 * ¿Recargar la página tras activar el SW en espera?
 *
 * Recarga solo si hay controlador (la página corre bajo una versión vieja)
 * y no hay nada en vuelo que la recarga rompería: el preload de la nueva
 * versión terminó o venció su plazo de gracia. Sin controlador no hay nada
 * que reponer: el claim de `activate` basta.
 */
export function shouldReloadAfterActivate(input: ShouldReloadInput): boolean {
  if (!input.hasController) return false;
  if (input.preloadStatus === 'loaded') return true;
  if (input.preloadAgeMs !== undefined && input.preloadAgeMs >= PRELOAD_GRACE_MS) return true;
  return false;
}
