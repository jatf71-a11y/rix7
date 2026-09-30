/**
 * Guard: resiliencia del Service Worker frente a deploys (plan fase 3, 1.1).
 *
 * El bug de producción que motivó 1.1 fue doble: (a) la página registraba
 * SIEMPRE `/sw.js` sin versión, así que el navegador rara vez veía un script
 * nuevo tras un deploy; y (b) `install` hacía `self.skipWaiting()`, con lo
 * que el SW nuevo tomaba el mando de pestañas que aún ejecutaban HTML y
 * chunks de la versión anterior — el sitio "se veía roto" hasta desregistrar
 * el SW a mano.
 *
 * Este test valida el contrato completo extrayendo el **fuente** de
 * `public/sw.js` y del componente de registro. Es test de fuente a propósito:
 * el SW es un archivo plano servido desde `/public` — no pasa por el
 * transform de Next y no se puede importar; su comportamiento solo es
 * observable así (mismo enfoque que `cspCoverage.test.ts`).
 *
 * Cómo extender: cada regla nueva del ciclo de vida se agrega acá como
 * invariante de fuente. Nunca se relaja un invariante para "hacer pasar"
 * el test: eso apaga el guard.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getWaitingWorker,
  normalizeVersion,
  shouldReloadAfterActivate,
  SW_VERSION_SOURCE_MARK,
  swRegistrationUrl,
} from './swRuntime';

const swSource = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
const registrationSource = readFileSync(
  join(process.cwd(), 'components', 'ServiceWorkerRegistration.tsx'),
  'utf8'
);

/**
 * El sw.js sin comentarios: lo que cuenta es el comportamiento, y una
 * mención en un comentario (`// antes usábamos stale-while-revalidate`)
 * no debe poder disparar —ni silenciar— un invariante.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Fuente sin espacios: para asserts sobre APIs partidas en varias líneas. */
const swCode = stripComments(swSource).replace(/\s+/g, '');

describe('contrato de versión del SW entre página y sw.js', () => {
  it('sw.js deriva la caché versionada del ?v= del scriptURL', () => {
    // Es el "bump por deploy": la página manda ?v=<sha> y sw.js lo usa como
    // sufijo del nombre de la caché versionada que `activate` limpia.
    expect(swSource).toContain(SW_VERSION_SOURCE_MARK);
    expect(swSource).toContain("scriptURL.split('?v=')[1]");
  });

  it('la página registra con la versión del deploy (?v=)', () => {
    // Si la página volviera a registrar sin versión, el navegador dejaría de
    // ver los deploys y volvería el sitio roto de la era rix7-v2.
    expect(registrationSource).toContain('swRegistrationUrl()');
    expect(swRegistrationUrl('abc1234')).toBe('/sw.js?v=abc1234');
    expect(swRegistrationUrl()).toBe('/sw.js?v=local');
  });

  it('la página detecta el SW en espera (getWaitingWorker + statechange)', () => {
    expect(registrationSource).toContain('getWaitingWorker(');
    expect(registrationSource).toContain('statechange');
  });
});

describe('invariantes del ciclo de vida en sw.js', () => {
  it('NO hace skipWaiting automático: solo dentro del handler de mensajes', () => {
    // skipWaiting en install activaba el SW nuevo bajo pestañas viejas: era
    // la mitad del bug de origen. El único skipWaiting permitido responde al
    // mensaje SKIP_WAITING del cliente, que decide cuándo es seguro.
    const messageBlock =
      swSource.match(/addEventListener\('message'[\s\S]*?\}\);/)?.[0] ?? '';
    expect(messageBlock).toContain("event.data === 'SKIP_WAITING'");
    expect(messageBlock).toContain('self.skipWaiting()');
    const outsideMessage = stripComments(swSource).replace(messageBlock, '');
    expect(outsideMessage).not.toContain('skipWaiting');
  });

  it('no aplica stale-while-revalidate a nada (assets con hash van a la red)', () => {
    // El SW viejo revalidaba /_next/static y podía servir chunks viejos
    // contra HTML nuevo. Ahora pasan directos: el nombre con hash es la caché.
    expect(swCode).not.toContain('stale-while-revalidate');
    expect(swCode).toContain("url.pathname.startsWith('/_next/static/')");
  });

  it('solo intercepta GET (los POST de negocio van a la red)', () => {
    expect(swCode).toContain("event.request.method!=='GET'");
  });

  it('activate limpia las cachés que no son de esta versión', () => {
    expect(swCode).toContain('caches.keys()');
    expect(swCode).toContain('caches.delete(key)');
    expect(swCode).toContain('key!==VERSIONED_CACHE');
    // Conserva tiles e imágenes entre versiones (son las únicas excepciones).
    expect(swCode).toContain('key!==TILE_CACHE');
    expect(swCode).toContain('key!==PERSISTENT_CACHE');
  });

  it('las imágenes cacheadas llevan marca de tiempo (TTL), no viven para siempre', () => {
    expect(swCode).toContain('x-swr-at');
    expect(swCode).toMatch(/IMAGE_TTL_MS=/);
  });
});

describe('decisor de recarga (shouldReloadAfterActivate)', () => {
  it('no recarga sin controlador: nada que reponer', () => {
    expect(shouldReloadAfterActivate({ hasController: false, preloadAgeMs: 1e9 })).toBe(false);
  });

  it('recarga con controlador si el preload terminó', () => {
    expect(shouldReloadAfterActivate({ hasController: true, preloadStatus: 'loaded' })).toBe(true);
    expect(shouldReloadAfterActivate({ hasController: true, preloadAgeMs: Infinity })).toBe(true);
  });

  it('no recarga con el preload recién empezado o en vuelo', () => {
    expect(shouldReloadAfterActivate({ hasController: true, preloadAgeMs: 0 })).toBe(false);
    expect(shouldReloadAfterActivate({ hasController: true, preloadAgeMs: 5_000 })).toBe(false);
  });

  it('recarga si el preload venció la gracia (15 s)', () => {
    expect(shouldReloadAfterActivate({ hasController: true, preloadAgeMs: 15_001 })).toBe(true);
  });

  it('no recarga sin señal del preload (comportamiento conservador)', () => {
    expect(shouldReloadAfterActivate({ hasController: true })).toBe(false);
  });
});

describe('helpers de runtime', () => {
  it('getWaitingWorker: null sin registro o sin estado installed', () => {
    expect(getWaitingWorker(null)).toBe(null);
    const activating = {
      waiting: { state: 'activating', scriptURL: '/sw.js?v=1', postMessage: () => {} },
      scope: '/',
      update: async () => {},
    } as const;
    expect(getWaitingWorker(activating)).toBe(null);
    const installed = {
      waiting: { state: 'installed', scriptURL: '/sw.js?v=1', postMessage: () => {} },
      scope: '/',
      update: async () => {},
    } as const;
    expect(getWaitingWorker(installed)).not.toBe(null);
  });

  it('normalizeVersion: fallback seguro sin SHA', () => {
    expect(normalizeVersion(undefined)).toBe('local');
    expect(normalizeVersion('  ')).toBe('local');
    expect(normalizeVersion('abc1234')).toBe('abc1234');
  });
});
