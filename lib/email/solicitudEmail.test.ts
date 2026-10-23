import { describe, expect, it } from 'vitest';

import { buildSolicitudEmail, notifyOnSolicitud, type NotifiableSolicitud } from './solicitudEmail';
import type { NormalizedSolicitud } from '@/lib/data/solicitudes';

const CORREDORA: NotifiableSolicitud = {
  kind: 'corredora',
  name: 'Camila Rojas',
  email: 'camila@example.cl',
  phone: '+56 2 2345 6789',
  company: 'Catedral Propiedades',
  message: 'Cuatro agentes en Providencia.',
  consent: true,
  payload: {
    rut: '76.123.456-0',
    role: 'Gerente comercial',
    coverage: 'regional',
    regions: ['Región Metropolitana de Santiago', 'Valparaíso'],
    website: 'https://catedral.cl',
  },
};

const AGENTE: NotifiableSolicitud = {
  kind: 'agente',
  name: 'Diego Soto',
  email: 'diego@example.cl',
  phone: '+56 9 8765 4321',
  company: null,
  message: null,
  consent: true,
  payload: {
    rut: '12.345.678-5',
    role: null,
    coverage: 'nacional',
    regions: [],
    website: null,
  },
};

describe('buildSolicitudEmail', () => {
  it('arma el aviso con los datos que se acaban de guardar', () => {
    const email = buildSolicitudEmail({ solicitud: CORREDORA, id: 's1', siteUrl: 'https://rix7.cl' });

    expect(email.subject).toBe('Nueva solicitud · Corredora · Catedral Propiedades');
    expect(email.text).toContain('RUT: 76.123.456-0');
    expect(email.text).toContain('Alcance: Regional');
    expect(email.text).toContain('Regiones: Región Metropolitana de Santiago, Valparaíso');
    expect(email.text).toContain('Correo: camila@example.cl');
    expect(email.text).toContain('Folio: s1');
    expect(email.text).toContain('https://rix7.cl/admin/solicitudes');
  });

  it('el agente no muestra empresa y su alcance nacional no inventa regiones', () => {
    const email = buildSolicitudEmail({ solicitud: AGENTE, id: null, siteUrl: 'https://rix7.cl' });

    expect(email.subject).toBe('Nueva solicitud · Agente independiente · Diego Soto');
    expect(email.text).toContain('Alcance: Nacional');
    expect(email.text).not.toContain('Empresa:');
    expect(email.text).not.toContain('Regiones:');
    expect(email.text).not.toContain('Folio');
  });

  it('escapa lo que escribió la persona antes de meterlo en el HTML', () => {
    const email = buildSolicitudEmail({
      solicitud: {
        ...CORREDORA,
        company: 'Catedral <script>alert(1)</script>',
        message: 'Hola <b>equipo</b> & gracias',
      },
      id: 's2',
      siteUrl: 'https://rix7.cl',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;equipo&lt;/b&gt;');
    expect(email.html).toContain('&amp; gracias');
  });
});

describe('notifyOnSolicitud', () => {
  it('avisa solo por los tres registros, no por una solicitud de propietario', () => {
    expect(notifyOnSolicitud(CORREDORA)).toBe(true);
    expect(notifyOnSolicitud({ ...AGENTE, kind: 'inmobiliaria' })).toBe(true);

    const propuestas: NormalizedSolicitud = {
      kind: 'propuestas',
      name: 'Ana Pérez',
      email: 'ana@example.cl',
      phone: '+56 9 1234 5678',
      company: null,
      message: 'Departamento en venta.',
      consent: true,
      payload: {},
    };

    expect(notifyOnSolicitud(propuestas)).toBe(false);
  });
});
