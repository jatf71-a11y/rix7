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
    expect(canTransition('Aceptada', 'En_Alta')).toBe(true);
    // El alta se cierra cuando la empresa elige su plan.
    expect(canTransition('En_Alta', 'Operando')).toBe(true);
  });

  it('no permite saltos ni retrocesos', () => {
    expect(canTransition('Recibida', 'Aceptada')).toBe(false);
    expect(canTransition('Aceptada', 'En_Evaluacion')).toBe(false);
    expect(canTransition('Pendiente_Informacion', 'Recibida')).toBe(false);
    expect(canTransition('En_Alta', 'Recibida')).toBe(false);
  });

  it('permite rechazar solo desde una solicitud ya evaluada', () => {
    expect(canTransition('En_Evaluacion', 'Rechazada')).toBe(true);
    expect(canTransition('Pendiente_Informacion', 'Rechazada')).toBe(true);
    expect(canTransition('Recibida', 'Rechazada')).toBe(false);
    expect(canTransition('Aceptada', 'Rechazada')).toBe(false);
    expect(canTransition('En_Alta', 'Rechazada')).toBe(false);
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
    expect(canDecideManually('En_Alta', 'Pendiente_Informacion')).toBe(false);
    expect(canDecideManually('En_Alta', 'Aceptada')).toBe(false);
    expect(canDecideManually('Pendiente_Informacion', 'Rechazada')).toBe(true);
  });

  it('Operando y Rechazada son terminales', () => {
    // `En_Alta` ya no lo es: de ahí se sale a `Operando`, que es el cierre.
    const operando = assertTransition('Operando', 'Aceptada');
    expect(operando.ok).toBe(false);
    if (!operando.ok) expect(operando.error).toMatch(/No se puede pasar/);
    expect(canTransition('Operando', 'En_Alta')).toBe(false);
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
    expect(canEvaluate('En_Alta')).toBe(false);
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
