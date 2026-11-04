import { describe, expect, it } from 'vitest';

import { SITE_URL } from '@/lib/site';
import { confirmationUrl } from './provisioning';

describe('confirmationUrl', () => {
  it('apunta a la ruta que canjea la sesión, no al enlace de Supabase', () => {
    const url = new URL(confirmationUrl('hash-de-prueba'));

    expect(`${url.origin}${url.pathname}`).toBe(`${SITE_URL}/auth/confirm`);
    expect(url.searchParams.get('token_hash')).toBe('hash-de-prueba');
    expect(url.searchParams.get('type')).toBe('magiclink');
    expect(url.searchParams.get('next')).toBe('/socio');
  });

  it('codifica el token para que sobreviva a la URL', () => {
    const url = new URL(confirmationUrl('a+b/c='));

    expect(url.searchParams.get('token_hash')).toBe('a+b/c=');
  });
});
