/**
 * Tests del token del feed: el hash es determinista, el token tiene entropía
 * y la comparación timing-safe acepta el correcto y rechaza los incorrectos
 * (incluido un hash corrupto o de otra longitud).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { feedTokenMatches, generateFeedToken, hashFeedToken } from './token';

describe('token del feed', () => {
  it('genera tokens hex de 32 caracteres y distintos entre sí', () => {
    const a = generateFeedToken();
    const b = generateFeedToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('el hash es SHA-256 hex y determinista', () => {
    const esperado = createHash('sha256').update('mi-token', 'utf8').digest('hex');
    expect(hashFeedToken('mi-token')).toBe(esperado);
    expect(hashFeedToken('mi-token')).toBe(hashFeedToken('mi-token'));
    expect(hashFeedToken('mi-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokens distintos producen hashes distintos', () => {
    expect(hashFeedToken('a')).not.toBe(hashFeedToken('b'));
  });

  it('feedTokenMatches acepta el token correcto', () => {
    const token = generateFeedToken();
    expect(feedTokenMatches(token, hashFeedToken(token))).toBe(true);
  });

  it('rechaza tokens incorrectos', () => {
    const token = generateFeedToken();
    const hash = hashFeedToken(token);
    expect(feedTokenMatches('otro-token', hash)).toBe(false);
    expect(feedTokenMatches(`${token}x`, hash)).toBe(false);
    expect(feedTokenMatches(token.slice(0, 31), hash)).toBe(false);
  });

  it('rechaza entradas vacías o hash corrupto sin lanzar', () => {
    expect(feedTokenMatches('', 'abc')).toBe(false);
    expect(feedTokenMatches('token', '')).toBe(false);
    expect(feedTokenMatches('token', 'no-es-hex')).toBe(false);
    expect(feedTokenMatches('token', 'zz')).toBe(false);
  });
});
