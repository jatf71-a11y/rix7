/**
 * Tokens de acceso del flujo KYB.
 *
 * La empresa no tiene sesión: se identifica con el token que le llega por
 * correo. Se genera con 32 bytes aleatorios, viaja una sola vez y en la base
 * queda solo su SHA-256 — igual que el token del feed XML de las corredoras—.
 * Así, una lectura de la tabla no entrega credenciales.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Días que vale un token. Es un correo de trámite: una semana alcanza y sobra. */
export const KYB_TOKEN_TTL_DAYS = 7;

export function generateKybToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashKybToken(token) };
}

export function hashKybToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function kybTokenExpiry(from = new Date()): string {
  return new Date(from.getTime() + KYB_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Forma mínima de un token recibido: 43 caracteres base64url. */
export function isKybTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
