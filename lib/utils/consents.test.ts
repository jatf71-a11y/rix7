import { describe, expect, it } from 'vitest';
import {
  CONSENTS,
  EMPTY_CONSENTS,
  REQUIRED_CONSENTS,
  missingRequiredConsents,
  normalizeSignup,
  readConsents,
} from './consents';

const validInput = {
  name: '  María   José Rojas ',
  email: 'Maria.Rojas@Example.CL',
  phone: '+56 9 8765 4321',
  consents: { personal_data: true, terms: true, marketing: false, third_party: false },
};

describe('CONSENTS', () => {
  it('declara las cuatro autorizaciones con identificadores únicos', () => {
    const ids = CONSENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['personal_data', 'terms', 'marketing', 'third_party']);
  });

  it('marca como obligatorias solo los datos personales y los términos', () => {
    expect(CONSENTS.filter((c) => c.required).map((c) => c.id)).toEqual([...REQUIRED_CONSENTS]);
  });

  it('deja marketing y cesión a terceros como opcionales, sin marcar por defecto', () => {
    expect(EMPTY_CONSENTS.marketing).toBe(false);
    expect(EMPTY_CONSENTS.third_party).toBe(false);
  });

  it('enlaza a la página legal en las autorizaciones que la tienen', () => {
    const personal = CONSENTS.find((c) => c.id === 'personal_data');
    const terms = CONSENTS.find((c) => c.id === 'terms');
    expect(personal?.link?.href).toBe('/legal/privacidad');
    expect(terms?.link?.href).toBe('/legal/terminos');
  });
});

describe('readConsents', () => {
  it('solo acepta un true booleano como autorización', () => {
    expect(readConsents({ personal_data: true, terms: 'true' } as never)).toEqual({
      ...EMPTY_CONSENTS,
      personal_data: true,
    });
  });

  it('devuelve todo sin marcar cuando no hay cuerpo', () => {
    expect(readConsents(undefined)).toEqual(EMPTY_CONSENTS);
  });
});

describe('missingRequiredConsents', () => {
  it('nombra las obligatorias que faltan', () => {
    expect(missingRequiredConsents(EMPTY_CONSENTS).map((c) => c.id)).toEqual([
      'personal_data',
      'terms',
    ]);
  });

  it('no exige nada cuando las obligatorias están marcadas', () => {
    expect(missingRequiredConsents({ ...EMPTY_CONSENTS, personal_data: true, terms: true })).toEqual(
      []
    );
  });
});

describe('normalizeSignup', () => {
  it('normaliza nombre, correo y teléfono', () => {
    const result = normalizeSignup(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signup.name).toBe('María José Rojas');
    expect(result.signup.email).toBe('maria.rojas@example.cl');
    expect(result.signup.phone).toBe('+56 9 8765 4321');
  });

  it('conserva si la persona aceptó o no las opcionales', () => {
    const result = normalizeSignup({
      ...validInput,
      consents: { ...validInput.consents, marketing: true, third_party: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signup.consents.marketing).toBe(true);
    expect(result.signup.consents.third_party).toBe(true);
  });

  it('rechaza el alta sin las autorizaciones obligatorias', () => {
    const result = normalizeSignup({
      ...validInput,
      consents: { personal_data: true, terms: false, marketing: true, third_party: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('términos y condiciones');
  });

  it('rechaza un correo con formato inválido', () => {
    const result = normalizeSignup({ ...validInput, email: 'maria@correo' });
    expect(result).toEqual({ ok: false, error: 'El correo no tiene un formato válido.' });
  });

  it('rechaza un teléfono con menos de 9 dígitos', () => {
    const result = normalizeSignup({ ...validInput, phone: '9123' });
    expect(result).toEqual({ ok: false, error: 'El teléfono no tiene un formato válido.' });
  });

  it('exige nombre', () => {
    const result = normalizeSignup({ ...validInput, name: '   ' });
    expect(result).toEqual({ ok: false, error: 'Falta el nombre.' });
  });

  it('rechaza cuerpos que no son un objeto', () => {
    expect(normalizeSignup(null)).toEqual({ ok: false, error: 'Cuerpo de la solicitud inválido.' });
    expect(normalizeSignup('maria')).toEqual({
      ok: false,
      error: 'Cuerpo de la solicitud inválido.',
    });
  });

  it('acepta las casillas en la raíz del cuerpo (contrato tolerante)', () => {
    const { consents: _consents, ...flat } = validInput;
    const result = normalizeSignup({ ...flat, personal_data: true, terms: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signup.consents.terms).toBe(true);
  });
});
