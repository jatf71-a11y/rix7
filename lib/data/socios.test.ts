import { describe, it, expect } from 'vitest';
import {
  buildSocios,
  isSocioSolicitud,
  socioCounts,
  socioFromApplication,
  socioFromSolicitud,
} from './socios';
import type { KybApplication } from '@/lib/kyb/types';
import type { Solicitud, SolicitudKind } from './solicitudes';

/**
 * El panel de socios mezcla dos tablas, así que lo que se prueba acá es la
 * traducción: qué categoría le toca a cada fila, cuáles quedan afuera y en qué
 * orden se muestran. Son datos inventados a propósito; no tocan la base.
 */

const application = (overrides: Partial<KybApplication> = {}): KybApplication => ({
  id: 'alta-1',
  status: 'Recibida',
  legalName: 'Catedral Propiedades SpA',
  rut: '76.123.456-7',
  website: 'https://catedral.cl',
  domain: 'catedral.cl',
  email: 'contacto@catedral.cl',
  contactName: 'Ana Pérez',
  phone: '+56911111111',
  consent: true,
  coverage: 'nacional',
  regions: [],
  message: null,
  registrationKind: 'corredora',
  contactRole: 'Gerente',
  score: 82,
  plan: null,
  panelEnabled: false,
  activatedAt: null,
  tokenHash: null,
  tokenPurpose: null,
  tokenExpiresAt: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
  ...overrides,
});

const solicitud = (kind: SolicitudKind, overrides: Partial<Solicitud> = {}): Solicitud => ({
  id: 'sol-1',
  kind,
  name: 'Marco Polo',
  email: 'marco@example.com',
  phone: '+56922222222',
  company: null,
  message: null,
  payload: {},
  status: 'Recibida',
  createdAt: '2026-10-21T09:30:00.000Z',
  ...overrides,
});

describe('socios: de una fila a una tarjeta del panel', () => {
  it('una corredora conserva su categoría y su puntaje', () => {
    const socio = socioFromApplication(application());

    expect(socio.source).toBe('alta');
    expect(socio.category).toBe('corredora');
    expect(socio.name).toBe('Catedral Propiedades SpA');
    expect(socio.score).toBe(82);
    expect(socio.rut).toBe('76.123.456-7');
  });

  it('una inmobiliaria no se confunde con una corredora', () => {
    expect(
      socioFromApplication(application({ registrationKind: 'inmobiliaria' })).category
    ).toBe('inmobiliaria');
  });

  it('un alta sin tipo declarado queda como empresa, no como corredora', () => {
    const socio = socioFromApplication(application({ registrationKind: null }));

    expect(socio.category).toBe('empresa');
  });

  it('el registro de agente es su propia categoría y no tiene puntaje', () => {
    const socio = socioFromSolicitud(solicitud('agente', { id: 'sol-agente' }));

    expect(socio.source).toBe('registro');
    expect(socio.category).toBe('agente');
    expect(socio.score).toBeNull();
    expect(socio.panelEnabled).toBe(false);
  });

  it('un agente trae su cobertura y regiones del payload', () => {
    const socio = socioFromSolicitud(
      solicitud('agente', {
        payload: { coverage: 'regional', regions: ['Valparaíso'] },
      })
    );

    expect(socio.coverage).toBe('regional');
    expect(socio.regions).toEqual(['Valparaíso']);
  });

  it('un payload viejo o raro no rompe la tarjeta', () => {
    const socio = socioFromSolicitud(
      solicitud('agente', { payload: { coverage: 42, regions: 'Valparaíso' } })
    );

    expect(socio.coverage).toBeNull();
    expect(socio.regions).toEqual([]);
  });
});

describe('socios: qué entra al panel', () => {
  it('los propietarios no son socios', () => {
    expect(isSocioSolicitud(solicitud('propuestas'))).toBe(false);
  });

  it('las altas y los agentes sí, y los propietarios quedan afuera aunque vengan en la lista', () => {
    const socios = buildSocios(
      [application()],
      [solicitud('agente', { id: 'sol-agente' }), solicitud('propuestas', { id: 'sol-dup' })]
    );

    expect(socios.map((socio) => socio.id).sort()).toEqual(['alta-1', 'sol-agente']);
  });

  it('ordena de la más reciente a la más vieja', () => {
    const socios = buildSocios(
      [application({ id: 'vieja', createdAt: '2026-10-01T10:00:00.000Z' })],
      [solicitud('agente', { id: 'nueva', createdAt: '2026-10-25T10:00:00.000Z' })]
    );

    expect(socios.map((socio) => socio.id)).toEqual(['nueva', 'vieja']);
  });

  it('dos filas del mismo segundo no cambian de orden entre renders', () => {
    const mismaHora = '2026-10-25T10:00:00.000Z';
    const primera = buildSocios(
      [application({ id: 'b', createdAt: mismaHora })],
      [solicitud('agente', { id: 'a', createdAt: mismaHora })]
    );
    const segunda = buildSocios(
      [application({ id: 'b', createdAt: mismaHora })],
      [solicitud('agente', { id: 'a', createdAt: mismaHora })]
    );

    expect(primera.map((socio) => socio.id)).toEqual(['a', 'b']);
    expect(segunda.map((socio) => socio.id)).toEqual(['a', 'b']);
  });

  it('una fecha inválida no adelanta la fila', () => {
    const socios = buildSocios(
      [application({ id: 'rota', createdAt: 'no es una fecha' })],
      [solicitud('agente', { id: 'valida', createdAt: '2026-10-01T10:00:00.000Z' })]
    );

    expect(socios.map((socio) => socio.id)).toEqual(['valida', 'rota']);
  });

  it('cuenta cada categoría y siempre incluye los ceros', () => {
    const counts = socioCounts(
      buildSocios(
        [application({ id: 'alta-1' }), application({ id: 'alta-2', registrationKind: 'inmobiliaria' })],
        [solicitud('agente', { id: 'sol-agente' })]
      )
    );

    expect(counts).toEqual({
      todas: 3,
      corredora: 1,
      inmobiliaria: 1,
      agente: 1,
      empresa: 0,
    });
  });
});
