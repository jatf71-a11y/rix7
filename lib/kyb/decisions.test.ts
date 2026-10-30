import { describe, it, expect } from 'vitest';
import {
  decisionsFor,
  KYB_DECISION_LABELS,
  normalizeDecision,
  whyCannotDecide,
} from './decisions';
import { KYB_STATUSES } from './status';

describe('qué puede decidir el equipo', () => {
  it('decide sobre una solicitud ya evaluada, en sus dos estados', () => {
    expect(decisionsFor('En_Evaluacion')).toEqual([
      'Aceptada',
      'Pendiente_Informacion',
      'Rechazada',
    ]);
    // Aprobar sigue disponible: el dato puede haber llegado por otra vía, y
    // volver a preguntar también: no se mueve el estado, se abre otra ronda.
    expect(decisionsFor('Pendiente_Informacion')).toEqual([
      'Aceptada',
      'Pendiente_Informacion',
      'Rechazada',
    ]);
  });

  it('volver a pedir información solo se ofrece sobre algo ya pendiente', () => {
    expect(decisionsFor('En_Evaluacion')).toContain('Pendiente_Informacion');
    // En los estados en los que no hay evaluación no hay nada que volver a pedir.
    expect(decisionsFor('Recibida')).not.toContain('Pendiente_Informacion');
    expect(decisionsFor('En_Alta')).not.toContain('Pendiente_Informacion');
  });

  it('no decide sobre lo que todavía no se evaluó ni sobre lo terminal', () => {
    expect(decisionsFor('Recibida')).toEqual([]);
    expect(decisionsFor('Aceptada')).toEqual([]);
    expect(decisionsFor('En_Alta')).toEqual([]);
    expect(decisionsFor('Operando')).toEqual([]);
    expect(decisionsFor('Rechazada')).toEqual([]);
  });

  it('explica por qué no se puede decidir, en cada caso', () => {
    expect(whyCannotDecide('En_Evaluacion')).toBeNull();
    expect(whyCannotDecide('En_Alta')).toMatch(/eligiendo su plan/);
    expect(whyCannotDecide('Operando')).toMatch(/terminó/);
    expect(whyCannotDecide('Rechazada')).toMatch(/ya quedó rechazada/);
    expect(whyCannotDecide('Aceptada')).toMatch(/sigue con la empresa/);
    expect(whyCannotDecide('Recibida')).toMatch(/no tiene evaluación/);
  });

  it('cada decisión tiene su verbo para el botón', () => {
    expect(KYB_DECISION_LABELS.Aceptada).toBe('Aprobar');
    expect(KYB_DECISION_LABELS.Pendiente_Informacion).toBe('Pedir información');
    expect(KYB_DECISION_LABELS.Rechazada).toBe('Rechazar');
  });

  it('ningún estado queda sin una respuesta sobre si admite decisión', () => {
    for (const status of KYB_STATUSES) {
      const blocked = whyCannotDecide(status);
      const options = decisionsFor(status);
      // O hay decisiones disponibles, o hay un motivo escrito: nunca las dos
      // cosas vacías, que es lo que dejaría al panel sin nada que mostrar.
      expect(Boolean(blocked) || options.length > 0, status).toBe(true);
    }
  });
});

describe('normalización de la decisión', () => {
  it('rechaza sin motivo', () => {
    const result = normalizeDecision({ decision: 'Rechazada' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/motivo/i);
  });

  it('rechaza con un motivo de una palabra', () => {
    const result = normalizeDecision({ decision: 'Rechazada', note: 'no' });
    expect(result.ok).toBe(false);
  });

  it('acepta el rechazo con su motivo', () => {
    const result = normalizeDecision({
      decision: 'Rechazada',
      note: 'El RUT no coincide con el registro comercial declarado.',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.decision).toBe('Rechazada');
      expect(result.data.note).toContain('RUT');
      expect(result.data.questions).toEqual([]);
    }
  });

  it('pedir información exige preguntas', () => {
    const result = normalizeDecision({ decision: 'Pendiente_Informacion', questions: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pregunta/i);
  });

  it('convierte las preguntas en la ronda que responde la empresa', () => {
    const result = normalizeDecision({
      decision: 'Pendiente_Informacion',
      questions: ['  ¿Cuál es el domicilio comercial?  ', '', '¿Quién es el representante legal?'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.questions).toEqual([
        { id: 'manual_1', question: '¿Cuál es el domicilio comercial?' },
        { id: 'manual_2', question: '¿Quién es el representante legal?' },
      ]);
    }
  });

  it('no deja mandar más preguntas de las que se responden por correo', () => {
    const result = normalizeDecision({
      decision: 'Pendiente_Informacion',
      questions: Array.from({ length: 6 }, (_, i) => `Pregunta número ${i + 1} sobre la empresa`),
    });
    expect(result.ok).toBe(false);
  });

  it('aprobar no exige nada y el comentario es opcional', () => {
    const sin = normalizeDecision({ decision: 'Aceptada' });
    expect(sin.ok).toBe(true);
    if (sin.ok) expect(sin.data.note).toBeNull();

    const con = normalizeDecision({ decision: 'Aceptada', note: 'Verificado por teléfono.' });
    expect(con.ok).toBe(true);
    if (con.ok) expect(con.data.note).toBe('Verificado por teléfono.');
  });

  it('no acepta decisiones inventadas', () => {
    expect(normalizeDecision({ decision: 'En_Alta' }).ok).toBe(false);
    expect(normalizeDecision({ decision: 'rechazada' }).ok).toBe(false);
    expect(normalizeDecision({ decision: 42 }).ok).toBe(false);
  });

  it('corta el motivo que no cabe en el correo', () => {
    const result = normalizeDecision({ decision: 'Rechazada', note: 'x'.repeat(1001) });
    expect(result.ok).toBe(false);
  });
});
