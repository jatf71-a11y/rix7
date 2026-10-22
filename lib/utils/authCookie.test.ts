/**
 * @vitest-environment node
 *
 * Tests de la señal que decide si vale la pena cargar el SDK de Supabase.
 *
 * El caso que importa es el **negativo**: una visita anónima no debe disparar
 * la descarga de ~66 kB. El positivo se prueba con las tres formas en que
 * Supabase deja la sesión en cookies (entera, partida y el testigo de OAuth),
 * porque un falso negativo mostraría como invitada a una persona con sesión.
 */
import { describe, expect, it } from 'vitest';

import { hasAuthSessionCookie, shouldLoadSession } from './authCookie';

const REF = 'vsqkjimpssdvlvdwrtnh';

describe('hasAuthSessionCookie', () => {
  it('reconoce la cookie de sesión del proyecto', () => {
    expect(hasAuthSessionCookie(`sb-${REF}-auth-token=base64url...`)).toBe(true);
  });

  it('reconoce el token partido en varias cookies', () => {
    expect(
      hasAuthSessionCookie(`tema=claro; sb-${REF}-auth-token.0=abc; sb-${REF}-auth-token.1=def`)
    ).toBe(true);
  });

  it('reconoce el testigo del flujo OAuth', () => {
    expect(hasAuthSessionCookie(`sb-${REF}-auth-token-code-verifier=xyz`)).toBe(true);
  });

  it('no se confunde con otras cookies de la página', () => {
    expect(hasAuthSessionCookie('')).toBe(false);
    expect(hasAuthSessionCookie('tema=claro; sesion=1; _ga=GA1.1')).toBe(false);
    // Una cookie de Supabase que no guarda la sesión no justifica el SDK.
    expect(hasAuthSessionCookie(`sb-${REF}-other=1`)).toBe(false);
    expect(hasAuthSessionCookie('auth-token=1')).toBe(false);
  });
});

describe('shouldLoadSession', () => {
  it('sin proyecto configurado nunca carga el SDK', () => {
    expect(
      shouldLoadSession({ configured: false, cookieString: `sb-${REF}-auth-token=abc` })
    ).toBe(false);
  });

  it('con proyecto pero sin sesión tampoco: es la visita que más se repite', () => {
    expect(shouldLoadSession({ configured: true, cookieString: 'tema=claro' })).toBe(false);
  });

  it('con proyecto y sesión sí', () => {
    expect(
      shouldLoadSession({ configured: true, cookieString: `sb-${REF}-auth-token=abc` })
    ).toBe(true);
  });
});
