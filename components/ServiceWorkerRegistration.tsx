'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getWaitingWorker,
  hasController,
  RELOAD_DELAY_MS,
  shouldReloadAfterActivate,
  swRegistrationUrl,
} from '@/lib/utils/swRuntime';
import type { WaitingWorker } from '@/lib/utils/swTypes';

/**
 * Registro del Service Worker y ciclo de actualización (plan fase 3, 1.1).
 *
 * El SW se registra con la versión del deploy en la query (`/sw.js?v=<sha>`),
 * así el navegador detecta el nuevo script en cada deploy sin depender del
 * HTTP caching. El SW nuevo queda **en espera**: este componente muestra el
 * aviso "Nueva versión disponible" y solo al aceptarlo manda `SKIP_WAITING`
 * y recarga — tras comprobar que es seguro (hay controlador viejo y la
 * precarga del documento nuevo terminó). "Más tarde" lo deja dormir: entra
 * solo en la próxima navegación completa, que es igual de segura.
 */

/** Clave de sesión para no molestar dos veces con la misma versión. */
const DISMISSED_KEY = 'rix7-sw-update-dismissed';

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<WaitingWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const preloadStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // En desarrollo el SW cachea recursos y esconde los cambios ("no se ve
    // lo que edité"): se desregistra todo y se limpian las cachés.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          if (registrations.length > 0) {
            console.log('[Rix7] Modo dev: desregistrando', registrations.length, 'service worker(s)');
          }
          return Promise.all(registrations.map((registration) => registration.unregister()));
        })
        .catch(() => {});

      if ('caches' in window) {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .catch(() => {});
      }
      return;
    }

    const announce = (worker: WaitingWorker) => {
      // Si la misma versión ya fue rechazada en esta sesión, no vuelve a
      // molestar; con un deploy nuevo la URL del script cambia y avisa de nuevo.
      let dismissed: string | null = null;
      try {
        dismissed = sessionStorage.getItem(DISMISSED_KEY);
      } catch {
        dismissed = null;
      }
      if (dismissed === worker.scriptURL) return;
      preloadStartedAt.current = Date.now();
      // Precarga del documento con revalidación: confirma que el deploy
      // responde y deja caliente la carga que sigue a la recarga.
      fetch(window.location.href, { cache: 'reload' })
        .then(() => {
          preloadStartedAt.current = -1; // -1 = preload completo
        })
        .catch(() => {});
      setWaiting(worker);
    };

    navigator.serviceWorker
      .register(swRegistrationUrl())
      .then((registration) => {
        // Puede haber un SW en espera de una visita anterior: avisar igual.
        const pending = getWaitingWorker(registration);
        if (pending) announce(pending);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // Sin `navigator.serviceWorker.controller` es el primer SW: no hay
            // versión vieja que reemplazar y no hace falta ningún aviso.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing as WaitingWorker);
            }
          });
        });
      })
      .catch((error) => {
        console.log('[Rix7] Service Worker registration failed:', error);
      });
  }, []);

  const activateWaiting = () => {
    if (!waiting || updating) return;
    setUpdating(true);

    const controller = hasController();
    const preloadAgeMs =
      preloadStartedAt.current === null
        ? undefined
        : preloadStartedAt.current === -1
          ? Infinity
          : Date.now() - preloadStartedAt.current;

    // ¿Recargar acá? Solo si esta pestaña vive bajo una versión vieja del SW
    // y su precarga terminó (o venció el plazo de gracia). Si no, la versión
    // nueva entra sola en la próxima navegación: nada que reponer a la fuerza.
    const reload = shouldReloadAfterActivate({ hasController: controller, preloadAgeMs });

    navigator.serviceWorker.ready
      .then((registration) => {
        registration.waiting?.postMessage('SKIP_WAITING');
      })
      .catch(() => {});

    if (!reload) {
      setWaiting(null);
      setUpdating(false);
      return;
    }

    let reloaded = false;
    const doReload = () => {
      if (reloaded) return;
      reloaded = true;
      window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    };
    // El cambio de controlador confirma que la versión nueva tomó el mando.
    navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true });
    // Fallback por si el evento no llega (SW sin claim, cierre del navegador).
    window.setTimeout(doReload, 3500);
  };

  const dismiss = () => {
    if (!waiting) return;
    try {
      sessionStorage.setItem(DISMISSED_KEY, waiting.scriptURL);
    } catch {
      // sessionStorage bloqueado: el aviso simplemente puede reaparecer.
    }
    setWaiting(null);
  };

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
        <span>
          <span className="block font-medium">Nueva versión disponible</span>
          <span className="block text-slate-300">Recarga para ver los cambios.</span>
        </span>
        <button
          type="button"
          onClick={activateWaiting}
          disabled={updating}
          className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {updating ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md px-2 py-1.5 text-slate-300 hover:text-white"
        >
          Más tarde
        </button>
      </div>
    </div>
  );
}
