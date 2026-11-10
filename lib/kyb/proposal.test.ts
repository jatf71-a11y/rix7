import { describe, it, expect } from 'vitest';

import { DEFAULT_PLAN_PRICING } from './planPricing';
import {
  KYB_PROPOSAL_NOTE_MAX,
  altaPlanSummary,
  defaultProposalAmounts,
  latestProposal,
  normalizeCommercial,
  normalizeProposal,
  planOptions,
  profileForRegistration,
  readProposals,
  type KybProposal,
} from './proposal';

/**
 * Propuesta comercial: validación, montos de partida e historial.
 *
 * Lo que importa que no se rompa: los montos salen del perfil correcto (cobrarle
 * a un profesional el alta de una inmobiliaria es un error comercial), una
 * propuesta sin números no se envía, y el historial no pierde la propuesta
 * anterior cuando se renegocia.
 */

const proposal = (overrides: Partial<KybProposal> = {}): KybProposal => ({
  planId: 'profesional',
  altaClp: 49990,
  monthlyClp: 39990,
  note: null,
  sentAt: '2026-11-01T12:00:00.000Z',
  decidedAt: null,
  decision: null,
  commercial: null,
  ...overrides,
});

describe('perfil de la propuesta', () => {
  it('cada camino de registro usa su perfil', () => {
    expect(profileForRegistration('corredora')).toBe('corredora');
    expect(profileForRegistration('inmobiliaria')).toBe('inmobiliaria');
    // El alta directa no declara tipo: se usa el perfil más chico.
    expect(profileForRegistration(null)).toBe('agente');
  });

  it('los montos de partida son los del plan que eligió la empresa', () => {
    expect(defaultProposalAmounts('basico')).toEqual({ altaClp: 19990, monthlyClp: 14990 });
    expect(defaultProposalAmounts('profesional')).toEqual({ altaClp: 49990, monthlyClp: 39990 });
    expect(defaultProposalAmounts('premium')).toEqual({ altaClp: 99990, monthlyClp: 99990 });
    // Y respetan una configuración guardada distinta.
    const custom = {
      ...DEFAULT_PLAN_PRICING,
      plans: DEFAULT_PLAN_PRICING.plans.map((item) =>
        item.plan === 'profesional' ? { ...item, altaInicialClp: 60000 } : item
      ),
    };
    expect(defaultProposalAmounts('profesional', custom).altaClp).toBe(60000);
  });
});

describe('normalizeProposal', () => {
  it('con solo el plan, completa los montos de ese plan', () => {
    const result = normalizeProposal({ plan: 'basico' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        planId: 'basico',
        altaClp: 19990,
        monthlyClp: 14990,
        note: null,
      });
    }
  });

  it('acepta montos negociados a mano', () => {
    const result = normalizeProposal({ plan: 'premium', altaClp: 0, monthlyClp: 45000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.altaClp).toBe(0);
      expect(result.data.monthlyClp).toBe(45000);
    }
  });

  it('rechaza un plan que no existe', () => {
    expect(normalizeProposal({ plan: 'platino' }).ok).toBe(false);
  });

  it('rechaza montos que no son enteros en pesos', () => {
    expect(normalizeProposal({ plan: 'basico', altaClp: 1.5 }).ok).toBe(false);
    expect(normalizeProposal({ plan: 'basico', monthlyClp: -1 }).ok).toBe(false);
    expect(normalizeProposal({ plan: 'basico', monthlyClp: 'mucho' }).ok).toBe(false);
  });

  it('corta la nota que no entra en el correo', () => {
    const result = normalizeProposal({
      plan: 'basico',
      note: 'x'.repeat(KYB_PROPOSAL_NOTE_MAX + 1),
    });
    expect(result.ok).toBe(false);
  });
});

describe('historial de propuestas', () => {
  it('lee la columna vacía como historial vacío', () => {
    expect(readProposals(null)).toEqual([]);
    expect(readProposals(undefined)).toEqual([]);
    expect(readProposals('cualquier cosa')).toEqual([]);
  });

  it('acepta una propuesta suelta y también la lista', () => {
    expect(readProposals(proposal())).toHaveLength(1);
    expect(readProposals([proposal(), proposal({ planId: 'basico' })])).toHaveLength(2);
  });

  it('descarta filas sin forma de propuesta en vez de romper la ficha', () => {
    expect(readProposals([{ hola: 1 }, proposal()])).toHaveLength(1);
  });

  it('la vigente es la última enviada', () => {
    const historia = [
      proposal({ decision: 'rechazada', decidedAt: '2026-11-02T12:00:00.000Z' }),
      proposal({ planId: 'basico', sentAt: '2026-11-03T12:00:00.000Z' }),
    ];
    expect(latestProposal(historia)?.planId).toBe('basico');
    expect(latestProposal([])).toBeNull();
  });
});

/**
 * Lo que se confirma en el paso de plan del alta.
 *
 * La regla que reemplazó al catálogo con precios: los montos son los de la
 * propuesta aceptada —que nacen de Planes— y, si no hubo propuesta, los de
 * Planes para el perfil del registro. Nunca los del código.
 */
