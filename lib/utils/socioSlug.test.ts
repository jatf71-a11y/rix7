import { describe, expect, it } from 'vitest';

import { decideSlugAccess, socioForbiddenHtml, socioSlugFromPath } from './socioSlug';

describe('socioSlugFromPath', () => {
  it('reconoce la entrada y sus rutas hijas', () => {
    expect(socioSlugFromPath('/socio/catedral')).toBe('catedral');
    expect(socioSlugFromPath('/socio/catedral/publicar')).toBe('catedral');
    expect(socioSlugFromPath('/socio/catedral/publicaciones/123')).toBe('catedral');
  });

  it('no confunde el panel genérico ni otras rutas', () => {
    expect(socioSlugFromPath('/socio')).toBeNull();
    expect(socioSlugFromPath('/socio/')).toBeNull();
    expect(socioSlugFromPath('/empresas')).toBeNull();
    expect(socioSlugFromPath('/')).toBeNull();
  });

  it('un slug escapado se lee como es', () => {
    expect(socioSlugFromPath('/socio/catedral%2Dpropiedades')).toBe('catedral-propiedades');
  });

  it('no rompe con un escape inválido', () => {
    expect(socioSlugFromPath('/socio/100%')).toBe('100%');
  });
});

describe('decideSlugAccess', () => {
  it('el socio dueño entra a lo suyo', () => {
    expect(decideSlugAccess({ slug: 'catedral', role: 'member', partnerId: 'catedral' })).toBe(
      'owner'
    );
  });

  it('otra corredora es ajena: es el caso del 403', () => {
    expect(
      decideSlugAccess({ slug: 'catedral', role: 'member', partnerId: 'corredora-4204' })
    ).toBe('foreign');
  });

  it('una cuenta sin corredora tampoco hereda un panel ajeno', () => {
    expect(decideSlugAccess({ slug: 'catedral', role: 'visitor', partnerId: null })).toBe(
      'foreign'
    );
  });

  it('el equipo entra a cualquier ficha', () => {
    expect(decideSlugAccess({ slug: 'catedral', role: 'admin', partnerId: null })).toBe('admin');
  });
});

describe('socioForbiddenHtml', () => {
  it('es una página de rechazo, no del panel', () => {
    const html = socioForbiddenHtml('catedral');
    expect(html).toContain('Este panel es de otra corredora');
    expect(html).toContain('catedral');
    expect(html).toContain('href="/socio"');
  });

  it('escapa el slug: un nombre no puede inyectar etiquetas', () => {
    const html = socioForbiddenHtml('<script>alert(1)</script>"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
