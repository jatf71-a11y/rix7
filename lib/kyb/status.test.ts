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
    expect(canTransition('Pendiente_Informacion', 'Aceptada')).toBe(false);
    expect(canTransition('En_Alta', 'Recibida')).toBe(false);
  });

  it('En_Alta es terminal', () => {
    const terminal = assertTransition('En_Alta', 'Aceptada');
    expect(terminal.ok).toBe(false);
    if (!terminal.ok) expect(terminal.error).toMatch(/No se puede pasar/);
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
  });

  it('reconoce los estados válidos', () => {
    expect(isKybStatus('Pendiente_Informacion')).toBe(true);
    expect(isKybStatus('pendiente_informacion')).toBe(false);
    expect(isKybStatus(null)).toBe(false);
  });
});
