import { describe, expect, it } from 'vitest';

import { isValidRut, normalizeRut, rutCheckDigit } from './rut';

describe('normalizeRut', () => {
  it('acepta los formatos en que la gente escribe el RUT y devuelve la forma canónica', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12.345.678-5');
    expect(normalizeRut('12345678-5')).toBe('12.345.678-5');
    expect(normalizeRut(' 12.345.678 5 ')).toBe('12.345.678-5');
    expect(normalizeRut('76.123.456-0')).toBe('76.123.456-0');
  });

  it('acepta el dígito verificador K en minúscula', () => {
    expect(rutCheckDigit('10000013')).toBe('K');
    expect(normalizeRut('10000013-k')).toBe('10.000.013-K');
    expect(normalizeRut('10.000.013-K')).toBe('10.000.013-K');
  });

  it('rechaza un dígito verificador equivocado', () => {
    expect(normalizeRut('76.123.456-7')).toBeNull();
    expect(normalizeRut('12.345.678-0')).toBeNull();
  });

  it('rechaza textos que no son un RUT', () => {
    expect(normalizeRut('')).toBeNull();
    expect(normalizeRut('sin-rut')).toBeNull();
    expect(normalizeRut('12345678')).toBeNull();
    expect(normalizeRut('0-0')).toBeNull();
    expect(normalizeRut('123456789-0')).toBeNull();
    expect(normalizeRut('12.345.678-55')).toBeNull();
    expect(normalizeRut('1'.repeat(40))).toBeNull();
  });

  it('isValidRut sigue la misma regla que normalizeRut', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12.345.678-9')).toBe(false);
  });
});
