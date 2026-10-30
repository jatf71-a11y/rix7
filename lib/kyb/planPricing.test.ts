import { describe, expect, it } from 'vitest';

import {
  CCA_DIVISOR,
  DEFAULT_PLAN_PRICING,
  MAX_PRICE_CLP,
  MAX_USERS,
  PLAN_PRICING_VERSION,
  PRICING_PROFILES,
  ccaAmountClp,
  formatCcaAmount,
  normalizePlanPricing,
  profileLabel,
  profilePlan,
  type PlanPricingConfig,
} from './planPricing';

function config(overrides: Partial<PlanPricingConfig> = {}): PlanPricingConfig {
  return {
    version: PLAN_PRICING_VERSION,
    profiles: [
      {
        profile: 'agente',
        altaInicialClp: 10000,
        mensualBaseClp: 5000,
        usuariosIncluidos: 1,
      },
      {
        profile: 'corredora',
        altaInicialClp: 20000,
        mensualBaseClp: 15000,
        usuariosIncluidos: 5,
      },
      {
        profile: 'inmobiliaria',
        altaInicialClp: 30000,
        mensualBaseClp: 25000,
        usuariosIncluidos: 15,
      },
    ],
    ...overrides,
  };
}

describe('precios de partida', () => {
  it('son los tres perfiles con los montos definidos por el equipo', () => {
    expect(DEFAULT_PLAN_PRICING.profiles).toEqual([
      { profile: 'agente', altaInicialClp: 19990, mensualBaseClp: 14990, usuariosIncluidos: 1 },
      { profile: 'corredora', altaInicialClp: 49990, mensualBaseClp: 39990, usuariosIncluidos: 5 },
      {
        profile: 'inmobiliaria',
        altaInicialClp: 99990,
        mensualBaseClp: 99990,
        usuariosIncluidos: 15,
      },
    ]);
  });

  it('el orden de la tabla va del plan más barato al más caro', () => {
    expect(PRICING_PROFILES).toEqual(['agente', 'corredora', 'inmobiliaria']);
  });

  it('devuelve el plan de un perfil y null si no está', () => {
    expect(profilePlan(config(), 'corredora')?.usuariosIncluidos).toBe(5);
    expect(profilePlan({ version: 2, profiles: [] }, 'agente')).toBeNull();
  });
});

describe('CCA', () => {
  it('el ejemplo del equipo: 100.000 de CCA con UF de $40.000 son $4.000', () => {
    expect(ccaAmountClp(100_000, 40_000)).toBe(4000);
    expect(CCA_DIVISOR).toBe(1_000_000);
  });

  it('aplica la fórmula completa: CCA × UF ÷ 1.000.000', () => {
    expect(ccaAmountClp(500_000, 40_000)).toBe(20_000);
    expect(ccaAmountClp(30, 39_500)).toBeCloseTo(1.185, 6);
  });

  it('no redondea acá: deja los decimales a la vista del formato', () => {
    expect(ccaAmountClp(5, 39_000)).toBeCloseTo(0.195, 6);
  });

  it('con datos raros devuelve cero en vez de NaN', () => {
    expect(ccaAmountClp(Number.NaN, 39_000)).toBe(0);
    expect(ccaAmountClp(5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(ccaAmountClp(-1, 39_000)).toBe(0);
  });

  it('formatea el monto en pesos', () => {
    expect(formatCcaAmount(4000)).toContain('4.000');
  });
});

describe('normalizePlanPricing', () => {
  it('acepta una configuración parcial y completa los perfiles que faltan', () => {
    const result = normalizePlanPricing({
      profiles: [
        { profile: 'corredora', altaInicialClp: 45000, mensualBaseClp: 35000, usuariosIncluidos: 3 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(profilePlan(result.config!, 'corredora')).toEqual({
      profile: 'corredora',
      altaInicialClp: 45000,
      mensualBaseClp: 35000,
      usuariosIncluidos: 3,
    });
    expect(profilePlan(result.config!, 'agente')).toEqual(
      DEFAULT_PLAN_PRICING.profiles.find((item) => item.profile === 'agente')
    );
  });

  it('ignora perfiles desconocidos en vez de guardarlos', () => {
    const result = normalizePlanPricing({
      profiles: [{ profile: 'fantasma', altaInicialClp: 1, mensualBaseClp: 1, usuariosIncluidos: 1 }],
    });
    expect(result.ok).toBe(true);
    expect(result.config?.profiles).toHaveLength(3);
  });

  it('rechaza montos negativos, decimales o fuera del tope', () => {
    const base = { profile: 'agente', altaInicialClp: 19990, mensualBaseClp: 14990, usuariosIncluidos: 1 };
    expect(normalizePlanPricing({ profiles: [{ ...base, altaInicialClp: -1 }] }).ok).toBe(false);
    expect(normalizePlanPricing({ profiles: [{ ...base, mensualBaseClp: 1.5 }] }).ok).toBe(false);
    expect(
      normalizePlanPricing({ profiles: [{ ...base, mensualBaseClp: MAX_PRICE_CLP + 1 }] }).ok
    ).toBe(false);
  });

  it('exige al menos un usuario y topea los absurdos', () => {
    const base = { profile: 'agente', altaInicialClp: 19990, mensualBaseClp: 14990, usuariosIncluidos: 1 };
    expect(normalizePlanPricing({ profiles: [{ ...base, usuariosIncluidos: 0 }] }).ok).toBe(false);
    expect(normalizePlanPricing({ profiles: [{ ...base, usuariosIncluidos: MAX_USERS + 1 }] }).ok).toBe(
      false
    );
  });

  it('rechaza una configuración guardada con otra versión', () => {
    expect(normalizePlanPricing({ version: 1 }).ok).toBe(false);
  });

  it('rechaza cualquier cosa que no sea un objeto', () => {
    expect(normalizePlanPricing(null).ok).toBe(false);
    expect(normalizePlanPricing('precios').ok).toBe(false);
    expect(normalizePlanPricing([]).ok).toBe(false);
  });

  it('siempre devuelve los tres perfiles, en orden', () => {
    const result = normalizePlanPricing({});
    expect(result.ok).toBe(true);
    expect(result.config?.profiles.map((item) => item.profile)).toEqual([...PRICING_PROFILES]);
  });
});

describe('etiquetas', () => {
  it('el perfil independiente se muestra corto', () => {
    expect(profileLabel('agente')).toBe('Profesional');
    expect(profileLabel('corredora')).toBe('Corredora');
    expect(profileLabel('inmobiliaria')).toBe('Inmobiliaria');
  });
});
