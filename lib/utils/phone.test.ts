import { describe, it, expect } from 'vitest';
import {
  digitsOf,
  formatChilePhone,
  isChileMobile,
  normalizeChilePhone,
  whatsappHref,
} from './phone';

describe('normalizeChilePhone', () => {
  it('acepta las formas en que la gente escribe un móvil', () => {
    const esperado = '+56912345678';

    expect(normalizeChilePhone('+56 9 1234 5678')).toBe(esperado);
    expect(normalizeChilePhone('+56912345678')).toBe(esperado);
    expect(normalizeChilePhone('912345678')).toBe(esperado);
    expect(normalizeChilePhone('9 1234 5678')).toBe(esperado);
    expect(normalizeChilePhone('09 1234 5678')).toBe(esperado);
    expect(normalizeChilePhone('0056 9 1234 5678')).toBe(esperado);
    expect(normalizeChilePhone('(9) 1234-5678')).toBe(esperado);
    expect(normalizeChilePhone('  912345678  ')).toBe(esperado);
  });

  it('normaliza también un fijo, marcándolo con el 2 de Santiago', () => {
    expect(normalizeChilePhone('+56 2 2345 6789')).toBe('+56223456789');
    expect(normalizeChilePhone('22345678')).toBe('+56222345678');
  });

  it('devuelve null cuando no puede reconocer un número chileno', () => {
    expect(normalizeChilePhone('')).toBeNull();
    expect(normalizeChilePhone('   ')).toBeNull();
    expect(normalizeChilePhone('123')).toBeNull();
    expect(normalizeChilePhone('+1 415 555 0100')).toBeNull();
    expect(normalizeChilePhone('no soy un teléfono')).toBeNull();
  });

  it('no confunde un móvil con basura por tener muchos dígitos', () => {
    expect(normalizeChilePhone('912345678999')).toBeNull();
  });
});

describe('isChileMobile', () => {
  it('solo los móviles pueden recibir WhatsApp', () => {
    expect(isChileMobile('+56912345678')).toBe(true);
    // Un fijo no: `api.whatsapp.com` lo rechaza.
    expect(isChileMobile('+56223456789')).toBe(false);
    expect(isChileMobile(null)).toBe(false);
    expect(isChileMobile('')).toBe(false);
    expect(isChileMobile('+5691234567')).toBe(false);
  });
});

describe('formatChilePhone', () => {
  it('muestra el móvil en el formato chileno de siempre', () => {
    expect(formatChilePhone('+56912345678')).toBe('+56 9 1234 5678');
  });

  it('acepta lo que escribe el usuario y lo embellece', () => {
    expect(formatChilePhone('912345678')).toBe('+56 9 1234 5678');
  });

  it('muestra un fijo sin partir el número por la mitad', () => {
    expect(formatChilePhone('+56223456789')).toBe('+56 223456789');
  });

  it('con un valor vacío no inventa nada', () => {
    expect(formatChilePhone('')).toBe('');
    expect(formatChilePhone(null)).toBe('');
  });
});

describe('whatsappHref', () => {
  it('arma el enlace con el número en dígitos', () => {
    expect(whatsappHref('+56 9 1234 5678')).toBe(
      'https://api.whatsapp.com/send?phone=56912345678'
    );
  });

  it('agrega el mensaje codificado', () => {
    const href = whatsappHref('912345678', 'Hola, me interesa la propiedad');
    expect(href).toContain('phone=56912345678');
    expect(href).toContain('text=Hola%2C%20me%20interesa%20la%20propiedad');
  });

  it('no genera enlace para un fijo ni para algo inválido', () => {
    expect(whatsappHref('+56 2 2345 6789')).toBeNull();
    expect(whatsappHref('123')).toBeNull();
  });
});

describe('digitsOf', () => {
  it('deja solo los dígitos', () => {
    expect(digitsOf('+56 (9) 1234-5678')).toBe('56912345678');
  });
});
