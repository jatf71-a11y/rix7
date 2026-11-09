import { describe, expect, it } from 'vitest';

import { normalizeKybApplication } from './application';
import { toKybPayload } from './registration';

/**
 * Las declaraciones del registro («no tengo sitio», «mi correo es personal»)
 * tienen que llegar intactas al motor: si se pierden en el camino, la empresa
 * vuelve a recibir preguntas por datos que ya contestó.
 */
const base = {
  legalName: 'Catedral Propiedades SpA',
  rut: '76.123.456-0',
  email: 'ventas@gmail.com',
  contactName: 'Ana Pérez',
  phone: '+56 9 8765 4321',
  consent: true,
  registrationKind: 'corredora',
};

describe('normalizeKybApplication · declaraciones', () => {
  it('acepta una empresa que declara no tener sitio web', () => {
    const result = normalizeKybApplication({ ...base, hasWebsite: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.hasWebsite).toBe(false);
    expect(result.application.website).toBeNull();
  });

  it('acepta un correo personal declarado como tal', () => {
    const result = normalizeKybApplication({ ...base, hasCompanyEmail: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.hasCompanyEmail).toBe(false);
  });

  it('no confunde «no se preguntó» con «no tiene»', () => {
    const result = normalizeKybApplication(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.hasWebsite).toBeNull();
    expect(result.application.hasCompanyEmail).toBeNull();
  });

  it('rechaza la contradicción de negar el sitio y mandar una dirección', () => {
    const result = normalizeKybApplication({
      ...base,
      website: 'https://catedral.cl',
      hasWebsite: false,
    });
    expect(result.ok).toBe(false);
  });

  it('exige la dirección cuando declara que sí tiene sitio', () => {
    const result = normalizeKybApplication({ ...base, hasWebsite: true });
    expect(result.ok).toBe(false);
  });
});

describe('toKybPayload · declaraciones', () => {
  const company = {
    company: 'Catedral Propiedades SpA',
    rut: '76.123.456-0',
    website: '',
    name: 'Ana Pérez',
    role: '',
    email: 'ventas@gmail.com',
    phone: '+56 9 8765 4321',
    coverage: 'nacional' as const,
    regions: [],
    message: '',
    consent: true,
  };

  it('envía el «no tengo» explícito', () => {
    const payload = toKybPayload(
      { ...company, hasWebsite: false, hasCompanyEmail: false },
      'corredora'
    );
    expect(payload.hasWebsite).toBe(false);
    expect(payload.hasCompanyEmail).toBe(false);
    expect(payload.website).toBeUndefined();
  });

  it('omite las declaraciones cuando no se preguntaron', () => {
    const payload = toKybPayload(
      { ...company, hasWebsite: null, hasCompanyEmail: null },
      'corredora'
    );
    expect('hasWebsite' in payload).toBe(false);
    expect('hasCompanyEmail' in payload).toBe(false);
  });
});
