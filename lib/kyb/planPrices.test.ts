import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN_PRICING,
  PLAN_PRICING_VERSION,
  normalizePlanPricing,
  planPrice,
} from './planPricing';

/**
 * Precio por plan: lo que la empresa elige desde el correo de calificación.
 *
 * Dos cosas que no pueden romperse: cada plan tiene sus montos y una fila
 * guardada antes de la versión 6 se migra desde los perfiles, sin mover los
 * precios que el equipo ya había cargado.
 */
describe('precio por plan', () => {
  it('los valores de partida son la escalera que el equipo ya tenía', () => {
    expect(DEFAULT_PLAN_PRICING.plans).toEqual([
      { plan: 'basico', altaInicialClp: 19990, mensualBaseClp: 14990, usuariosIncluidos: 1 },
      { plan: 'profesional', altaInicialClp: 49990, mensualBaseClp: 39990, usuariosIncluidos: 5 },
      { plan: 'premium', altaInicialClp: 99990, mensualBaseClp: 99990, usuariosIncluidos: 20 },
    ]);
  });

  it('devuelve el precio del plan pedido', () => {
    expect(planPrice(DEFAULT_PLAN_PRICING, 'premium')?.mensualBaseClp).toBe(99990);
    expect(planPrice(DEFAULT_PLAN_PRICING, 'basico')).toMatchObject({
      altaInicialClp: 19990,
      usuariosIncluidos: 1,
    });
  });

  it('valida los montos de cada plan', () => {
    const base = { version: PLAN_PRICING_VERSION, ccaPct: 100 };

    const negative = normalizePlanPricing({
      ...base,
      plans: [{ plan: 'basico', altaInicialClp: -1, mensualBaseClp: 1, usuariosIncluidos: 1 }],
    });
    expect(negative.ok).toBe(false);

    const users = normalizePlanPricing({
      ...base,
      plans: [{ plan: 'basico', altaInicialClp: 1, mensualBaseClp: 1, usuariosIncluidos: 0 }],
    });
    expect(users.ok).toBe(false);

    // Un plan que no existe se ignora; los otros dos quedan con su valor.
    const unknown = normalizePlanPricing({
      ...base,
      plans: [{ plan: 'platino', altaInicialClp: 1, mensualBaseClp: 1, usuariosIncluidos: 1 }],
    });
    expect(unknown.ok).toBe(true);
    expect(unknown.config?.plans.map((price) => price.plan)).toEqual([
      'basico',
      'profesional',
      'premium',
    ]);
  });

  it('una fila de la versión 5 hereda el precio de su perfil, sin mover cifras', () => {
    const migrated = normalizePlanPricing({
      version: 5,
      ccaPct: 100,
      profiles: [
        { profile: 'agente', altaInicialClp: 21000, mensualBaseClp: 11000, usuariosIncluidos: 2 },
        { profile: 'corredora', altaInicialClp: 52000, mensualBaseClp: 41000, usuariosIncluidos: 6 },
        {
          profile: 'inmobiliaria',
          altaInicialClp: 101000,
          mensualBaseClp: 99000,
          usuariosIncluidos: 16,
        },
      ],
    });

    expect(migrated.ok).toBe(true);
    expect(migrated.config?.version).toBe(PLAN_PRICING_VERSION);
    expect(migrated.config?.plans).toEqual([
      { plan: 'basico', altaInicialClp: 21000, mensualBaseClp: 11000, usuariosIncluidos: 2 },
      { plan: 'profesional', altaInicialClp: 52000, mensualBaseClp: 41000, usuariosIncluidos: 6 },
      { plan: 'premium', altaInicialClp: 101000, mensualBaseClp: 99000, usuariosIncluidos: 16 },
    ]);
  });

  it('una fila que ya trae precios por plan no se pisa con los perfiles', () => {
    const migrated = normalizePlanPricing({
      version: PLAN_PRICING_VERSION,
      ccaPct: 100,
      plans: [{ plan: 'basico', altaInicialClp: 1, mensualBaseClp: 2, usuariosIncluidos: 3 }],
      profiles: [
        { profile: 'agente', altaInicialClp: 21000, mensualBaseClp: 11000, usuariosIncluidos: 2 },
      ],
    });

    expect(migrated.ok).toBe(true);
    expect(migrated.config?.plans[0]).toEqual({
      plan: 'basico',
      altaInicialClp: 1,
      mensualBaseClp: 2,
      usuariosIncluidos: 3,
    });
  });
});
