import { describe, it, expect } from 'vitest';
import {
  answersPayload,
  evaluatingCopy,
  friendlyActivationError,
  friendlyAnswersError,
  missingAnswers,
  planName,
  portalStage,
  type KybAccessView,
} from './portal';

function view(overrides: Partial<KybAccessView> = {}): KybAccessView {
  return {
    status: 'En_Evaluacion',
    legalName: 'Catedral Propiedades SpA',
    questions: [],
    plan: null,
    panelEnabled: false,
    canChoosePlan: false,
    ...overrides,
  };
}

describe('portalStage', () => {
  it('pide respuestas cuando la solicitud quedó pendiente y hay preguntas', () => {
    const stage = portalStage(
      view({
        status: 'Pendiente_Informacion',
        questions: [{ id: 'email_corporate', question: '¿Es tuyo el dominio?' }],
      })
    );
    expect(stage).toBe('questions');
  });

  it('sin preguntas abiertas no muestra un formulario vacío', () => {
    expect(portalStage(view({ status: 'Pendiente_Informacion' }))).toBe('evaluating');
  });

  it('ofrece planes solo con la solicitud en En_Alta y el panel apagado', () => {
    expect(portalStage(view({ status: 'En_Alta', canChoosePlan: true }))).toBe('plans');
    expect(portalStage(view({ status: 'En_Alta', canChoosePlan: false }))).toBe('evaluating');
    expect(portalStage(view({ status: 'Aceptada' }))).toBe('evaluating');
  });

  it('un cliente que ya eligió plan está operando y no vuelve a ver planes', () => {
    expect(
      portalStage(view({ status: 'Operando', panelEnabled: true, plan: 'basico' }))
    ).toBe('active');
  });

  it('con el panel ya habilitado no vuelve a pedir plan, aunque el token siga vivo', () => {
    // La activación conserva el token hasta su vencimiento para tolerar
    // reintentos de red: abrir el enlace otra vez debe mostrar el panel, no el
    // selector de planes.
    expect(
      portalStage(view({ status: 'En_Alta', canChoosePlan: true, panelEnabled: true, plan: 'basico' }))
    ).toBe('active');
  });
});

describe('evaluatingCopy', () => {
  it('distingue una solicitud recién recibida de una que ya se evalúa', () => {
    expect(evaluatingCopy('Recibida').title).not.toBe(evaluatingCopy('En_Evaluacion').title);
  });

  it('en Pendiente_Informacion habla del correo, no de un formulario', () => {
    expect(evaluatingCopy('Pendiente_Informacion').body).toMatch(/correo/i);
  });

  it('cubre los seis estados del flujo', () => {
    const titles = [
      'Recibida',
      'En_Evaluacion',
      'Pendiente_Informacion',
      'Aceptada',
      'En_Alta',
      'Operando',
    ] as const;
    for (const status of titles) {
      expect(evaluatingCopy(status).title.length).toBeGreaterThan(0);
      expect(evaluatingCopy(status).body.length).toBeGreaterThan(0);
    }
  });
});

describe('respuestas del formulario', () => {
  const questions = [
    { id: 'email_corporate', question: '¿El correo es de la empresa?' },
    { id: 'website_unreachable', question: 'El sitio no respondió, ¿sigue activo?' },
  ];

  it('marca las que faltan o son demasiado cortas', () => {
    expect(missingAnswers(questions, {})).toEqual(['email_corporate', 'website_unreachable']);
    expect(missingAnswers(questions, { email_corporate: ' x ' })).toEqual([
      'email_corporate',
      'website_unreachable',
    ]);
    expect(missingAnswers(questions, { email_corporate: 'Sí', website_unreachable: 'ok' })).toEqual(
      []
    );
  });

  it('arma el cuerpo en el orden de las preguntas y recorta espacios', () => {
    expect(
      answersPayload(questions, {
        website_unreachable: '  Estamos migrando  ',
        email_corporate: 'Sí, es nuestro',
      })
    ).toEqual([
      { id: 'email_corporate', answer: 'Sí, es nuestro' },
      { id: 'website_unreachable', answer: 'Estamos migrando' },
    ]);
  });

  it('no manda respuestas que no corresponden a esta ronda', () => {
    const payload = answersPayload(questions, {
      email_corporate: 'Sí, es nuestro',
      website_unreachable: 'Estamos migrando',
      sobrante: 'esto no debe viajar',
    });
    expect(payload.map((entry) => entry.id)).toEqual(['email_corporate', 'website_unreachable']);
  });
});

describe('errores traducidos', () => {
  it('no muestra los ids internos cuando falta una respuesta', () => {
    const message = friendlyAnswersError('Faltan respuestas: reputation, email_corporate.');
    expect(message).toBe('Responde todas las preguntas para continuar.');
    expect(message).not.toMatch(/reputation/);
  });

  it('conserva un error de negocio tal como lo explica el servidor', () => {
    expect(friendlyAnswersError('El enlace ya no sirve para responder: la solicitud cambió de estado.')).toMatch(
      /enlace/
    );
  });

  it('no publica el nombre de una variable de entorno en el selector de plan', () => {
    const message = friendlyActivationError(
      'Falta SUPABASE_SERVICE_ROLE_KEY: no se puede crear la ficha ni vincular la cuenta del panel.'
    );
    expect(message).not.toMatch(/SUPABASE/);
    expect(message).toMatch(/correo/);
  });

  it('deja pasar el motivo cuando es accionable para la empresa', () => {
    expect(friendlyActivationError('El plan indicado no existe.')).toBe('El plan indicado no existe.');
  });
});

describe('planName', () => {
  it('traduce el identificador guardado al nombre que ve la empresa', () => {
    expect(planName('profesional')).toBe('Profesional');
  });

  it('no inventa un nombre para un plan desconocido o vacío', () => {
    expect(planName(null)).toBeNull();
    expect(planName('')).toBeNull();
    expect(planName('platino')).toBeNull();
  });
});
