#!/usr/bin/env node
/**
 * Dónde vive la build de Next: una función, un solo lugar.
 *
 * Un `distDir` compartido y mutable fue el origen del rojo falso del performance
 * budget: `next dev -p 3939` y `next dev -p 3111` escriben los dos en el mismo
 * `.next`, así que el que compila último evicta los chunks del otro y el gate
 * mide lo que encuentre —chunks de desarrollo, un manifest a medias— contra una
 * línea base de producción. El puerto no aísla nada; el directorio sí.
 *
 * El distDir efectivo es `NEXT_DIST_DIR` si está definido, y `.next` si no. Ese
 * default es intencionado: CI, Vercel y `deploy:prod` esperan `.next`, así que
 * nada de esto los toca — solo cambia lo que hacen los hilos que eligen un slot.
 *
 * Restricción de Next que decidió el diseño: **`distDir` tiene que ser una ruta
 * relativa al proyecto**. Next no la interpreta como absoluta, la une a la raíz
 * (`path.join(root, distDir)`), así que un slot en el directorio temporal del
 * sistema terminaba en `C:\repo\C:\Users\…\Temp\rix7-next-3999` y el servidor
 * moría con ENOENT. Por eso los slots viven dentro del árbol.
 *
 * Y dentro del árbol hay un solo sitio que cumple las dos condiciones que
 * importan, sin tocar `.gitignore` ni el deploy:
 *
 * 1. Ya está ignorado por git — un `.next-3939/` suelto aparecería en
 *    `git status` y podría colarse en un commit.
 * 2. Ya está fuera de la copia que publica `deploy:prod` (su lista `EXCLUDED`)
 *    — si no, los artefactos de dev viajarían a Vercel.
 *
 * Ese sitio es `.freebuff/` («estado local de las herramientas»), y cada slot
 * va en `.freebuff/next-<slot>`. El typecheck los ignora por la entrada que
 * `tsconfig.json` agrega a su `exclude`: si no, `tsc` compilaría los validadores
 * que Next genera dentro de cada slot.
 *
 * Las dos razones se afirman en los tests (`next-paths.test.ts`): si alguien
 * saca `.freebuff/` del `.gitignore` o de la lista del deploy, la suite avisa.
 */
import { isAbsolute, resolve } from 'node:path';

/** El distDir de siempre. CI, Vercel y `deploy:prod` dependen de este valor. */
export const DEFAULT_DIST_DIR = '.next';

/** La carpeta ya ignorada por git y ya excluida de la copia del deploy. */
export const SLOT_ROOT = '.freebuff';

/** El prefijo de las carpetas de slot, para reconocerlas de un vistazo. */
export const SLOT_PREFIX = 'rix7-next-';

/** Puerto de dev por defecto del repo (`README.md`: http://localhost:3000). */
export const DEFAULT_DEV_PORT = 3000;

/**
 * Normaliza un slot (normalmente un puerto) a algo seguro para un nombre de
 * carpeta. Un slot vacío o con basura cae al puerto por defecto en vez de
 * generar un nombre raro o una ruta de escape.
 *
 * @param {string | number} [slot]
 */
export function slotKey(slot) {
  const key = String(slot ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '');
  return key || String(DEFAULT_DEV_PORT);
}

/**
 * La carpeta de artefactos de un hilo, **relativa a la raíz del proyecto**:
 * `.freebuff/next-<slot>`. Relativa porque es lo único que Next acepta como
 * `distDir` (ver la nota de arriba).
 *
 * @param {string | number} [slot]
 */
export function slotDistDir(slot) {
  return `${SLOT_ROOT}/${SLOT_PREFIX}${slotKey(slot)}`;
}

/**
 * El tsconfig generado del slot: `.freebuff/next-<slot>.tsconfig.json`.
 *
 * Va **fuera** del distDir a propósito: `next dev` vacía el distDir al
 * arrancar, así que un archivo escrito ahí desaparece antes de que Next lo lea
 * (el typecheck se queda sin `paths` y el alias `@/` deja de resolverse).
 *
 * @param {string | number} [slot]
 */
export function slotTsconfigPath(slot) {
  return `${SLOT_ROOT}/${SLOT_PREFIX}${slotKey(slot)}.tsconfig.json`;
}

