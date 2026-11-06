import { describe, expect, it } from 'vitest';

import {
  CCA_DIVISOR,
  DEFAULT_CCA_PCT,
  DEFAULT_LEAD_BRACKETS,
  DEFAULT_PLAN_PRICING,
  MAX_CCA_PCT,
  MAX_PRICE_CLP,
  MAX_USERS,
  MIN_CCA_PCT,
  PLAN_PRICING_VERSION,
  PRICING_PROFILES,
  ccaAmountClp,
  ccaFactor,
  captacionMonthlyFor,
  formatCcaAmount,
  formatDecimalInput,
  normalizePlanPricing,
  parseDecimalInput,
  profileLabel,
  profilePlan,
  type PlanPricingConfig,
} from './planPricing';

function config(overrides: Partial<PlanPricingConfig> = {}): PlanPricingConfig {
  return {
    version: PLAN_PRICING_VERSION,
    ccaPct: DEFAULT_CCA_PCT,
    captacion: DEFAULT_LEAD_BRACKETS,
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
  it('el %CCA de partida cobra 0,1 % de la cartera al año', () => {
    // 8.333,33 deja el factor en 12.000: la cartera dividida por 12.000 al mes.
    expect(DEFAULT_PLAN_PRICING.ccaPct).toBe(8_333.33);
    expect(ccaFactor(DEFAULT_PLAN_PRICING.ccaPct)).toBeCloseTo(12_000, 2);
  });

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
    expect(profilePlan({ ...config(), profiles: [] }, 'agente')).toBeNull();
  });
});

