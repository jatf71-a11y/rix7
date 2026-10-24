import { describe, it, expect } from 'vitest';
import { toKybPayload, usesKybFlow } from './registration';

const FORM = {
  company: '  Catedral Propiedades SpA  ',
  rut: ' 76.543.210-3 ',
  website: '  https://catedralpropiedades.cl ',
  name: ' Ana Torres ',
  role: ' Gerente comercial ',
  email: ' Contacto@CatedralPropiedades.cl ',
  phone: ' +56 9 8765 4321 ',
  coverage: 'regional' as const,
  regions: ['Valparaíso', 'Metropolitana'],
  message: '  Corredora con foco en departamentos.  ',
  consent: true,
};

describe('qué camino usa cada registro', () => {
  it('las empresas van al alta evaluada', () => {
    expect(usesKybFlow('corredora')).toBe(true);
    expect(usesKybFlow('inmobiliaria')).toBe(true);
  });

  it('un agente sigue siendo un contacto: no tiene empresa que verificar', () => {
    expect(usesKybFlow('agente')).toBe(false);
  });
});

describe('mapeo al alta', () => {
  it('nombra los campos como los espera la API y recorta espacios', () => {
    expect(toKybPayload(FORM, 'corredora')).toEqual({
      legalName: 'Catedral Propiedades SpA',
      rut: '76.543.210-3',
      email: 'Contacto@CatedralPropiedades.cl',
      contactName: 'Ana Torres',
      phone: '+56 9 8765 4321',
      consent: true,
      registrationKind: 'corredora',
      website: 'https://catedralpropiedades.cl',
      coverage: 'regional',
      regions: ['Valparaíso', 'Metropolitana'],
      message: 'Corredora con foco en departamentos.',
      contactRole: 'Gerente comercial',
    });
  });

  it('conserva el camino de registro de la inmobiliaria', () => {
    expect(toKybPayload(FORM, 'inmobiliaria').registrationKind).toBe('inmobiliaria');
  });

  it('un sitio vacío no se manda: el servidor lo rechazaría por no ser una URL', () => {
    const payload = toKybPayload({ ...FORM, website: '   ' }, 'corredora');
    expect('website' in payload).toBe(false);
  });

  it('sin mensaje ni cargo no viajan campos vacíos', () => {
    const payload = toKybPayload({ ...FORM, message: '  ', role: ' ' }, 'corredora');
    expect('message' in payload).toBe(false);
    expect('contactRole' in payload).toBe(false);
  });

  it('cobertura nacional no arrastra regiones', () => {
    const payload = toKybPayload({ ...FORM, coverage: 'nacional' }, 'corredora');
    expect(payload.coverage).toBe('nacional');
    expect(payload.regions).toEqual([]);
  });

  it('sin cobertura no se inventa una', () => {
    const payload = toKybPayload({ ...FORM, coverage: '' }, 'corredora');
    expect('coverage' in payload).toBe(false);
    expect(payload.regions).toEqual([]);
  });
});
