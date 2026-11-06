import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuestionsStep from './QuestionsStep';
import PlanStep from './PlanStep';

/**
 * Lo que se puede comprobar sin navegador: la estructura que recibe la empresa.
 *
 * Los componentes no consultan nada al renderizar (el envío va por eventos), así
 * que `renderToStaticMarkup` basta. La suite del proyecto no tiene DOM ni
 * Testing Library, y añadirlos por una pantalla no se justifica; estos asserts
 * cubren lo que un error de marcado rompería: etiquetas asociadas, radios
 * reales, nada preseleccionado y el botón deshabilitado hasta elegir.
 */

const QUESTIONS = [
  { id: 'reputation', question: 'Encontramos 4 reseñas negativas. ¿Qué medidas tomaron?' },
  { id: 'domain_web', question: 'El sitio no responde. ¿Sigue activo?' },
];

describe('pantalla de preguntas', () => {
  const html = renderToStaticMarkup(
    React.createElement(QuestionsStep, { token: 'token-de-prueba', questions: QUESTIONS, onAnswered: () => {} })
  );

  it('muestra cada pregunta con su campo asociado', () => {
    QUESTIONS.forEach((question, index) => {
      expect(html).toContain(question.question);
      expect(html).toContain(`id="kyb-answer-${index}"`);
      expect(html).toContain(`for="kyb-answer-${index}"`);
      expect(html).toContain(`aria-describedby="kyb-answer-${index}-hint"`);
    });
    expect((html.match(/<textarea/g) ?? []).length).toBe(QUESTIONS.length);
  });

  it('empieza sin marcar errores y con el botón habilitado para escribir', () => {
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('Enviar respuestas');
    expect(html).not.toContain('disabled=""');
  });
});

describe('paso de plan', () => {
  /**
   * Los montos los calcula el servidor (`altaPlanSummary`): la pantalla solo los
   * dibuja. Antes esta prueba fijaba los precios del catálogo del código, que
   * eran justamente los que el panel había dejado de usar.
   */
  const planSummary = {
    planId: 'profesional' as const,
    planName: 'Profesional',
    altaClp: 49990,
    monthlyClp: 39990,
    usuariosIncluidos: 5,
    source: 'propuesta' as const,
  };

  const html = renderToStaticMarkup(
    React.createElement(PlanStep, {
      token: 'token-de-prueba',
      planSummary,
      onActivated: () => {},
    })
  );

  it('muestra el plan de la propuesta con sus montos, no el catálogo', () => {
    expect(html).toContain('Profesional');
    expect(html).toContain('39.990');
    expect(html).toContain('49.990');
    expect(html).toContain('5');
    // Un solo plan: ya quedó fijado cuando el candidato aceptó la propuesta.
    expect((html.match(/type="radio"/g) ?? []).length).toBe(0);
    expect(html).not.toContain('Básico');
    expect(html).not.toContain('Premium');
  });

  it('exige una confirmación explícita antes de habilitar el panel', () => {
    expect(html).not.toContain('checked');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Confirmar plan/);
    expect(html).toContain('Confirmo el plan y la mensualidad');
  });

  it('dice de dónde salen los montos', () => {
    expect(html).toContain('Montos de la propuesta que aceptaste');
  });
});
