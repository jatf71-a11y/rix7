'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // En desarrollo el SW cachea los chunks de /_next/static con
    // stale-while-revalidate: tras una edición sirve JS viejo contra HTML
    // nuevo, lo que provoca errores de hidratación y comportamiento
    // desactualizado ("no se ve el cambio"). En dev desregistramos cualquier
    // SW previo y limpiamos sus cachés.
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

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[Rix7] Service Worker registered:', registration.scope);
      })
      .catch((error) => {
        console.log('[Rix7] Service Worker registration failed:', error);
      });
  }, []);

  return null;
}
