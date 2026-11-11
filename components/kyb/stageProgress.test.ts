import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import StageProgress from './StageProgress';

describe('barra de etapas del trámite', () => {
  it('nombra la etapa actual y cuántas son', () => {
    const html = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'Pendiente_Informacion' })
    );

    expect(html).toContain('Etapa 3 de 7');
    expect(html).toContain('Pendiente de información');
    expect(html).toContain('aria-valuenow="3"');
  });

  it('dibuja las siete casillas de la barra', () => {
    const html = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'Propuesta_Comercial' })
    );

    expect((html.match(/h-1\.5/g) ?? []).length).toBe(7);
  });

  it('con las siete etapas cumplidas la barra queda entera en verde', () => {
    const html = renderToStaticMarkup(React.createElement(StageProgress, { status: 'Alta' }));

    expect((html.match(/bg-green-600/g) ?? []).length).toBe(7);
    expect(html).toContain('text-green-700');
    expect(html).not.toContain('bg-slate-200');
  });

  it('mientras espera va en ámbar y cuando falta un dato en rojo', () => {
    const waiting = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'En_Evaluacion' })
    );

    expect(waiting).toContain('bg-amber-500');
    expect(waiting).toContain('bg-slate-200');
    expect(waiting).toContain('text-amber-700');
    expect(waiting).not.toContain('bg-red-600');

    const blocked = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'Pendiente_Informacion' })
    );

    expect(blocked).toContain('bg-red-600');
    expect(blocked).toContain('text-red-700');
    expect(blocked).not.toContain('bg-amber-500');
  });

  it('fuera de las siete etapas no ocupa lugar', () => {
    expect(renderToStaticMarkup(React.createElement(StageProgress, { status: 'Operando' }))).toBe(
      ''
    );
    expect(renderToStaticMarkup(React.createElement(StageProgress, { status: 'Rechazada' }))).toBe(
      ''
    );
  });
});
