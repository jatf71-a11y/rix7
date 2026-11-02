import { describe, it, expect } from 'vitest';

import { ABANDON_AFTER_DAYS, canAutoClose, NUDGE_AFTER_DAYS, planNudge } from './socioNudges';

/**
 * La regla de recordatorios es lo único que decide si se le escribe a alguien o
 * se le cierra el trámite: se prueba como tabla, sin base ni correo.
 *
 * El contador es el que evita el spam: el primer aviso sale a los 3 días y el
 * segundo a los 10; con dos enviados no hay más hasta el cierre.
 */

const NOW = new Date('2026-11-01T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('planNudge', () => {
  it('espera los primeros días sin escribir', () => {
    expect(planNudge({ since: daysAgo(0), nudgesSent: 0, now: NOW }).action).toBe('none');
    expect(planNudge({ since: daysAgo(NUDGE_AFTER_DAYS[0] - 1), nudgesSent: 0, now: NOW }).action).toBe(
      'none'
    );
  });

  it('el primer recordatorio sale a los 3 días', () => {
    const plan = planNudge({ since: daysAgo(NUDGE_AFTER_DAYS[0]), nudgesSent: 0, now: NOW });

    expect(plan.action).toBe('remind');
    expect(plan.closingInDays).toBe(ABANDON_AFTER_DAYS - NUDGE_AFTER_DAYS[0]);
  });

  it('no repite el primer aviso', () => {
    expect(planNudge({ since: daysAgo(5), nudgesSent: 1, now: NOW }).action).toBe('none');
  });

  it('el segundo recordatorio sale a los 10 días y no hay tercero', () => {
    expect(planNudge({ since: daysAgo(NUDGE_AFTER_DAYS[1]), nudgesSent: 1, now: NOW }).action).toBe(
      'remind'
    );
    expect(planNudge({ since: daysAgo(20), nudgesSent: 2, now: NOW }).action).toBe('none');
  });

  it('a los 30 días cierra el trámite', () => {
    const plan = planNudge({ since: daysAgo(ABANDON_AFTER_DAYS), nudgesSent: 2, now: NOW });

    expect(plan.action).toBe('close');
    expect(plan.closingInDays).toBe(0);
  });

  it('una fecha rota no cierra ni escribe nada', () => {
    expect(planNudge({ since: null, nudgesSent: 0, now: NOW }).action).toBe('none');
    expect(planNudge({ since: 'no-es-fecha', nudgesSent: 0, now: NOW }).action).toBe('none');
  });
});

describe('canAutoClose', () => {
  it('cierra las etapas en las que el candidato no respondió', () => {
    expect(canAutoClose('Pendiente_Informacion')).toBe(true);
    expect(canAutoClose('Propuesta_Comercial')).toBe(true);
  });

  it('no cierra un alta con propuesta aceptada: esa venta la decide el equipo', () => {
    expect(canAutoClose('Alta')).toBe(false);
    expect(canAutoClose('Operando')).toBe(false);
    expect(canAutoClose('Calificado')).toBe(false);
  });
});
