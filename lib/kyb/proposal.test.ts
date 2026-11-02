import { describe, it, expect } from 'vitest';

import { DEFAULT_PLAN_PRICING } from './planPricing';
import {
  KYB_PROPOSAL_NOTE_MAX,
  altaPlanSummary,
  defaultProposalAmounts,
  latestProposal,
  normalizeProposal,
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
  ...overrides,
});

describe('perfil de la propuesta', () => {
  it('cada camino de registro usa su perfil', () => {
    expect(profileForRegistration('corredora')).toBe('corredora');
    expect(profileForRegistration('inmobiliaria')).toBe('inmobiliaria');
    // El alta directa no declara tipo: se usa el perfil más chico.
    expect(profileForRegistration(null)).toBe('agente');
  });

  it('los montos de partida son los que definió Planes', () => {
    expect(defaultProposalAmounts('corredora')).toEqual({ altaClp: 49990, monthlyClp: 39990 });
    expect(defaultProposalAmounts('inmobiliaria')).toEqual({
      altaClp: 99990,
      monthlyClp: 99990,
    });
    expect(defaultProposalAmounts(null)).toEqual({ altaClp: 19990, monthlyClp: 14990 });
    // Y respetan una configuración guardada distinta.
    const custom = {
      ...DEFAULT_PLAN_PRICING,
      profiles: DEFAULT_PLAN_PRICING.profiles.map((item) =>
        item.profile === 'corredora' ? { ...item, altaInicialClp: 60000 } : item
      ),
    };
    expect(defaultProposalAmounts('corredora', custom).altaClp).toBe(60000);
  });
});

describe('normalizeProposal', () => {
  it('con solo el plan, completa los montos del perfil', () => {
    const result = normalizeProposal({ plan: 'basico' }, 'corredora');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        planId: 'basico',
        altaClp: 49990,
        monthlyClp: 39990,
        note: null,
      });
    }
  });

  it('acepta montos negociados a mano', () => {
    const result = normalizeProposal(
      { plan: 'premium', altaClp: 0, monthlyClp: 45000 },
      'inmobiliaria'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.altaClp).toBe(0);
      expect(result.data.monthlyClp).toBe(45000);
    }
  });

  it('rechaza un plan que no existe', () => {
    expect(normalizeProposal({ plan: 'platino' }, null).ok).toBe(false);
  });

  it('rechaza montos que no son enteros en pesos', () => {
    expect(normalizeProposal({ plan: 'basico', altaClp: 1.5 }, null).ok).toBe(false);
    expect(normalizeProposal({ plan: 'basico', monthlyClp: -1 }, null).ok).toBe(false);
    expect(normalizeProposal({ plan: 'basico', monthlyClp: 'mucho' }, null).ok).toBe(false);
  });

  it('corta la nota que no entra en el correo', () => {
    const result = normalizeProposal(
      { plan: 'basico', note: 'x'.repeat(KYB_PROPOSAL_NOTE_MAX + 1) },
      null
    );
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
      kind: 'corredora',
    });

    expect(summary.planId).toBe('premium');
    expect(summary.planName).toBe('Premium');
    expect(summary.altaClp).toBe(120000);
    expect(summary.monthlyClp).toBe(80000);
    expect(summary.source).toBe('propuesta');
    // Los usuarios y el cupo de publicaciones sí son del plan y del perfil.
    expect(summary.listings).toBe(1000);
    expect(summary.usuariosIncluidos).toBe(5);
  });

  it('sin propuesta, los montos son los de Planes para el perfil', () => {
    const summary = altaPlanSummary({ plan: null, proposal: null, kind: 'inmobiliaria' });

    const inmobiliaria = DEFAULT_PLAN_PRICING.profiles.find((p) => p.profile === 'inmobiliaria');
    expect(summary.altaClp).toBe(inmobiliaria?.altaInicialClp);
    expect(summary.monthlyClp).toBe(inmobiliaria?.mensualBaseClp);
    expect(summary.usuariosIncluidos).toBe(inmobiliaria?.usuariosIncluidos);
    expect(summary.source).toBe('planes');
  });

  it('respeta la configuración que el equipo guardó en Planes', () => {
    const config = {
      ...DEFAULT_PLAN_PRICING,
      profiles: DEFAULT_PLAN_PRICING.profiles.map((item) =>
        item.profile === 'agente'
          ? { ...item, altaInicialClp: 990, mensualBaseClp: 1, usuariosIncluidos: 2 }
          : item
      ),
    };

    const summary = altaPlanSummary({
      plan: null,
      proposal: null,
      kind: null,
      config,
    });

    expect(summary.altaClp).toBe(990);
    expect(summary.monthlyClp).toBe(1);
    expect(summary.usuariosIncluidos).toBe(2);
  });

  it('un registro sin tipo cae en el perfil más chico, nunca en el más caro', () => {
    const summary = altaPlanSummary({ plan: null, proposal: null, kind: null });
    const profesional = DEFAULT_PLAN_PRICING.profiles.find((p) => p.profile === 'agente');

    expect(summary.altaClp).toBe(profesional?.altaInicialClp);
    expect(summary.monthlyClp).toBe(profesional?.mensualBaseClp);
  });
});