describe('CCA', () => {
  it('con el 100 % de siempre: 100.000 de CCA con UF de $40.000 son $4.000', () => {
    expect(ccaAmountClp(100_000, 40_000, 100)).toBe(4000);
    expect(CCA_DIVISOR).toBe(1_000_000);
  });

  it('aplica la fórmula completa: CCA × UF ÷ 1.000.000', () => {
    expect(ccaAmountClp(500_000, 40_000, 100)).toBe(20_000);
    expect(ccaAmountClp(30, 39_500, 100)).toBeCloseTo(1.185, 6);
  });

  it('no redondea acá: deja los decimales a la vista del formato', () => {
    expect(ccaAmountClp(5, 39_000, 100)).toBeCloseTo(0.195, 6);
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

describe('%CCA: el ajuste del factor', () => {
  it('sin indicarlo aplica el %CCA de partida: 0,1 % anual', () => {
    // 100.000 UF de cartera ($4.000 millones) → $333.333 al mes.
    expect(Math.round(ccaAmountClp(100_000, 40_000, DEFAULT_CCA_PCT))).toBe(333_333);
    expect(ccaFactor(DEFAULT_CCA_PCT)).toBeCloseTo(12_000, 2);
  });

  it('la mitad del %CCA cobra la mitad y duplica el divisor', () => {
    expect(ccaAmountClp(100_000, 40_000, 50)).toBe(2000);
    expect(ccaFactor(50)).toBe(2_000_000);
  });

  it('el doble del %CCA cobra el doble y reduce el divisor a la mitad', () => {
    expect(ccaAmountClp(100_000, 40_000, 200)).toBe(8000);
    expect(ccaFactor(200)).toBe(500_000);
  });

  it('acepta decimales: un 150,5 % cobra una vez y media', () => {
    expect(ccaAmountClp(100_000, 40_000, 150.5)).toBeCloseTo(6020, 6);
    expect(ccaFactor(150.5)).toBeCloseTo(1_000_000 / 1.505, 6);
  });

  it('con un %CCA imposible no cobra nada, en vez de inventar un monto', () => {
    expect(ccaAmountClp(100_000, 40_000, 0)).toBe(0);
    expect(ccaAmountClp(100_000, 40_000, -50)).toBe(0);
    expect(ccaAmountClp(100_000, 40_000, MAX_CCA_PCT + 1)).toBe(0);
    expect(ccaAmountClp(100_000, 40_000, Number.NaN)).toBe(0);
    // El factor, en cambio, cae en el base: mostrar 1.000.000 es no ajustar nada.
    expect(ccaFactor(0)).toBe(CCA_DIVISOR);
    expect(ccaFactor(Number.NaN)).toBe(CCA_DIVISOR);
  });

  it('con el 100 % de siempre, el ejemplo con la UF de hoy sigue dando $4.125', () => {
    const amount = ccaAmountClp(100_000, 41_252.94, 100);
    expect(amount).toBeCloseTo(4125.294, 6);
    expect(formatCcaAmount(amount)).toContain('4.125');
  });
});

describe('convención chilena de la calculadora', () => {
  it('formatea con punto de miles y coma decimal', () => {
    expect(formatDecimalInput(100_000)).toBe('100.000');
    expect(formatDecimalInput(41_242.32)).toBe('41.242,32');
    expect(formatDecimalInput(39_500)).toBe('39.500');
  });

  it('lee el CCA con punto de miles', () => {
    expect(parseDecimalInput('100.000')).toBe(100_000);
    expect(parseDecimalInput('1.234.567')).toBe(1_234_567);
    expect(parseDecimalInput('100000')).toBe(100_000);
  });

  it('lee la UF del indicador, que trae punto decimal', () => {
    // El número crudo de /api/indicators: antes el campo leía 4124232.
    expect(parseDecimalInput('41242.32')).toBeCloseTo(41_242.32, 6);
    expect(parseDecimalInput('39500.4')).toBeCloseTo(39_500.4, 6);
  });

  it('lee la UF con coma decimal, que es como se escribe acá', () => {
    expect(parseDecimalInput('41.242,32')).toBeCloseTo(41_242.32, 6);
    expect(parseDecimalInput('41.242,5')).toBeCloseTo(41_242.5, 6);
  });

  it('acepta los signos que la gente escribe: $, espacios', () => {
    expect(parseDecimalInput('$ 100.000')).toBe(100_000);
  });

  it('vacío es null, no cero', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('   ')).toBeNull();
    expect(parseDecimalInput('$')).toBeNull();
  });

  it('lo que se muestra se vuelve a leer igual: ida y vuelta', () => {
    for (const value of [100_000, 41_242.32, 1_234.5, 0.75]) {
      expect(parseDecimalInput(formatDecimalInput(value))).toBeCloseTo(value, 2);
    }
  });

  it('el CCA del ejemplo no se infla al pasar por el campo', () => {
    const amount = ccaAmountClp(
      parseDecimalInput('100.000')!,
      parseDecimalInput(formatDecimalInput(41_242.32))!,
      100
    );
    expect(amount).toBeCloseTo(4124.232, 3);
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

  it('una fila de la versión anterior entra con el %CCA de partida', () => {
    const result = normalizePlanPricing({ version: 2, profiles: [] });
    expect(result.ok).toBe(true);
    expect(result.config?.version).toBe(PLAN_PRICING_VERSION);
    expect(result.config?.ccaPct).toBe(DEFAULT_CCA_PCT);
  });

  it('guarda el %CCA que se le pase, con dos decimales como mucho', () => {
    expect(normalizePlanPricing({ ccaPct: 50 }).config?.ccaPct).toBe(50);
    expect(normalizePlanPricing({ ccaPct: 33.333 }).config?.ccaPct).toBe(33.33);
    // Sin %CCA en el cuerpo, no se borra: queda el de partida.
    expect(normalizePlanPricing({ profiles: [] }).config?.ccaPct).toBe(DEFAULT_CCA_PCT);
  });

  it('rechaza un %CCA fuera de rango o que no sea número', () => {
    expect(normalizePlanPricing({ ccaPct: 0 }).ok).toBe(false);
    expect(normalizePlanPricing({ ccaPct: MIN_CCA_PCT - 1 }).ok).toBe(false);
    expect(normalizePlanPricing({ ccaPct: MAX_CCA_PCT + 1 }).ok).toBe(false);
    expect(normalizePlanPricing({ ccaPct: '100' }).ok).toBe(false);
    expect(normalizePlanPricing({ ccaPct: Number.NaN }).ok).toBe(false);
    expect(normalizePlanPricing({ ccaPct: 0 }).error).toContain('%CCA');
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

describe('planes de captación', () => {
  it('la suscripción de captación de partida es la que definió el equipo', () => {
    expect(DEFAULT_PLAN_PRICING.captacion.monthly).toEqual([
      { profile: 'agente', monthlyClp: 9990 },
      { profile: 'corredora', monthlyClp: 19990 },
      { profile: 'inmobiliaria', monthlyClp: 39990 },
    ]);
  });

  it('los tramos de venta van en UF y los de arriendo en pesos', () => {
    expect(DEFAULT_PLAN_PRICING.captacion.ventas).toEqual([
      { from: 0, to: 5000, priceClp: 3000 },
      { from: 5001, to: 10000, priceClp: 5000 },
      { from: 10001, to: 20000, priceClp: 8000 },
      { from: 20001, to: 40000, priceClp: 12000 },
      { from: 40001, to: null, priceClp: 20000 },
    ]);
    expect(DEFAULT_PLAN_PRICING.captacion.arriendos).toEqual([
      { from: 0, to: 500000, priceClp: 2000 },
      { from: 500001, to: 1500000, priceClp: 3000 },
      { from: 1500001, to: null, priceClp: 5000 },
    ]);
  });

  it('la suscripción de un perfil sale de la configuración y cae en la de partida', () => {
    expect(captacionMonthlyFor(config(), 'inmobiliaria')).toBe(39990);
    expect(captacionMonthlyFor({ ...config(), captacion: { ...DEFAULT_LEAD_BRACKETS, monthly: [] } }, 'corredora')).toBe(19990);
  });

  it('sin bloque de captación devuelve los valores de partida', () => {
    const result = normalizePlanPricing({ profiles: [] });

    expect(result.ok).toBe(true);
    expect(result.config?.captacion.monthly).toEqual(DEFAULT_PLAN_PRICING.captacion.monthly);
    expect(result.config?.captacion.ventas).toEqual(DEFAULT_PLAN_PRICING.captacion.ventas);
    expect(result.config?.captacion.arriendos).toEqual(DEFAULT_PLAN_PRICING.captacion.arriendos);
  });

  it('una fila de la versión 3 entra con los planes de captación de partida', () => {
    const result = normalizePlanPricing({ version: 3, profiles: [] });

    expect(result.ok).toBe(true);
    expect(result.config?.version).toBe(PLAN_PRICING_VERSION);
    expect(result.config?.captacion).toEqual(DEFAULT_PLAN_PRICING.captacion);
  });

  it('guarda los precios que se le pasen, sin tocar los cortes', () => {
    const result = normalizePlanPricing({
      captacion: {
        monthly: [{ profile: 'agente', monthlyClp: 12000 }],
        ventas: DEFAULT_LEAD_BRACKETS.ventas.map((bracket) => ({
          ...bracket,
          priceClp: bracket.priceClp + 1000,
        })),
      },
    });

    expect(result.ok).toBe(true);
    expect(captacionMonthlyFor(result.config!, 'agente')).toBe(12000);
    // Los perfiles que no vinieron quedan como estaban.
    expect(captacionMonthlyFor(result.config!, 'corredora')).toBe(19990);
    expect(result.config?.captacion.ventas[0]).toEqual({ from: 0, to: 5000, priceClp: 4000 });
  });

  it('rechaza un tramo que deja un hueco: ese lead no tendría precio', () => {
    const conHueco = DEFAULT_LEAD_BRACKETS.ventas.map((bracket, index) =>
      index === 1 ? { ...bracket, from: 6000 } : bracket
    );

    const result = normalizePlanPricing({ captacion: { ventas: conHueco } });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('corridos');
  });

  it('rechaza un tramo que se superpone con el anterior', () => {
    const solapado = DEFAULT_LEAD_BRACKETS.arriendos.map((bracket, index) =>
      index === 1 ? { ...bracket, from: 400000 } : bracket
    );

    expect(normalizePlanPricing({ captacion: { arriendos: solapado } }).ok).toBe(false);
  });

  it('solo el último tramo puede quedar sin tope', () => {
    const abiertoAlMedio = DEFAULT_LEAD_BRACKETS.ventas.map((bracket, index) =>
      index === 0 ? { ...bracket, to: null } : bracket
    );

    const result = normalizePlanPricing({ captacion: { ventas: abiertoAlMedio } });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('último tramo');
  });

  it('la tabla tiene que empezar en 0', () => {
    const tarde = DEFAULT_LEAD_BRACKETS.ventas.map((bracket, index) =>
      index === 0 ? { ...bracket, from: 1 } : bracket
    );

    expect(normalizePlanPricing({ captacion: { ventas: tarde } }).ok).toBe(false);
  });

  it('rechaza un precio de acceso negativo o un tramo vacío', () => {
    expect(
      normalizePlanPricing({
        captacion: {
          ventas: [{ from: 0, to: null, priceClp: -1 }],
        },
      }).ok
    ).toBe(false);
    expect(normalizePlanPricing({ captacion: { arriendos: [] } }).ok).toBe(false);
  });

  it('rechaza una suscripción de captación fuera de rango', () => {
    expect(
      normalizePlanPricing({ captacion: { monthly: [{ profile: 'agente', monthlyClp: 1.5 }] } }).ok
    ).toBe(false);
    expect(
      normalizePlanPricing({
        captacion: { monthly: [{ profile: 'agente', monthlyClp: MAX_PRICE_CLP + 1 }] },
      }).ok
    ).toBe(false);
  });
});

describe('etiquetas', () => {
  it('el perfil independiente se muestra corto', () => {
    expect(profileLabel('agente')).toBe('Profesional');
    expect(profileLabel('corredora')).toBe('Corredora');
    expect(profileLabel('inmobiliaria')).toBe('Inmobiliaria');
  });
});