/**
 * El tsconfig que usará el typecheck dentro de un slot.
 *
 * Existe por una razón concreta: cuando el `distDir` no es `.next`, Next mete su
 * carpeta `types` en el `include` de `tsconfig.json` y **reescribe el archivo
 * completo, reformateado**. Ese archivo está versionado, así que cada arranque
 * en un slot dejaría un diff ajeno en `git status` y dos hilos se pisarían.
 * Con este archivo —generado en `.freebuff/`, ignorado por git— Next desahoga
 * ahí su escritura y el tsconfig de la raíz no se toca.
 *
 * Lo usan el dev server (`dev.mjs`) y la build (`build.mjs`), que así protegen
 * el tsconfig de la raíz incluso si el slot nunca tuvo un `next dev`.
 *
 * Hereda `compilerOptions` del tsconfig real y replica su `include`/`exclude`
 * subiendo un nivel por componente de ruta.
 *
 * El `baseUrl` va **absoluto** por una razón que costó dos intentos: Next y
 * TypeScript resuelven un `baseUrl` relativo contra directorios distintos —Next
 * contra la raíz del proyecto (`path.resolve(dir, baseUrl)` en su
 * `load-jsconfig`), TypeScript contra la carpeta del propio tsconfig—, así que
 * un valor relativo le da la razón a uno y rompe el alias `@/` para el otro
 * (el dev server responde 500 con «Can't resolve '@/components/…'»). Un
 * absoluto lo leen los dos igual, y como el archivo es generado y está fuera
 * del control de versiones, que sea específico de la máquina no molesta.
 *
 * @param {string} tsconfigPath ruta del tsconfig generado, relativa al proyecto
 * @param {{ root?: string }} [options]
 */
export function slotTsconfigSource(tsconfigPath, { root = process.cwd() } = {}) {
  const levels = tsconfigPath.split(/[\\/]+/).filter(Boolean).length - 1;
  const up = levels < 1 ? '.' : Array(levels).fill('..').join('/');
  const baseUrl = resolve(root);

  return `${JSON.stringify(
    {
      extends: `${up}/tsconfig.json`,
      compilerOptions: { baseUrl },
      include: [
        `${up}/next-env.d.ts`,
        `${up}/**/*.ts`,
        `${up}/**/*.tsx`,
        `${up}/.next/types/**/*.ts`,
      ],
      exclude: [`${up}/node_modules`, `${up}/.freebuff`],
    },
    null,
    2
  )}\n`;
}

/**
 * El distDir efectivo de un proceso, resuelto a ruta absoluta para poder leer
 * archivos sin depender del directorio de trabajo.
 *
 * `NEXT_DIST_DIR` puede ser relativo (lo normal) o absoluto (lo acepta el gate
 * con `--dir`, para medir una copia de verificación); ausente o en blanco
 * significa el default `.next`.
 *
 * @param {{ root?: string, env?: Record<string, string | undefined> }} [options]
 */
export function resolveDistDir({ root = process.cwd(), env = process.env } = {}) {
  const configured = typeof env.NEXT_DIST_DIR === 'string' ? env.NEXT_DIST_DIR.trim() : '';
  if (configured === '') return resolve(root, DEFAULT_DIST_DIR);
  return resolve(root, configured);
}

/**
 * ¿Es este el distDir compartido —el que leen CI, Vercel y el deploy—?
 *
 * Las rutas relativas se resuelven contra `root` (no contra el directorio de
 * trabajo), que es como las resuelve Next.
 *
 * @param {string} distDir
 * @param {{ root?: string }} [options]
 */
export function isDefaultDistDir(distDir, { root = process.cwd() } = {}) {
  return resolve(root, distDir) === resolve(root, DEFAULT_DIST_DIR);
}

/**
 * ¿Es una ruta que Next rechazaría como `distDir`?
 *
 * Sirve para fallar con un mensaje claro en vez de dejar que Next arme una ruta
 * imposible y muera con un ENOENT críptico.
 *
 * @param {string} distDir
 */
export function isRejectedDistDir(distDir) {
  return isAbsolute(distDir);
}
