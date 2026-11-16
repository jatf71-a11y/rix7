import { describe, expect, it } from 'vitest';

import {
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from './adminMfa';

describe('normalizeRecoveryCode', () => {
  it('acepta el código como lo escribe la persona', () => {
    expect(normalizeRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeRecoveryCode(' ABCD EFGH ')).toBe('ABCDEFGH');
  });
});

describe('hashRecoveryCode', () => {
  it('guarda un hash, nunca el código', () => {
    const code = 'ABCD-EFGH';
    const hash = hashRecoveryCode(code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('ABCD');
  });

  it('normaliza antes de hashear: mismo código, mismo hash', () => {
    expect(hashRecoveryCode('abcd-efgh')).toBe(hashRecoveryCode('ABCDEFGH'));
  });

  it('dos códigos distintos no colisionan', () => {
    expect(hashRecoveryCode('ABCD-EFGH')).not.toBe(hashRecoveryCode('ABCD-EFGJ'));
  });
});

describe('generateRecoveryCodes', () => {
  it('genera un lote del tamaño pedido, sin repetidos', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('cada código tiene el formato XXXX-XXXX', () => {
    for (const code of generateRecoveryCodes(20)) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(normalizeRecoveryCode(code)).toHaveLength(RECOVERY_CODE_LENGTH);
    }
  });

  it('no usa caracteres que se confunden al copiar a mano', () => {
    for (const forbidden of ['0', 'O', '1', 'I', 'L']) {
      expect(RECOVERY_ALPHABET).not.toContain(forbidden);
    }
  });

  it('con un generador inyectado el resultado es reproducible', () => {
    // Un generador nuevo por corrida: reusar el mismo continúa la secuencia.
    const fake = () => {
      let seed = 0;
      return (max: number) => {
        seed = (seed + 7) % max;
        return seed;
      };
    };
    expect(generateRecoveryCodes(3, fake())).toEqual(generateRecoveryCodes(3, fake()));
  });
});

describe('formatRecoveryCode', () => {
  it('muestra el guion y las mayúsculas', () => {
    expect(formatRecoveryCode('abcdefgh')).toBe('ABCD-EFGH');
  });
});
