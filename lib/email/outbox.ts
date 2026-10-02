/**
 * Buzón de salida local (outbox).
 *
 * El portal no miente sobre el correo: sin `RESEND_API_KEY` el envío se
 * **salta** y la respuesta lo dice. Eso deja justamente el hueco que este
 * módulo llena: en local no hay forma de ver el correo de bienvenida por más
 * que el alta funcione de punta a punta, así que cuando `DEV_EMAIL_OUTBOX=1`
 * cada mensaje que pasa por `sendEmail` se guarda acá, en memoria, y se puede
 * abrir en el navegador como si hubiera llegado.
 *
 * Tres reglas, en el mismo espíritu que el resto del proyecto:
 *
 * 1. **Nunca finge un envío**: el buzón guarda el resultado real (`sent`,
 *    `skipped`, `error`) junto al mensaje; lo que no salió, sigue sin salir.
 * 2. **Apagado por defecto**: sin `DEV_EMAIL_OUTBOX=1` no se guarda nada ni la
 *    ruta `/api/dev/outbox` existe (responde 404). En Vercel esa variable no
 *    está definida, así que en producción no hay copia de ningún correo.
 * 3. **Solo memoria**: como el respaldo de `signups`, vive en `globalThis`
 *    porque cada ruta de servidor compila su propio bundle, y se pierde al
 *    reiniciar. No es una bandeja de entrada: es un acuse local.
 */

import type { EmailInput, EmailResult } from './sendEmail';

export interface OutboxEntry {
  /** Identificador estable para abrir el mensaje desde la ruta de desarrollo. */
  id: string;
  /** Cuándo pasó por `sendEmail` (ISO). */
  at: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resultado real del intento de envío: el buzón no lo endulza. */
  sent: boolean;
  skipped: boolean;
  error?: string;
}

/** Un buffer corto alcanza: es para probar, no para archivar. */
const MAX_ENTRIES = 50;

type OutboxStore = typeof globalThis & {
  __rix7DevOutbox?: OutboxEntry[];
  __rix7DevOutboxSeq?: number;
};

/**
 * ¿Está encendido el buzón local?
 *
 * Apagado salvo `DEV_EMAIL_OUTBOX=1`, y **también** apagado en Vercel
 * (`VERCEL=1` lo es siempre allí): aunque la variable llegara a subir por
 * error, en producción no se guarda copia de ningún correo ni existe la ruta
 * que lo mostraría.
 */
export function isOutboxEnabled(): boolean {
  return process.env.DEV_EMAIL_OUTBOX === '1' && process.env.VERCEL !== '1';
}

function store(): { entries: OutboxEntry[]; nextSeq: () => number } {
  const g = globalThis as OutboxStore;
  g.__rix7DevOutbox ??= [];
  g.__rix7DevOutboxSeq ??= 0;
  const entries = g.__rix7DevOutbox;
  return {
    entries,
    nextSeq: () => {
      g.__rix7DevOutboxSeq = (g.__rix7DevOutboxSeq ?? 0) + 1;
      return g.__rix7DevOutboxSeq;
    },
  };
}

/**
 * Guarda una copia del mensaje **y su resultado real**. Devuelve el id con el
 * que se puede abrir, o `null` si el buzón está apagado.
 *
 * Se llama siempre que `sendEmail` termina, también cuando el envío se salta:
 * ver «llegó pero sin clave» es exactamente lo que se quiere probar en local.
 */
export function captureOutbox(email: EmailInput, result: EmailResult): string | null {
  if (!isOutboxEnabled()) return null;

  const { entries, nextSeq } = store();
  const id = `correo-${nextSeq()}`;

  entries.unshift({
    id,
    at: new Date().toISOString(),
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    sent: result.sent,
    skipped: result.skipped,
    ...(result.error ? { error: result.error } : {}),
  });

  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  return id;
}

/** El más reciente primero. Copia: quien llama no debe mutar el buzón. */
export function listOutbox(): OutboxEntry[] {
  return [...store().entries];
}

export function getOutbox(id: string): OutboxEntry | null {
  return store().entries.find((entry) => entry.id === id) ?? null;
}

/** Vacía el buzón (útil entre pruebas locales). */
export function clearOutbox(): number {
  const { entries } = store();
  const removed = entries.length;
  entries.length = 0;
  return removed;
}
