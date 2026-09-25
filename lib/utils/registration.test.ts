import { describe, it, expect } from 'vitest';
import {
  displayNameFromSession,
  firstNameOf,
  parseStoredRegistration,
  resolveRegistration,
  type Registration,
} from './registration';

const stored: Registration = {
  name: 'Javier Torres',
  email: 'javier@example.cl',
  phone: '+56 9 1234 5678',
  source: 'local',
};

describe('parseStoredRegistration', () => {
  it('devuelve null sin registro', () => {
    expect(parseStoredRegistration(null)).toBeNull();
  });

  it('devuelve null con JSON inválido', () => {
    expect(parseStoredRegistration('{no soy json')).toBeNull();
  });

  it('exige nombre y correo: un registro a medias no identifica a nadie', () => {
    expect(parseStoredRegistration(JSON.stringify({ name: 'Javier' }))).toBeNull();
    expect(parseStoredRegistration(JSON.stringify({ email: 'javier@example.cl' }))).toBeNull();
  });

  it('marca el origen como local y normaliza un teléfono ausente', () => {
    expect(
      parseStoredRegistration(JSON.stringify({ name: 'Javier', email: 'javier@example.cl' }))
    ).toEqual({ name: 'Javier', email: 'javier@example.cl', phone: '', source: 'local' });
  });

  it('conserva el teléfono cuando existe', () => {
    expect(parseStoredRegistration(JSON.stringify(stored))).toEqual(stored);
  });
});

describe('displayNameFromSession', () => {
  it('usa el nombre que el usuario dejó en el portal', () => {
    expect(
      displayNameFromSession({ email: 'javier@example.cl', user_metadata: { full_name: 'Javier Torres' } })
    ).toBe('Javier Torres');
  });

  it('ignora un nombre en blanco y cae al correo', () => {
    expect(
      displayNameFromSession({ email: 'javier@example.cl', user_metadata: { full_name: '   ' } })
    ).toBe('javier');
  });

  it('usa la parte local del correo si no hay nombre', () => {
    expect(displayNameFromSession({ email: 'javier@example.cl' })).toBe('javier');
  });

  it('nunca devuelve vacío: sin nombre ni correo deja un texto por defecto', () => {
    expect(displayNameFromSession({})).toBe('Usuario del portal');
  });
});

describe('firstNameOf', () => {
  it('toma solo el primer nombre para el saludo', () => {
    expect(firstNameOf('Javier Torres')).toBe('Javier');
  });

  it('tolera espacios extra', () => {
    expect(firstNameOf('  María  José  Pérez ')).toBe('María');
  });

  it('no devuelve vacío: sin nombre deja un texto genérico', () => {
    expect(firstNameOf('')).toBe('Usuario');
    expect(firstNameOf('   ')).toBe('Usuario');
  });
});

describe('resolveRegistration', () => {
  it('sin sesión ni registro local, no identifica a nadie (semáforo en rojo)', () => {
    expect(resolveRegistration(null, null)).toBeNull();
  });

  it('sin sesión, usa el registro del dispositivo', () => {
    expect(resolveRegistration(stored, null)).toEqual(stored);
  });

  it('la sesión del portal manda sobre el registro local', () => {
    const result = resolveRegistration(stored, {
      email: 'otro@example.cl',
      user_metadata: { full_name: 'Otra Persona' },
    });
    expect(result).toMatchObject({
      name: 'Otra Persona',
      email: 'otro@example.cl',
      source: 'portal',
    });
  });

  it('el teléfono de la cuenta manda: es el que se usará para WhatsApp', () => {
    const result = resolveRegistration(stored, {
      email: 'javier@example.cl',
      user_metadata: { full_name: 'Javier Torres', phone: '+56 9 9999 8888' },
    });
    expect(result?.phone).toBe('+56999998888');
  });

  it('normaliza el teléfono de la cuenta si se guardó con otro formato', () => {
    const result = resolveRegistration(null, {
      email: 'javier@example.cl',
      user_metadata: { phone: '9 7777 6666' },
    });
    expect(result?.phone).toBe('+56977776666');
  });

  it('si la cuenta no trae teléfono, se conserva el del dispositivo', () => {
    // Cuentas creadas antes de que el registro pidiera el móvil.
    const result = resolveRegistration(stored, { email: 'javier@example.cl' });
    expect(result?.phone).toBe('+56 9 1234 5678');
  });

  it('un teléfono de la cuenta irreconocible se conserva tal cual, no se pierde', () => {
    const result = resolveRegistration(null, {
      email: 'javier@example.cl',
      user_metadata: { phone: '+1 415 555 0100' },
    });
    expect(result?.phone).toBe('+1 415 555 0100');
  });

  it('con sesión y sin registro local previo, el teléfono queda vacío (editable)', () => {
    const result = resolveRegistration(null, { email: 'javier@example.cl' });
    expect(result).toMatchObject({ phone: '', source: 'portal' });
  });

  it('marca el origen como portal aunque el usuario no tenga nombre en metadata', () => {
    const result = resolveRegistration(stored, { email: 'javier@example.cl' });
    expect(result?.source).toBe('portal');
    expect(result?.name).toBe('javier');
  });
});
