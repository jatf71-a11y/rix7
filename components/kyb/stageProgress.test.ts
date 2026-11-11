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

  it('con las siete etapas cumplidas la barra queda entera en azul', () => {
    const html = renderToStaticMarkup(React.createElement(StageProgress, { status: 'Alta' }));

    expect((html.match(/bg-blue-300/g) ?? []).length).toBe(6);
    expect((html.match(/bg-blue-600/g) ?? []).length).toBe(1);
    expect(html).toContain('text-blue-700');
    expect(html).not.toContain('bg-slate-200');
    expect(html).not.toContain('bg-red-600');
  });

  it('mientras avanza sigue en azul y solo la aclaración va en rojo', () => {
    const waiting = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'En_Evaluacion' })
    );

    expect((waiting.match(/bg-blue-300/g) ?? []).length).toBe(1);
    expect((waiting.match(/bg-blue-600/g) ?? []).length).toBe(1);
    expect((waiting.match(/bg-slate-200/g) ?? []).length).toBe(5);
    expect(waiting).toContain('text-blue-700');
    expect(waiting).not.toContain('bg-red-600');

    const blocked = renderToStaticMarkup(
      React.createElement(StageProgress, { status: 'Pendiente_Informacion' })
    );

    expect((blocked.match(/bg-red-300/g) ?? []).length).toBe(2);
    expect((blocked.match(/bg-red-600/g) ?? []).length).toBe(1);
    expect(blocked).toContain('text-red-700');
    expect(blocked).not.toContain('bg-blue-600');
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
