import { describe, it, expect } from 'vitest';
import { assertTransition, canEvaluate, canTransition, isKybStatus } from './status';

describe('transiciones KYB', () => {
  it('permite el camino del flujo', () => {
    expect(canTransition('Recibida', 'En_Evaluacion')).toBe(true);
    expect(canTransition('En_Evaluacion', 'Aceptada')).toBe(true);
    expect(canTransition('En_Evaluacion', 'Pendiente_Informacion')).toBe(true);
    expect(canTransition('Pendiente_Informacion', 'En_Evaluacion')).toBe(true);
    expect(canTransition('Aceptada', 'En_Alta')).toBe(true);
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

  it('En_Alta y Rechazada son terminales', () => {
    const alta = assertTransition('En_Alta', 'Aceptada');
    expect(alta.ok).toBe(false);
    if (!alta.ok) expect(alta.error).toMatch(/No se puede pasar/);

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
    expect(canEvaluate('Rechazada')).toBe(false);
  });

  it('reconoce los estados válidos', () => {
    expect(isKybStatus('Pendiente_Informacion')).toBe(true);
    expect(isKybStatus('pendiente_informacion')).toBe(false);
    expect(isKybStatus(null)).toBe(false);
  });
});
