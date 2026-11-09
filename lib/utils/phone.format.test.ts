import { describe, expect, it } from 'vitest';

import { formatPhoneInput } from './phone';

describe('formatPhoneInput', () => {
  it('muestra el +56 y agrupa los dígitos mientras se escribe', () => {
    expect(formatPhoneInput('9')).toBe('+56 9');
    expect(formatPhoneInput('9123')).toBe('+56 9 123');
    expect(formatPhoneInput('912345678')).toBe('+56 9 1234 5678');
    expect(formatPhoneInput('223456789')).toBe('+56 2 2345 6789');
  });

  it('acepta lo que se pega con prefijo, ceros o separadores', () => {
    expect(formatPhoneInput('+56 9 8765 4321')).toBe('+56 9 8765 4321');
    expect(formatPhoneInput('56987654321')).toBe('+56 9 8765 4321');
    expect(formatPhoneInput('(+56) 9-8765-4321')).toBe('+56 9 8765 4321');
    expect(formatPhoneInput('0987654321')).toBe('+56 9 8765 4321');
  });

  it('recorta lo que sobra y no inventa un número vacío', () => {
    expect(formatPhoneInput('9876543219999')).toBe('+56 9 8765 4321');
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('abc')).toBe('');
  });
});
