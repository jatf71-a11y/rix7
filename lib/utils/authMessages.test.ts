import { describe, it, expect } from 'vitest';
import {
  describeAuthError,
  hasAuthError,
  parseAuthErrorFromUrl,
  stripAuthError,
} from './authMessages';

describe('describeAuthError', () => {
  it('explica que Google no está disponible y ofrece la alternativa', () => {
    // Es el error real que devuelve Supabase mientras el proveedor no esté
    // habilitado: el usuario tiene que saber qué hacer, no leerlo en inglés.
    const message = describeAuthError('Unsupported provider: provider is not enabled');

    expect(message).toMatch(/Google/);
    expect(message).toMatch(/enlace al correo/);
    expect(message).not.toMatch(/provider/i);
  });

  it('traduce la falta de conexión', () => {
    expect(describeAuthError('Failed to fetch')).toMatch(/conexión/i);
    expect(describeAuthError('')).toMatch(/conexión/i);
    expect(describeAuthError(new Error('Load failed'))).toMatch(/conexión/i);
  });

  it('reconoce que se canceló en la pantalla de Google', () => {
    expect(describeAuthError('access_denied')).toMatch(/canceló/i);
    expect(describeAuthError('User cancelled the sign in flow')).toMatch(/canceló/i);
  });

  it('deja pasar un error que no reconoce, sin inventar', () => {
    expect(describeAuthError('El usuario ya existe con otro método')).toBe(
      'El usuario ya existe con otro método'
    );
  });

  it('no se rompe con valores raros', () => {
    expect(describeAuthError(null)).toMatch(/conexión/i);
    expect(describeAuthError(42)).toMatch(/conexión/i);
    expect(describeAuthError(undefined)).toMatch(/conexión/i);
  });
});

describe('parseAuthErrorFromUrl', () => {
  it('lee el error que Supabase deja al volver de Google', () => {
    const result = parseAuthErrorFromUrl(
      '?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code'
    );

    expect(result?.code).toBe('unexpected_failure');
    expect(result?.message).toBe('Unable to exchange external code');
  });

  it('sin descripción usa el código', () => {
    const result = parseAuthErrorFromUrl('?error=access_denied');

    expect(result?.code).toBe('access_denied');
    expect(result?.message).toMatch(/canceló/i);
  });

  it('sin error en la URL no dice nada', () => {
    expect(parseAuthErrorFromUrl('')).toBeNull();
    expect(parseAuthErrorFromUrl('?commune=providencia&page=2')).toBeNull();
    // Volver bien trae un `code` para canjear: eso no es un error.
    expect(parseAuthErrorFromUrl('?code=abc123')).toBeNull();
  });
});

describe('hasAuthError', () => {
  it('detecta el error pero no el regreso exitoso', () => {
    expect(hasAuthError('?error=access_denied')).toBe(true);
    expect(hasAuthError('?error_code=otp_expired')).toBe(true);
    expect(hasAuthError('?code=abc123')).toBe(false);
    expect(hasAuthError('')).toBe(false);
  });
});

describe('stripAuthError', () => {
  it('quita el error y conserva el resto de la búsqueda', () => {
    expect(stripAuthError('?error=access_denied&commune=providencia')).toBe('?commune=providencia');
    expect(stripAuthError('?error=access_denied')).toBe('');
  });

  it('nunca toca el `code`: es el que canjea la sesión', () => {
    // Borrarlo por "limpiar" rompería el acceso exitoso.
    expect(stripAuthError('?code=abc123&state=xyz')).toBe('?code=abc123&state=xyz');
  });
});
