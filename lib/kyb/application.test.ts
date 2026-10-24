import { describe, it, expect } from 'vitest';
import {
  domainsMatch,
  emailDomain,
  isFreeEmailDomain,
  normalizeDomain,
  normalizeKybApplication,
} from './application';

const valida = {
  legalName: 'Catedral Propiedades SpA',
  rut: '76.543.210-3',
  website: 'https://www.catedralpropiedades.cl/quienes-somos',
  email: 'Contacto@CatedralPropiedades.cl',
  contactName: 'Ana Torres',
  phone: '+56 9 8765 4321',
  consent: true,
};

describe('normalizeKybApplication', () => {
  it('normaliza RUT, correo, sitio y dominio', () => {
    const result = normalizeKybApplication(valida);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.application.rut).toBe('76.543.210-3');
    expect(result.application.email).toBe('contacto@catedralpropiedades.cl');
    expect(result.application.domain).toBe('catedralpropiedades.cl');
    expect(result.application.website).toBe(valida.website);
  });

  it('acepta una empresa sin sitio web: el motor lo tratará como advertencia', () => {
    const result = normalizeKybApplication({ ...valida, website: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.application.domain).toBeNull();
  });

  it('rechaza un RUT con dígito verificador equivocado', () => {
    const result = normalizeKybApplication({ ...valida, rut: '76.543.210-9' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/RUT inválido/);
  });

  it('rechaza un sitio sin protocolo o con dominio ilegible', () => {
    expect(normalizeKybApplication({ ...valida, website: 'catedral.cl' }).ok).toBe(false);
    expect(normalizeKybApplication({ ...valida, website: 'https://no' }).ok).toBe(false);
  });

  it('exige el consentimiento explícito', () => {
    const result = normalizeKybApplication({ ...valida, consent: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aceptar/);
  });

  it('rechaza un teléfono con letras', () => {
    expect(normalizeKybApplication({ ...valida, phone: 'llámame' }).ok).toBe(false);
  });

  it('un alta directa no tiene cobertura ni mensaje', () => {
    const result = normalizeKybApplication(valida);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.coverage).toBeNull();
    expect(result.application.regions).toEqual([]);
    expect(result.application.message).toBeNull();
    expect(result.application.registrationKind).toBeNull();
    expect(result.application.contactRole).toBeNull();
  });

  it('guarda la cobertura regional con sus regiones, sin duplicados', () => {
    const result = normalizeKybApplication({
      ...valida,
      coverage: 'regional',
      regions: ['Valparaíso', ' Valparaíso ', 'Biobío', '   '],
      message: '  Corredora con foco en departamentos.  ',
      registrationKind: 'corredora',
      contactRole: '  Gerente comercial ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.coverage).toBe('regional');
    expect(result.application.regions).toEqual(['Valparaíso', 'Biobío']);
    expect(result.application.message).toBe('Corredora con foco en departamentos.');
    expect(result.application.registrationKind).toBe('corredora');
    expect(result.application.contactRole).toBe('Gerente comercial');
  });

  it('rechaza un tipo de registro que no es una empresa', () => {
    const result = normalizeKybApplication({ ...valida, registrationKind: 'agente' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tipo de registro/);
  });

  it('cobertura nacional no deja regiones colgando', () => {
    const result = normalizeKybApplication({
      ...valida,
      coverage: 'nacional',
      regions: ['Valparaíso'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.application.regions).toEqual([]);
  });

  it('rechaza una cobertura regional sin regiones y una cobertura inventada', () => {
    const sinRegiones = normalizeKybApplication({ ...valida, coverage: 'regional', regions: [] });
    expect(sinRegiones.ok).toBe(false);
    if (!sinRegiones.ok) expect(sinRegiones.error).toMatch(/región/);

    expect(normalizeKybApplication({ ...valida, coverage: 'global' }).ok).toBe(false);
  });
});

describe('dominios', () => {
  it('quita www y la ruta', () => {
    expect(normalizeDomain('https://www.Empresa.cl/contacto')).toBe('empresa.cl');
    expect(normalizeDomain('Empresa.cl')).toBe('empresa.cl');
    expect(normalizeDomain('no es un dominio')).toBeNull();
  });

  it('extrae el dominio del correo', () => {
    expect(emailDomain('ana@empresa.cl')).toBe('empresa.cl');
    expect(emailDomain('sin-arroba')).toBeNull();
  });

  it('acepta el mismo dominio y sus subdominios en cualquier dirección', () => {
    expect(domainsMatch('empresa.cl', 'empresa.cl')).toBe(true);
    expect(domainsMatch('ana@empresa.cl'.split('@')[1], 'ventas.empresa.cl')).toBe(true);
    expect(domainsMatch('ventas.empresa.cl', 'empresa.cl')).toBe(true);
    expect(domainsMatch('otra.cl', 'empresa.cl')).toBe(false);
  });

  it('reconoce los correos personales', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true);
    expect(isFreeEmailDomain('empresa.cl')).toBe(false);
    expect(isFreeEmailDomain(null)).toBe(false);
  });
});
