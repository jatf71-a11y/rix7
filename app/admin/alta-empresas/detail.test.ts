import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KybEvaluationDetail from './KybEvaluationDetail';
import type { KybEvaluation } from '@/lib/kyb/status';
import type { KybApplication } from '@/lib/kyb/types';

/**
 * Estructura de la ficha que ve el equipo, sin navegador: es donde tiene que
 * estar el porqué de una decisión. Si un peso, un detalle o una pregunta deja
 * de renderizarse, el panel vuelve a mostrar solo un estado.
 */

const application: KybApplication = {
  id: 'kyb-1',
  status: 'Pendiente_Informacion',
  legalName: 'Catedral Propiedades SpA',
  rut: '76.543.210-3',
  website: 'https://catedralpropiedades.cl',
  domain: 'catedralpropiedades.cl',
  email: 'contacto@catedralpropiedades.cl',
  contactName: 'Ana Torres',
  phone: '+56 9 8765 4321',
  consent: true,
  coverage: 'regional',
  regions: ['Valparaíso'],
  message: 'Corredora con foco en departamentos.',
  registrationKind: 'corredora',
  contactRole: 'Gerente comercial',
  score: 90,
  plan: null,
  panelEnabled: false,
  activatedAt: null,
  tokenHash: null,
  tokenPurpose: null,
  tokenExpiresAt: null,
  createdAt: '2026-10-23T12:00:00.000Z',
  updatedAt: '2026-10-23T12:00:00.000Z',
};

const evaluation: KybEvaluation = {
  score: 90,
  decision: 'Pendiente_Informacion',
  createdAt: '2026-10-23T12:05:00.000Z',
  checks: [
    {
      id: 'tax_rut',
      label: 'RUT válido',
      status: 'pass',
      detail: 'El RUT 76.543.210-3 tiene dígito verificador correcto.',
      weight: 20,
    },
    {
      id: 'reputation',
      label: 'Reputación web',
      status: 'warn',
      detail: '4 reseñas negativas públicas y ninguna señal de fraude.',
      weight: 20,
      question: '¿Qué medidas tomó la empresa para resolverlas?',
    },
  ],
  questions: [{ id: 'reputation', question: '¿Qué medidas tomó la empresa para resolverlas?' }],
  reasons: ['Quedan 1 verificación(es) por aclarar; puntaje 90/100.'],
};

function render(overrides: Partial<KybApplication> = {}, reevaluating = false) {
  return renderToStaticMarkup(
    React.createElement(KybEvaluationDetail, {
      application: { ...application, ...overrides },
      evaluation,
      reevaluating,
      error: null,
      onReevaluate: () => {},
    })
  );
}

describe('ficha de evaluación', () => {
  const html = render();

  it('muestra el puntaje, la fecha de la corrida y el resumen', () => {
    expect(html).toContain('90');
    expect(html).toContain('/100');
    expect(html).toContain('2026-10-23 12:05 UTC');
    expect(html).toContain('1 pasa');
    expect(html).toContain('1 advierte');
  });

  it('lista cada verificación con su peso y su detalle', () => {
    expect(html).toContain('RUT válido');
    expect(html).toContain('Peso 20 pts');
    expect(html).toContain('El RUT 76.543.210-3 tiene dígito verificador correcto.');
    expect(html).toContain('Reputación web');
    expect(html).toContain('4 reseñas negativas públicas');
  });

  it('explica la decisión y la pregunta que se envió', () => {
    expect(html).toContain('Quedan 1 verificación(es) por aclarar');
    expect(html).toContain('¿Qué medidas tomó la empresa para resolverlas?');
  });

  it('incluye los datos operativos del registro', () => {
    expect(html).toContain('Valparaíso');
    expect(html).toContain('Corredora con foco en departamentos.');
    expect(html).toContain('Corredora');
    expect(html).toContain('Gerente comercial');
  });

  it('con la solicitud en alta no ofrece re-evaluar', () => {
    const enAlta = render({ status: 'En_Alta', panelEnabled: true });
    expect(enAlta).toContain('el flujo terminó');
    expect(enAlta).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Re-evaluar/);
  });

  it('sin evaluación guardada explica cómo generarla', () => {
    const sinEvaluacion = renderToStaticMarkup(
      React.createElement(KybEvaluationDetail, {
        application,
        evaluation: null,
        reevaluating: false,
        error: null,
        onReevaluate: () => {},
      })
    );
    expect(sinEvaluacion).toContain('Re-evalúa para correr el motor');
    expect(sinEvaluacion).not.toContain('Peso 20 pts');
  });
});
