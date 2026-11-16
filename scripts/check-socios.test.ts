import { describe, expect, it } from 'vitest';

import {
  buildSessionCookie,
  evaluate,
  isolationMatrix,
  parseArgs,
  pickPartners,
} from './check-socios.mjs';

describe('isolationMatrix', () => {
  const matrix = isolationMatrix({ own: 'catedral', foreign: 'corredora-4204' });

  it('el panel propio responde 200 y el ajeno 403', () => {
    expect(matrix.find((row) => row.path === '/socio/catedral')?.expect).toBe(200);
    expect(matrix.find((row) => row.path === '/socio/corredora-4204')?.expect).toBe(403);
  });

  it('una subruta ajena también es 403: no alcanza con proteger la portada', () => {
    expect(matrix.some((row) => row.path.endsWith('/publicar') && row.expect === 403)).toBe(true);
  });

  it('el panel genérico no depende del slug', () => {
    expect(matrix.find((row) => row.path === '/socio')?.expect).toBe(200);
  });
});

describe('evaluate', () => {
  it('devuelve solo las filas que no coinciden', () => {
    const failures = evaluate([
      { label: 'a', status: 200, expect: 200 },
      { label: 'b', status: 200, expect: 403 },
    ]);
    expect(failures.map((row) => row.label)).toEqual(['b']);
  });
});

describe('parseArgs', () => {
  it('por defecto no escribe y apunta a producción', () => {
    expect(parseArgs([])).toEqual({ url: 'https://rix7.cl', write: false, help: false });
  });

  it('acepta --url en sus dos formas y quita la barra final', () => {
    expect(parseArgs(['--url', 'http://localhost:3000/']).url).toBe('http://localhost:3000');
    expect(parseArgs(['--url=https://preview.vercel.app']).url).toBe('https://preview.vercel.app');
  });

  it('rechaza una URL sin esquema antes de hacer nada', () => {
    expect(parseArgs(['--url', 'localhost:3000']).error).toContain('http://');
  });

  it('rechaza opciones que no conoce', () => {
    expect(parseArgs(['--forzar']).error).toContain('--forzar');
  });
});

describe('buildSessionCookie', () => {
  it('usa el nombre que espera @supabase/ssr y el prefijo base64-', () => {
    const cookie = buildSessionCookie('https://abcdefgh.supabase.co', {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600,
      expires_at: 1,
      token_type: 'bearer',
      user: { id: 'u1' },
    });
    expect(cookie.name).toBe('sb-abcdefgh-auth-token');
    expect(cookie.value.startsWith('base64-')).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(cookie.value.slice('base64-'.length), 'base64url').toString('utf8')
    );
    expect(decoded.access_token).toBe('token');
  });
});

describe('pickPartners', () => {
  it('elige dos socios distintos y estables', () => {
    const chosen = pickPartners([{ id: 'zeta' }, { id: 'alfa' }, { id: 'beta' }]);
    expect(chosen.map((partner) => partner.id)).toEqual(['alfa', 'beta']);
  });

  it('con menos de dos no inventa: devuelve vacío', () => {
    expect(pickPartners([{ id: 'solo' }])).toEqual([]);
  });
});
