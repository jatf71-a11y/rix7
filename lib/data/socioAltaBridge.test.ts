import { describe, it, expect } from 'vitest';

import { highFromSolicitud, needsAlta } from './socioAltaBridge';
import { solicitudAltaId } from './socios';
import { SOLICITUD_REVIEW_KEYS } from './solicitudEvaluation';
import type { Solicitud } from './solicitudes';

/**
 * El puente es lo que evita que un registro aprobado se quede sin panel. Lo que
 * se prueba acá es la traducción de la fila de «Publicar» a la solicitud de
 * alta: el nombre que se usa, el perfil, y que un dato faltante dé un error
 * legible en vez de una fila a medias.
 */

const solicitud = (overrides: Partial<Solicitud> = {}): Solicitud => ({
  id: 'sol-1',
  kind: 'agente',
  name: 'Ana Pérez',
  email: 'ana@perez.cl',
  phone: '+56911111111',
  company: null,
  message: null,
  payload: {
    rut: '12.345.678-5',
    website: 'https://perez.cl',
    coverage: 'nacional',
    regions: [],
    role: 'Corredora independiente',
  },
  status: 'Aceptada',
  createdAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
});

describe('highFromSolicitud', () => {
  it('un profesional independiente usa su nombre y su perfil', () => {
    const result = highFromSolicitud(solicitud());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.legalName).toBe('Ana Pérez');
    expect(result.application.registrationKind).toBe('agente');
    expect(result.application.domain).toBe('perez.cl');
    expect(result.application.contactRole).toBe('Corredora independiente');
  });

  it('una empresa usa la razón social y conserva el sitio', () => {
    const result = highFromSolicitud(
      solicitud({
        kind: 'corredora',
        name: 'Ana Pérez',
        company: 'Catedral Propiedades SpA',
        payload: { rut: '12.345.678-5', website: 'https://catedral.cl', coverage: 'regional', regions: ['Valparaíso'] },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.application.legalName).toBe('Catedral Propiedades SpA');
    expect(result.application.registrationKind).toBe('corredora');
    expect(result.application.regions).toEqual(['Valparaíso']);
  });

  it('sin RUT no inventa un alta: explica qué falta', () => {
    const result = highFromSolicitud(solicitud({ payload: { coverage: 'nacional' } }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/RUT/i);
  });

  it('un RUT con dígito verificador inválido se rechaza', () => {
    const result = highFromSolicitud(solicitud({ payload: { rut: '12.345.678-9' } }));

    expect(result.ok).toBe(false);
  });
});

describe('needsAlta', () => {
  it('un registro aprobado sin vínculo necesita su alta', () => {
    expect(needsAlta(solicitud({ status: 'Aceptada' }))).toBe(true);
    expect(needsAlta(solicitud({ status: 'Calificado' }))).toBe(true);
  });

  it('no lo necesita antes de aprobarse, ni si ya tiene alta', () => {
    expect(needsAlta(solicitud({ status: 'Pendiente_Informacion' }))).toBe(false);
    expect(needsAlta(solicitud({ status: 'Recibida' }))).toBe(false);
    expect(
      needsAlta(
        solicitud({
          status: 'Calificado',
          payload: { rut: '12.345.678-5', [SOLICITUD_REVIEW_KEYS.alta]: 'alta-1' },
        })
      )
    ).toBe(false);
  });

  it('lee el vínculo del payload y descarta lo que no es un id', () => {
    expect(solicitudAltaId(solicitud())).toBeNull();
    expect(
      solicitudAltaId(solicitud({ payload: { [SOLICITUD_REVIEW_KEYS.alta]: 'alta-9' } }))
    ).toBe('alta-9');
    expect(
      solicitudAltaId(solicitud({ payload: { [SOLICITUD_REVIEW_KEYS.alta]: 42 } }))
    ).toBeNull();
  });
});
