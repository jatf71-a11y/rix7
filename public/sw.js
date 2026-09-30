/**
 * Service Worker de Rix7 — resistente a deploys (plan fase 3, ítem 1.1).
 *
 * El problema que motivó esta versión: la caché se llamaba SIEMPRE
 * `rix7-v2` y el SW antiguo servía `/_next/static/**` con stale-while-revalidate
 * sobre assets inmutables, además de tiles guardados. Tras un deploy, el HTML
 * nuevo referenciaba los chunks nuevos, pero los navegadores con la app abierta
 * o con SW instalado seguían recibiendo los viejos hasta que el usuario
 * desregistrara el SW a mano.
 *
 * Las dos piezas del arreglo:
 *
 * 1. **Versionado por deploy**: la página inyecta `?v=<commit>` al registrar
 *    `/sw.js`, así el navegador ve un script distinto en cada deploy y lo
 *    descarga aunque `Cache-Control` diga otra cosa (ver
 *    `lib/utils/swRuntime.ts` y el test guardián). El nombre de cada caché
 *    lleva esa versión y `activate` borra todas las demás.
 *
 * 2. **Actualización sin mezclar versiones**: el SW nuevo queda en espera
 *    (no hay `skipWaiting` automático) y el cliente decide. La página lo
 *    activa cuando el usuario acepta el aviso "Nueva versión disponible" —
 *    o solo, en la siguiente navegación completa, donde es seguro.
 *    Nunca se activa a mitad de una sesión con activos de otra versión.
 *
 * El HTML y las llamadas a la API son network-first: el contenido fresco
 * manda. Solo tiles e imágenes son cache-first, con TTL para que las
 * imágenes que una propiedad borra (o reemplaza) no vivan eternamente.
 */

// Los archivos estáticos de /_next/static ya traen hash en su nombre y
// Cache-Control immutable de un año: son válidos para SIEMPRE y una caché
// por versión solo obliga a re-descargar lo que ya estaba en el disco.
// Los assets sin hash, con TTL corto; el SW nuevo los re-llena al activarse.
const PERSISTENT_CACHE = 'rix7-static';
// La versión viaja en la URL con que la página registra este archivo
// (`/sw.js?v=<commit>`, ver `lib/utils/swRuntime.ts`): cambia en cada deploy y
// con ella el nombre de la caché versionada — el bump que limpia todo lo viejo
// en el `activate` de cada deploy.
const VERSION =
  (self.serviceWorker && self.serviceWorker.scriptURL.split('?v=')[1]) || 'dev';
// Caché con nombre de versión: manifest, respaldo de API y HTML de respaldo.
// `activate` elimina la del deploy anterior.
const VERSIONED_CACHE = 'rix7-runtime-' + VERSION;
const TILE_CACHE = 'rix7-tiles-v1';
const IMAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // imágenes: 14 días
const TILE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // tiles: 30 días

// Con cache-control revalidable para sw.js, esto casi no ocurre; pero si un
// SW con esta versión ya no sirve (deploy revertido, dominio distinto), la
// caché persistente muere con su dueño y el navegador la limpia entera.
const STATIC_ASSETS = ['/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSIONED_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
    // Sin skipWaiting: el SW nuevo espera a que el cliente lo libere
    // (mensaje SKIP_WAITING) o a la próxima navegación. Ver cabecera.
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Todos los cachés que no son de esta versión: los versionados
            // viejos (rix7-runtime-*) y cualquier rastro de la era rix7-v2.
            .filter((key) => key !== VERSIONED_CACHE && key !== TILE_CACHE && key !== PERSISTENT_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// El cliente (ServiceWorkerRegistration) pide activar el SW en espera cuando
// el usuario aceptó el aviso de nueva versión.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** ¿La entrada en caché sigue viva según su marca de tiempo en x-swr-at? */
function isFresh(cached, ttlMs) {
  if (!cached) return false;
  const written = cached.headers.get('x-swr-at');
  if (!written) return true; // entrada sin marca: se queda (comportamiento previo)
  return Date.now() - Number(written) < ttlMs;
}

/** Caché-first con TTL y re-escritura en background (stale-if-expired). */
function cacheFirstTtl(request, cacheName, ttlMs) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          clone.headers.set('x-swr-at', String(Date.now()));
          cache.put(request, clone);
        }
        return response;
      });
      if (isFresh(cached, ttlMs)) {
        fetchPromise.catch(() => {});
        return cached;
      }
      // Expirada (o vacía): la red manda, la caché es el plan B sin TTL.
      return fetchPromise.catch(() => cached);
    })
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo GET: POST/PATCH/DELETE (favoritos, leads, feed admin) van a la red
  // sin excepción — `event.respondWith` de un POST roto come errores y
  // duplica lógica de negocio en el SW.
  if (event.request.method !== 'GET') return;

  // OpenStreetMap tiles: cache-first con TTL.
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('a.tile.') ||
    url.hostname.includes('b.tile.') ||
    url.hostname.includes('c.tile.')
  ) {
    event.respondWith(cacheFirstTtl(event.request, TILE_CACHE, TILE_TTL_MS));
    return;
  }

  // Imágenes de propiedades: cache-first con TTL.
  if (url.hostname.includes('images.unsplash.com') || url.hostname.includes('.supabase.co')) {
    event.respondWith(cacheFirstTtl(event.request, PERSISTENT_CACHE, IMAGE_TTL_MS));
    return;
  }

  // API: network-first con caché como red de seguridad (solo GET, ver arriba).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(VERSIONED_CACHE).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Assets con hash: la red directa es la forma más simple y correcta. El
  // navegador los cachea igual (immutable de un año) y es imposible servir
  // un chunk viejo con HTML nuevo, que era el bug de origen.
  if (
    event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    event.request.destination === 'font' ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Resto (navegaciones): network-first con caché de la versión actual.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request, { cacheName: VERSIONED_CACHE })
    )
  );
});
