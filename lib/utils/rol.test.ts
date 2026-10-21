import { describe, expect, it } from 'vitest';

import { isValidRol, ROL_MAX_LENGTH } from './rol';

describe('isValidRol', () => {
  it('acepta las notaciones habituales del SII', () => {
    for (const rol of ['15234-67', '13-15234-67', '15234-67D', ' 15234-67 ']) {
      expect(isValidRol(rol), rol).toBe(true);
    }
  });

  it('rechaza textos que no empiezan por dígito o son demasiado cortos', () => {
    for (const rol of ['sin-rol', 'A15234', '12-', '']) {
      expect(isValidRol(rol), rol).toBe(false);
    }
  });

  it('rechaza basura y valores fuera del tope', () => {
    expect(isValidRol('15234; DROP TABLE x')).toBe(false);
    expect(isValidRol(`1${'5'.repeat(ROL_MAX_LENGTH)}`)).toBe(false);
  });
});
