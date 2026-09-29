import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token de acceso al feed XML de una corredora (hallazgo #14).
 *
 * El token se genera una vez y se guarda **solo como hash SHA-256**: la tabla
 * `partners` es de lectura pública (RLS), así que guardar el valor en claro la
 * convertiría en una contraseña publicada. Con el hash, la lectura pública no
 * sirve para autenticar y el valor en claro se muestra una única vez, al
 * activar o regenerar.
 *
 * La comparación es timing-safe: el hash del token presentado se compara contra
 * el guardado con `timingSafeEqual`, para que el tiempo de respuesta no filtre
 * cuántos caracteres del token van correctos.
 */

/** Longitud del token en claro: 32 hex (128 bits de entropía). */
export function generateFeedToken(): string {
  return randomBytes(16).toString('hex');
}

/** SHA-256 en hex: lo único que toca tocar la base. */
export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Comparación en tiempo constante del token presentado contra el hash guardado. */
export function feedTokenMatches(token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;
  const presented = Buffer.from(hashFeedToken(token), 'hex');
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  // Longitudes distintas no pueden ser iguales; se compara contra el presented
  // para mantener el trabajo constante y la respuesta igual de lenta.
  if (stored.length !== presented.length) return false;
  return timingSafeEqual(presented, stored);
}
