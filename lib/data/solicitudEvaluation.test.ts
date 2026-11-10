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
    // Las aclaraciones del motor y, siempre que queda pendiente, el informe de
    // deudas de la CMF.
    expect(result.questions.map((question) => question.id).sort()).toEqual([
      'correo',
      'debt_report',
      'sitio',
    ]);
  });

  it('un agente independiente no arrastra las exigencias de una empresa', () => {
    const result = evaluateSolicitud(solicitud({ kind: 'agente' }));

    // Sin sitio y con Gmail: para una persona es lo esperable, así que se acepta
    // —no se le pide un dato que no tiene— pero con menos puntaje que una
    // empresa que acredita las dos cosas.
    expect(result.decision).toBe('Aceptada');
    expect(result.score).toBe(90);
    expect(result.questions).toEqual([]);
    expect(result.checks.find((check) => check.id === 'correo')?.status).toBe('warn');
    expect(result.checks.find((check) => check.id === 'sitio')?.status).toBe('warn');
    expect(result.checks.find((check) => check.id === 'correo')?.question).toBeUndefined();
    expect(result.checks.find((check) => check.id === 'sitio')?.question).toBeUndefined();
  });

  it('un agente con sitio propio y correo personal tampoco tiene que aclararlo', () => {
    const result = evaluateSolicitud(
      solicitud({ kind: 'agente' }, { website: 'https://anatorres.cl' })
    );

    expect(result.decision).toBe('Aceptada');
    expect(result.score).toBe(90);
    expect(result.questions).toEqual([]);
    expect(result.checks.find((check) => check.id === 'sitio')?.status).toBe('warn');
    expect(result.checks.find((check) => check.id === 'sitio')?.question).toBeUndefined();
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

  it('sin informe los pesos suman 80 y el puntaje se normaliza: se lee como porcentaje', () => {
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl' }
      )
    );
    const total = result.checks.reduce((sum, check) => sum + check.weight, 0);

    // Las dos verificaciones del informe de deudas solo existen cuando la ronda
    // lo trajo; sin ellas, los pesos presentes suman 80 y el puntaje se
    // normaliza, así que un registro limpio sigue dando 100.
    expect(total).toBe(80);
    expect(result.score).toBe(100);
  });

  it('con el informe cargado los pesos suman 100 y se evalúa el titular y la deuda', () => {
    const base = solicitud(
      { email: 'camila@catedralpropiedades.cl' },
      { website: 'https://catedralpropiedades.cl' }
    );
    const result = evaluateSolicitud(base, {
      debtReport: {
        read: true,
        issuedAt: '2026-11-01',
        rut: base.payload.rut as string,
        debtor: String(base.payload.legalName ?? 'CATEDRAL PROPIEDADES SPA'),
        totalDebtClp: 5_000_000,
        creditors: 2,
        currentClp: 5_000_000,
        overdueClp: 0,
        writtenOffClp: 0,
        summary: 'Informe leído',
        notes: [],
      },
    });

    const total = result.checks.reduce((sum, check) => sum + check.weight, 0);
    expect(total).toBe(100);
    expect(result.checks.find((check) => check.id === 'deuda_titular')?.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'deuda')?.status).toBe('pass');
    expect(result.score).toBe(100);
    expect(result.decision).toBe('Aceptada');
  });

  it('un informe de otro RUT deja el registro pendiente, aunque el resto pase', () => {
    const result = evaluateSolicitud(
      solicitud(
        { email: 'camila@catedralpropiedades.cl' },
        { website: 'https://catedralpropiedades.cl' }
      ),
      {
      debtReport: {
        read: true,
        issuedAt: '2026-11-01',
        rut: '12.345.678-5',
        debtor: 'OTRA EMPRESA SPA',
        totalDebtClp: 0,
        creditors: 0,
        currentClp: 0,
        overdueClp: 0,
        writtenOffClp: 0,
          summary: 'Informe leído',
          notes: [],
        },
      }
    );

    expect(result.checks.find((check) => check.id === 'deuda_titular')?.status).toBe('fail');
    expect(result.decision).toBe('Pendiente_Informacion');
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
