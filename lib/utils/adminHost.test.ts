import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADMIN_HOST,
  adminHostRedirect,
  adminRedirectUrl,
  isAdminPath,
  isLoopbackHost,
  normalizeHost,
} from './adminHost';

describe('normalizeHost', () => {
  it('toma el primer host de una cadena de proxies y quita el puerto', () => {
    expect(normalizeHost('rix7.cl, proxy.vercel.com')).toBe('rix7.cl');
    expect(normalizeHost('localhost:3000')).toBe('localhost');
  });

  it('acepta una URL completa y un punto final', () => {
    expect(normalizeHost('https://admin.rix7.cl/')).toBe('admin.rix7.cl');
    expect(normalizeHost('admin.rix7.cl.')).toBe('admin.rix7.cl');
  });

  it('sin valor no inventa un host', () => {
    expect(normalizeHost(null)).toBe('');
    expect(normalizeHost('   ')).toBe('');
  });
});

describe('isAdminPath', () => {
  it('cubre el panel y sus subrutas, no un prefijo parecido', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/registros')).toBe(true);
    expect(isAdminPath('/administracion')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('reconoce las direcciones locales de desarrollo', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('app.localhost')).toBe(true);
    expect(isLoopbackHost('rix7.cl')).toBe(false);
  });
});

describe('adminHostRedirect', () => {
  it('en producción manda el admin del dominio público a su host', () => {
    expect(
      adminHostRedirect({
        pathname: '/admin/registros',
        host: 'rix7.cl',
        production: true,
      })
    ).toBe(DEFAULT_ADMIN_HOST);
  });

  it('en producción deja pasar el admin cuando ya está en su host', () => {
    expect(
      adminHostRedirect({
        pathname: '/admin',
        host: 'admin.rix7.cl',
        production: true,
      })
    ).toBeNull();
  });

  it('en desarrollo no redirige: se puede probar /admin sin DNS', () => {
    expect(
      adminHostRedirect({
        pathname: '/admin',
        host: 'localhost:3000',
        production: false,
      })
    ).toBeNull();
  });

  it('no toca las rutas que no son del panel', () => {
    expect(
      adminHostRedirect({
        pathname: '/publicar',
        host: 'rix7.cl',
        production: true,
      })
    ).toBeNull();
  });

  it('permite un host configurado y acepta una URL pegada por error', () => {
    expect(
      adminHostRedirect({
        pathname: '/admin',
        host: 'rix7.cl',
        adminHost: 'https://panel.rix7.cl/',
        production: true,
      })
    ).toBe('panel.rix7.cl');
  });

  it('en local no redirige aunque el entorno se llame producción', () => {
    expect(
      adminHostRedirect({
        pathname: '/admin',
        host: 'localhost:3942',
        production: true,
      })
    ).toBeNull();
  });
});

describe('adminRedirectUrl', () => {
  it('conserva ruta y query y fuerza HTTPS', () => {
    expect(
      adminRedirectUrl('http://rix7.cl/admin/registros?page=2', 'admin.rix7.cl')
    ).toBe('https://admin.rix7.cl/admin/registros?page=2');
  });

  it('no arrastra el puerto del servidor de origen', () => {
    expect(adminRedirectUrl('http://localhost:3942/admin', 'admin.rix7.cl')).toBe(
      'https://admin.rix7.cl/admin'
    );
  });
});
