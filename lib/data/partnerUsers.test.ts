import { describe, it, expect } from 'vitest';

import {
  PARTNER_USER_ROLE_LABELS,
  isPartnerUserRole,
  normalizePartnerEmail,
  partnerUserLimit,
  planUserCapacity,
} from './partnerUsers';

/**
 * Las reglas que la pantalla no puede decidir sola: quién ocupa lugar, cuál es
 * el tope del plan y qué correo es el mismo correo.
 */
describe('usuarios del socio', () => {
  it('reconoce solo los roles que existen', () => {
    expect(isPartnerUserRole('admin')).toBe(true);
    expect(isPartnerUserRole('editor')).toBe(true);
    expect(isPartnerUserRole('owner')).toBe(false);
    expect(PARTNER_USER_ROLE_LABELS.admin).toMatch(/cuenta/i);
  });

  it('normaliza el correo antes de compararlo', () => {
    expect(normalizePartnerEmail('  Persona@Empresa.CL ')).toBe('persona@empresa.cl');
    expect(normalizePartnerEmail('sin-arroba')).toBeNull();
  });

  it('el tope sale de Planes y, si no hay precio, del catálogo del plan', () => {
    expect(partnerUserLimit({ usuariosIncluidos: 12 }, 'profesional')).toBe(12);
    expect(partnerUserLimit(null, 'profesional')).toBe(5); // catálogo
    expect(partnerUserLimit(null, 'premium')).toBe(20);
    // Sin plan legible el mínimo es uno: la cuenta que existe desde el alta.
    expect(partnerUserLimit(null, null)).toBe(1);
  });

  it('una invitación pendiente ocupa lugar y un revocado lo libera', () => {
    expect(planUserCapacity(1, 1).full).toBe(true);
    expect(planUserCapacity(1, 5)).toMatchObject({ used: 1, limit: 5, remaining: 4, full: false });
    expect(planUserCapacity(5, 5).remaining).toBe(0);
    // Un tope inválido no puede dejar el cupo negativo.
    expect(planUserCapacity(3, 0)).toMatchObject({ remaining: 0, full: true });
  });
});
