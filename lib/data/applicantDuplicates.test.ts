import { describe, expect, it } from 'vitest';

import { findApplicantDuplicate } from './applicantDuplicates';

const solicitud = (overrides: Partial<{ id: string; email: string; rut: string }> = {}) => ({
  id: 's-1',
  email: 'camila@catedral.cl',
  payload: { rut: overrides.rut ?? '76.123.456-0' },
  ...(overrides.email ? { email: overrides.email } : {}),
  ...(overrides.id ? { id: overrides.id } : {}),
});

const alta = (overrides: Partial<{ id: string; rut: string; email: string }> = {}) => ({
  id: 'k-1',
  rut: overrides.rut ?? '77.222.333-1',
  email: overrides.email ?? 'contacto@losandes.cl',
  ...(overrides.id ? { id: overrides.id } : {}),
});

describe('findApplicantDuplicate', () => {
  it('reconoce el mismo RUT aunque esté guardado con otro formato', () => {
    const found = findApplicantDuplicate({
      rut: '76123456-0',
      email: 'otra@correo.cl',
      solicitudes: [solicitud()],
    });

    expect(found).toEqual({ field: 'rut', source: 'solicitud', id: 's-1' });
  });

  it('reconoce el mismo correo sin importar mayúsculas', () => {
    const found = findApplicantDuplicate({
      rut: '11.111.111-1',
      email: 'CAMILA@Catedral.cl',
      solicitudes: [solicitud()],
    });

    expect(found).toEqual({ field: 'email', source: 'solicitud', id: 's-1' });
  });

  it('busca también en las altas de empresa', () => {
    const found = findApplicantDuplicate({
      rut: '77222333-1',
      email: 'nueva@correo.cl',
      solicitudes: [],
      applications: [alta()],
    });

    expect(found).toEqual({ field: 'rut', source: 'alta', id: 'k-1' });
  });

  it('no se encuentra a sí mismo cuando se ignora el registro recién creado', () => {
    const found = findApplicantDuplicate({
      rut: '76.123.456-0',
      email: 'camila@catedral.cl',
      solicitudes: [solicitud({ id: 's-nueva' })],
      ignoreIds: ['s-nueva'],
    });

    expect(found).toBeNull();
  });

  it('sin coincidencias o con datos que no son RUT no inventa un duplicado', () => {
    expect(
      findApplicantDuplicate({
        rut: '76.123.456-0',
        email: 'camila@catedral.cl',
        solicitudes: [solicitud({ id: 's-9', rut: '77.000.111-2', email: 'otra@x.cl' })],
      })
    ).toBeNull();

    expect(findApplicantDuplicate({ rut: 'sin-rut', email: '', solicitudes: [solicitud()] })).toBeNull();
  });
});
