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
      evidence: {
        source: 'search',
        mentions: [{ title: 'Reclamo en foros', url: 'https://foros.cl/reclamo' }],
      },
      facts: [
        {
          label: 'Qué se buscó',
          value: 'Catedral Propiedades SpA · 76.543.210-3 · catedralpropiedades.cl',
        },
        { label: 'Reseñas negativas', value: '4' },
        { label: 'Umbral de advertencia', value: '3 reseñas negativas o más' },
      ],
    },
    {
      id: 'email_domain_match',
      label: 'Correo y sitio coinciden',
      status: 'fail',
      detail: 'El correo (otrodominio.cl) no pertenece al dominio del sitio (catedralpropiedades.cl).',
      weight: 10,
      question: '¿Por qué la empresa usa un correo de otro dominio?',
      facts: [
        { label: 'Dominio del correo', value: 'otrodominio.cl' },
        { label: 'Dominio del sitio', value: 'catedralpropiedades.cl' },
        { label: 'Coinciden', value: 'no' },
      ],
    },
  ],
  questions: [{ id: 'reputation', question: '¿Qué medidas tomó la empresa para resolverlas?' }],
  reasons: ['Quedan 1 verificación(es) por aclarar; puntaje 90/100.'],
};

function renderEvaluation(evaluation: KybEvaluation) {
  return renderToStaticMarkup(
    React.createElement(KybEvaluationDetail, {
      application,
      evaluation,
      decisions: [],
      reevaluating: false,
      deciding: false,
      error: null,
      onReevaluate: () => {},
      onDecide: () => {},
    })
  );
}

function render(overrides: Partial<KybApplication> = {}, reevaluating = false) {
  return renderToStaticMarkup(
    React.createElement(KybEvaluationDetail, {
      application: { ...application, ...overrides },
      evaluation,
      decisions: [],
      reevaluating,
      deciding: false,
      error: null,
      onReevaluate: () => {},
      onDecide: () => {},
    })
  );
}

describe('ficha de evaluación', () => {
  const html = render();

  it('muestra el puntaje, la fecha de la corrida y el resumen', () => {
    expect(html).toContain('90');
    expect(html).toContain('/100');
    expect(html).toContain('2026-10-23 12:05 UTC');
    expect(html).toContain('1 ok');
    expect(html).toContain('1 advierte');
  });

  it('lista cada verificación con su peso y su detalle', () => {
    expect(html).toContain('RUT válido');
    expect(html).toContain('Peso 20 pts');
    expect(html).toContain('El RUT 76.543.210-3 tiene dígito verificador correcto.');
    expect(html).toContain('Reputación web');
    expect(html).toContain('4 reseñas negativas públicas');
  });

  it('cada advertencia dice de dónde salió el dato y con qué sustento', () => {
    expect(html).toContain('Origen');
    expect(html).toContain('Búsqueda real en la web');
    expect(html).toContain('Menciones encontradas');
    expect(html).toContain('Reclamo en foros');
    expect(html).toContain('href="https://foros.cl/reclamo"');
  });

  it('el encabezado nombra qué verificación advirtió y cuál falló', () => {
    expect(html).toContain('1 advierte: Reputación web');
    expect(html).toContain('1 falla: Correo y sitio coinciden');
  });

  it('muestra los datos concretos que revisó cada verificación', () => {
    expect(html).toContain('Qué se buscó');
    expect(html).toContain('Catedral Propiedades SpA · 76.543.210-3 · catedralpropiedades.cl');
    expect(html).toContain('Umbral de advertencia');
    expect(html).toContain('3 reseñas negativas o más');
    expect(html).toContain('Dominio del correo');
    expect(html).toContain('otrodominio.cl');
  });

  it('una verificación sin hechos guardados no inventa una lista vacía', () => {
    const sinHechos = renderEvaluation({
      ...evaluation,
      checks: evaluation.checks.map((check) => ({ ...check, facts: undefined })),
    });

    expect(sinHechos).toContain('Reputación web');
    expect(sinHechos).not.toContain('Qué se buscó');
  });

  it('la simulación se declara como tal, no se lee como hallazgo real', () => {
    const simulada = renderEvaluation({
      ...evaluation,
      checks: evaluation.checks.map((check) =>
        check.id === 'reputation'
          ? { ...check, evidence: { source: 'simulated' as const, mentions: [] } }
          : check
      ),
    });

    expect(simulada).toContain('no hay proveedor externo configurado');
    expect(simulada).not.toContain('Menciones encontradas');
  });

  it('una mención que no es http(s) se muestra como texto, no como enlace', () => {
    const sospechosa = renderEvaluation({
      ...evaluation,
      checks: evaluation.checks.map((check) =>
        check.id === 'reputation'
          ? {
              ...check,
              evidence: {
                source: 'search' as const,
                mentions: [{ title: 'Foro sospechoso', url: 'javascript:alert(1)' }],
              },
            }
          : check
      ),
    });

    expect(sospechosa).toContain('Foro sospechoso');
    expect(sospechosa).not.toContain('javascript:alert(1)"');
    expect(sospechosa).not.toMatch(/<a[^>]*Foro sospechoso/);
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
    expect(enAlta).toContain('no se vuelve a evaluar');
    expect(enAlta).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Re-evaluar/);
  });

  it('sin evaluación guardada explica cómo generarla', () => {
    const sinEvaluacion = renderToStaticMarkup(
      React.createElement(KybEvaluationDetail, {
        application,
        evaluation: null,
        decisions: [],
        reevaluating: false,
        deciding: false,
        error: null,
        onReevaluate: () => {},
        onDecide: () => {},
      })
    );
    expect(sinEvaluacion).toContain('Re-evalúa para correr el motor');
    expect(sinEvaluacion).not.toContain('Peso 20 pts');
  });
});
