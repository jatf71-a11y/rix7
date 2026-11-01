import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  canDecideManually,
  canEvaluate,
  canTransition,
  isKybStatus,
} from './status';

describe('transiciones KYB', () => {
  it('permite el camino del flujo', () => {
    expect(canTransition('Recibida', 'En_Evaluacion')).toBe(true);
    expect(canTransition('En_Evaluacion', 'Aceptada')).toBe(true);
    expect(canTransition('En_Evaluacion', 'Pendiente_Informacion')).toBe(true);
    expect(canTransition('Pendiente_Informacion', 'En_Evaluacion')).toBe(true);
    expect(canTransition('Aceptada', 'Calificado')).toBe(true);
    // El tramo comercial: calificada → propuesta → aceptada por el candidato.
    expect(canTransition('Calificado', 'Propuesta_Comercial')).toBe(true);
    expect(canTransition('Propuesta_Comercial', 'Alta')).toBe(true);
    // Operando no se alcanza sin pasar por el alta y el pago.
    expect(canTransition('Alta', 'Operando')).toBe(true);
    expect(canTransition('Calificado', 'Operando')).toBe(false);
    expect(canTransition('Propuesta_Comercial', 'Operando')).toBe(false);
  });

  it('la propuesta se puede renegociar: vuelve a calificado', () => {
    expect(canTransition('Propuesta_Comercial', 'Calificado')).toBe(true);
  });

  it('no permite saltos ni retrocesos', () => {
    expect(canTransition('Recibida', 'Aceptada')).toBe(false);
    expect(canTransition('Aceptada', 'En_Evaluacion')).toBe(false);
    expect(canTransition('Pendiente_Informacion', 'Recibida')).toBe(false);
    expect(canTransition('Calificado', 'Recibida')).toBe(false);
  });

  it('permite rechazar desde una solicitud ya evaluada o con propuesta', () => {
    expect(canTransition('En_Evaluacion', 'Rechazada')).toBe(true);
    expect(canTransition('Pendiente_Informacion', 'Rechazada')).toBe(true);
    expect(canTransition('Recibida', 'Rechazada')).toBe(false);
    expect(canTransition('Aceptada', 'Rechazada')).toBe(false);
    // Calificado se puede cerrar sin proponer nada, y una propuesta rechazada
    // por el candidato también termina ahí.
    expect(canTransition('Calificado', 'Rechazada')).toBe(true);
    expect(canTransition('Propuesta_Comercial', 'Rechazada')).toBe(true);
  });

  it('desde pendiente el equipo también puede aprobar a mano', () => {
    expect(canTransition('Pendiente_Informacion', 'Aceptada')).toBe(true);
    expect(canTransition('Pendiente_Informacion', 'En_Evaluacion')).toBe(true);
  });

  it('volver a pedir información no es una transición, pero se admite', () => {
    expect(canTransition('Pendiente_Informacion', 'Pendiente_Informacion')).toBe(false);
    expect(canDecideManually('Pendiente_Informacion', 'Pendiente_Informacion')).toBe(true);

    // La excepción es solo para volver a preguntar: el resto sigue la tabla.
    expect(canDecideManually('En_Evaluacion', 'Pendiente_Informacion')).toBe(true);
    expect(canDecideManually('Recibida', 'Pendiente_Informacion')).toBe(false);
    expect(canDecideManually('Calificado', 'Pendiente_Informacion')).toBe(false);
    expect(canDecideManually('Calificado', 'Aceptada')).toBe(false);
    expect(canDecideManually('Pendiente_Informacion', 'Rechazada')).toBe(true);
  });

  it('Operando y Rechazada son terminales', () => {
    // `Alta` tampoco es terminal: se cierra a `Operando` cuando entra el pago.
    expect(canTransition('Alta', 'Calificado')).toBe(false);
    expect(canTransition('Alta', 'Rechazada')).toBe(false);
    const operando = assertTransition('Operando', 'Aceptada');
    expect(operando.ok).toBe(false);
    if (!operando.ok) expect(operando.error).toMatch(/No se puede pasar/);
    expect(canTransition('Operando', 'Calificado')).toBe(false);
    expect(canTransition('Operando', 'Rechazada')).toBe(false);

    const rechazada = assertTransition('Rechazada', 'En_Evaluacion');
    expect(rechazada.ok).toBe(false);
    expect(canTransition('Rechazada', 'Aceptada')).toBe(false);
  });

  it('explica cuando la solicitud ya está en ese estado', () => {
    const same = assertTransition('Recibida', 'Recibida');
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error).toMatch(/ya está/);
  });

  it('solo se evalúa antes del alta', () => {
    expect(canEvaluate('Recibida')).toBe(true);
    expect(canEvaluate('En_Evaluacion')).toBe(true);
    expect(canEvaluate('Pendiente_Informacion')).toBe(true);
    expect(canEvaluate('Aceptada')).toBe(false);
    expect(canEvaluate('Calificado')).toBe(false);
    expect(canEvaluate('Propuesta_Comercial')).toBe(false);
    expect(canEvaluate('Alta')).toBe(false);
    expect(canEvaluate('Operando')).toBe(false);
    expect(canEvaluate('Rechazada')).toBe(false);
  });

  it('reconoce los estados válidos', () => {
    expect(isKybStatus('Pendiente_Informacion')).toBe(true);
    expect(isKybStatus('Operando')).toBe(true);
    expect(isKybStatus('operando')).toBe(false);
    expect(isKybStatus('pendiente_informacion')).toBe(false);
    expect(isKybStatus(null)).toBe(false);
  });
});
