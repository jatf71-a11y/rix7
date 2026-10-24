import { describe, it, expect } from 'vitest';
import {
  generateKybToken,
  hashKybToken,
  isKybTokenShape,
  kybTokenExpiry,
  KYB_TOKEN_TTL_DAYS,
} from './tokens';

describe('tokens KYB', () => {
  it('genera 32 bytes en base64url y su hash', () => {
    const { token, hash } = generateKybToken();
    expect(isKybTokenShape(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashKybToken(token));
  });

  it('dos tokens no se repiten', () => {
    expect(generateKybToken().token).not.toBe(generateKybToken().token);
  });

  it('el hash es estable: el mismo token da el mismo hash', () => {
    expect(hashKybToken('abc')).toBe(hashKybToken('abc'));
    expect(hashKybToken('abc')).not.toBe(hashKybToken('abd'));
  });

  it('vence en siete días', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const expiry = new Date(kybTokenExpiry(from));
    expect(expiry.getTime() - from.getTime()).toBe(KYB_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  });

  it('rechaza tokens con forma inválida', () => {
    expect(isKybTokenShape('corto')).toBe(false);
    expect(isKybTokenShape('a'.repeat(42))).toBe(false);
    expect(isKybTokenShape(undefined)).toBe(false);
  });
});
