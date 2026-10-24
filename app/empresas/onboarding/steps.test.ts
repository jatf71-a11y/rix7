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

describe('selector de plan', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanStep, { token: 'token-de-prueba', onActivated: () => {} })
  );

  it('ofrece los tres planes con precio y beneficios', () => {
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(html).toContain('Básico');
    expect(html).toContain('Profesional');
    expect(html).toContain('Premium');
    expect(html).toContain('29.990');
    expect(html).toContain('50 publicaciones activas');
  });

  it('no preselecciona un plan y exige una elección para confirmar', () => {
    expect(html).not.toContain('checked');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Confirmar plan/);
  });

  it('declara el grupo de radios como un fieldset con su leyenda accesible', () => {
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend class="sr-only">Plan mensual</legend>');
    expect(html).toContain('name="kyb-plan"');
  });
});