describe('el plan del paso de alta', () => {
  it('con propuesta, muestra los montos que el candidato aceptó', () => {
    const summary = altaPlanSummary({
      plan: 'basico',
      proposal: proposal({ planId: 'premium', altaClp: 120000, monthlyClp: 80000 }),
    });

    expect(summary.planId).toBe('premium');
    expect(summary.planName).toBe('Premium');
    expect(summary.altaClp).toBe(120000);
    expect(summary.monthlyClp).toBe(80000);
    expect(summary.source).toBe('propuesta');
    // Los usuarios son los del plan: no hay cupo de publicaciones.
    expect(summary.usuariosIncluidos).toBe(20);
  });

  it('sin propuesta, los montos son los del plan en Planes', () => {
    const summary = altaPlanSummary({ plan: null, proposal: null });

    const profesional = DEFAULT_PLAN_PRICING.plans.find((p) => p.plan === 'profesional');
    expect(summary.planId).toBe('profesional');
    expect(summary.altaClp).toBe(profesional?.altaInicialClp);
    expect(summary.monthlyClp).toBe(profesional?.mensualBaseClp);
    expect(summary.usuariosIncluidos).toBe(profesional?.usuariosIncluidos);
    expect(summary.source).toBe('planes');
  });

  it('respeta la configuración que el equipo guardó en Planes', () => {
    const config = {
      ...DEFAULT_PLAN_PRICING,
      plans: DEFAULT_PLAN_PRICING.plans.map((item) =>
        item.plan === 'profesional'
          ? { ...item, altaInicialClp: 990, mensualBaseClp: 1, usuariosIncluidos: 2 }
          : item
      ),
    };

    const summary = altaPlanSummary({ plan: null, proposal: null, config });

    expect(summary.altaClp).toBe(990);
    expect(summary.monthlyClp).toBe(1);
    expect(summary.usuariosIncluidos).toBe(2);
  });

  it('un plan explícito manda sobre el perfil del registro', () => {
    const summary = altaPlanSummary({ plan: 'basico', proposal: null });

    expect(summary.planId).toBe('basico');
    expect(summary.planName).toBe('Básico');
    expect(summary.usuariosIncluidos).toBe(1);
  });
});

describe('planes del paso Calificado', () => {
  it('ofrece los tres planes con los precios de Planes y marca el sugerido', () => {
    const plans = planOptions('corredora');

    expect(plans.map((plan) => plan.planId)).toEqual(['basico', 'profesional', 'premium']);
    expect(plans.map((plan) => plan.planName)).toEqual(['Básico', 'Profesional', 'Premium']);
    expect(plans[0].altaClp).toBe(19990);
    expect(plans[0].monthlyClp).toBe(14990);
    expect(plans[1].altaClp).toBe(49990);
    expect(plans[1].monthlyClp).toBe(39990);
    expect(plans[2].monthlyClp).toBe(99990);
    // Sin cupo de publicaciones: eso se factura por CCA, no por plan.
    expect(plans[0].features.join(' ')).toContain('sin cupo');
    // La corredora queda sugerida en Profesional; sin tipo, en Básico.
    expect(plans.find((plan) => plan.recommended)?.planId).toBe('profesional');
    expect(planOptions(null).find((plan) => plan.recommended)?.planId).toBe('basico');
  });

  it('respeta los precios que el equipo cambió en Planes', () => {
    const config = {
      ...DEFAULT_PLAN_PRICING,
      plans: DEFAULT_PLAN_PRICING.plans.map((item) =>
        item.plan === 'profesional'
          ? { ...item, altaInicialClp: 1, mensualBaseClp: 2, usuariosIncluidos: 9 }
          : item
      ),
    };

    const profesional = planOptions('corredora', config).find(
      (plan) => plan.planId === 'profesional'
    );
    expect(profesional?.altaClp).toBe(1);
    expect(profesional?.monthlyClp).toBe(2);
    expect(profesional?.usuariosIncluidos).toBe(9);
  });
});

describe('condiciones comerciales de la aceptación', () => {
  it('aceptar no exige CCA: se determina después del alta', () => {
    const result = normalizeCommercial({});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ captacion: false });
  });

  it('registra la captación cuando el candidato la toma', () => {
    const result = normalizeCommercial({ captacion: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ captacion: true });
  });

  it('rechaza una respuesta de captación que no es sí o no', () => {
    expect(normalizeCommercial({ captacion: 'si' }).ok).toBe(false);
    expect(normalizeCommercial({ captacion: 1 }).ok).toBe(false);
  });

  it('la propuesta guardada conserva la captación aceptada', () => {
    const stored = [
      proposal({
        decision: 'aceptada',
        decidedAt: '2026-11-02T10:00:00.000Z',
        commercial: {
          captacion: true,
          acceptedAt: '2026-11-02T10:00:00.000Z',
        },
      }),
    ];

    const read = latestProposal(stored);
    expect(read?.commercial).toEqual({
      captacion: true,
      acceptedAt: '2026-11-02T10:00:00.000Z',
    });
  });

  it('una aceptación vieja con CCA se sigue leyendo, sin sus campos de CCA', () => {
    const read = readProposals([
      {
        planId: 'profesional',
        altaClp: 1,
        monthlyClp: 2,
        sentAt: '2026-10-01T00:00:00.000Z',
        decidedAt: '2026-10-02T00:00:00.000Z',
        decision: 'aceptada',
        commercial: {
          ccaAccepted: true,
          ccaUf: 100000,
          ccaPct: 100,
          captacion: false,
          acceptedAt: '2026-10-02T00:00:00.000Z',
        },
      },
    ]);

    expect(read[0].commercial).toEqual({
      captacion: false,
      acceptedAt: '2026-10-02T00:00:00.000Z',
    });
  });

  it('una fila vieja sin condiciones se lee con `commercial: null`', () => {
    const read = readProposals([
      {
        planId: 'profesional',
        altaClp: 1,
        monthlyClp: 2,
        sentAt: '2026-10-01T00:00:00.000Z',
        decision: 'aceptada',
      },
    ]);

    expect(read[0].commercial).toBeNull();
  });
});
