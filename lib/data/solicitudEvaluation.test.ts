import { describe, expect, it } from 'vitest';

import { evaluateSolicitud, SOLICITUD_PASS_SCORE } from './solicitudEvaluation';
import type { Solicitud } from './solicitudes';

/**
 * El motor de los registros de socios: qué mira, cuánto pesa y cuándo pregunta.
 *
 * Lo que se prueba acá es la decisión, no el HTML del correo: un cambio de peso
 * o de umbral mueve a quién se le pide información, y eso no puede depender de
 * que alguien abra la bandeja y lo note.
 */

const BASE: Solicitud = {
  id: 'sol-1',
  kind: 'corredora',
  name: 'Camila Rojas',
  email: 'camila@gmail.com',
  phone: '+56 9 1234 5678',
  company: 'Catedral Propiedades',
  message: null,
  payload: {
    rut: '76123456-0',
    role: 'Gerente comercial',
    coverage: 'nacional',
    regions: [],
    website: null,
  },
  status: 'Recibida',
  createdAt: '2026-10-29T10:00:00.000Z',
};

function solicitud(
  overrides: Partial<Solicitud> = {},
  payload: Solicitud['payload'] = {}
): Solicitud {
  return { ...BASE, ...overrides, payload: { ...BASE.payload, ...payload } };
}

describe('evaluateSolicitud', () => {
  it('acepta una corredora con correo y sitio del mismo dominio', () => {
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl' }
      )
    );

    expect(result.decision).toBe('Aceptada');
    expect(result.score).toBe(100);
    expect(result.questions).toEqual([]);
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('pide información cuando no hay sitio y el correo es personal', () => {
    const result = evaluateSolicitud(solicitud());

    expect(result.decision).toBe('Pendiente_Informacion');
    expect(result.score).toBeLessThan(SOLICITUD_PASS_SCORE);
    expect(result.questions.map((question) => question.id).sort()).toEqual([
      'correo',
      'sitio',
    ]);
  });

  it('un agente independiente no arrastra las exigencias de una empresa', () => {
    const result = evaluateSolicitud(solicitud({ kind: 'agente' }));

    // Sin sitio y con Gmail: para una persona es lo esperable, no una alerta.
    expect(result.decision).toBe('Aceptada');
    expect(result.score).toBe(100);
    expect(result.questions).toEqual([]);
  });

  it('un RUT con dígito verificador inválido no pasa, aunque el resto esté bien', () => {
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl', rut: '76123456-9' }
      )
    );

    expect(result.decision).toBe('Pendiente_Informacion');
    expect(result.checks.find((check) => check.id === 'rut')?.status).toBe('fail');
    expect(result.questions.map((question) => question.id)).toContain('rut');
  });

  it('un alcance regional sin regiones es una incoherencia, no un dato faltante menor', () => {
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl', coverage: 'regional', regions: [] }
      )
    );

    expect(result.decision).toBe('Pendiente_Informacion');
    expect(result.checks.find((check) => check.id === 'cobertura')?.status).toBe('fail');
  });

  it('un registro repetido no se acepta solo: pregunta si es una corrección', () => {
    const repetida = solicitud({ id: 'sol-0' });
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl' }
      ),
      { existing: [repetida] }
    );

    expect(result.decision).toBe('Pendiente_Informacion');
    expect(result.checks.find((check) => check.id === 'duplicado')?.status).toBe('fail');
    expect(result.questions.map((question) => question.id)).toContain('duplicado');
  });

  it('las respuestas del solicitante resuelven la advertencia y suben el puntaje', () => {
    const result = evaluateSolicitud(solicitud(), {
      clarifications: {
        sitio: 'https://catedralpropiedades.cl',
        correo: 'camila@catedralpropiedades.cl',
      },
    });

    expect(result.decision).toBe('Aceptada');
    expect(result.score).toBe(100);
    expect(result.checks.find((check) => check.id === 'sitio')?.clarified).toContain(
      'catedralpropiedades.cl'
    );
  });

  it('los pesos suman 100: el puntaje se puede leer como porcentaje', () => {
    const result = evaluateSolicitud(solicitud());
    const total = result.checks.reduce((sum, check) => sum + check.weight, 0);

    expect(total).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('una advertencia que no bloquea no genera preguntas', () => {
    // Sitio y correo del mismo dominio, pero teléfono incompleto: advierte y
    // aun así pasa, así que no hay nada que preguntar.
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl', phone: '123' },
        { website: 'https://catedralpropiedades.cl' }
      )
    );

    expect(result.checks.find((check) => check.id === 'contacto')?.status).toBe('warn');
    expect(result.decision).toBe('Aceptada');
    expect(result.questions).toEqual([]);
  });
});
