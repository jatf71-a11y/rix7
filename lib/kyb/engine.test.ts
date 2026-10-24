import { describe, it, expect } from 'vitest';
import { evaluateKyb } from './engine';
import type { NormalizedKybApplication } from './application';
import type { ReputationAdapter, ReputationSignals } from './adapters/reputation';
import type { TaxAdapter, TaxVerification } from './adapters/tax';

const empresa: NormalizedKybApplication = {
  legalName: 'Catedral Propiedades SpA',
  rut: '76.543.210-3',
  website: 'https://catedralpropiedades.cl',
  domain: 'catedralpropiedades.cl',
  email: 'contacto@catedralpropiedades.cl',
  contactName: 'Ana Torres',
  phone: '+56 9 8765 4321',
  consent: true,
  coverage: null,
  regions: [],
  message: null,
  registrationKind: null,
  contactRole: null,
};

function taxAdapter(overrides: Partial<TaxVerification> = {}): TaxAdapter {
  return {
    source: 'simulated',
    async verify() {
      return {
        source: 'simulated',
        exists: true,
        active: true,
        businessName: 'Catedral Propiedades SpA',
        activity: 'Servicios inmobiliarios',
        nameMatches: true,
        ...overrides,
      };
    },
  };
}

function reputationAdapter(overrides: Partial<ReputationSignals> = {}): ReputationAdapter {
  return {
    source: 'simulated',
    async check() {
      return {
        source: 'simulated',
        fraudFlags: [],
        negativeReviews: 0,
        mentions: [],
        ...overrides,
      };
    },
  };
}

describe('evaluateKyb', () => {
  it('acepta con las seis verificaciones limpias y puntaje 100', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });

    expect(evaluation.decision).toBe('Aceptada');
    expect(evaluation.score).toBe(100);
    expect(evaluation.checks).toHaveLength(6);
    expect(evaluation.questions).toEqual([]);
  });

  it('pide información cuando el RUT no figura en el registro', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ exists: false, active: false, businessName: null, nameMatches: false }),
      reputation: reputationAdapter(),
    });

    expect(evaluation.decision).toBe('Pendiente_Informacion');
    expect(evaluation.questions.map((question) => question.id)).toContain('tax_registry');
    expect(evaluation.score).toBeLessThan(100);
  });

  it('pide información cuando la razón social no coincide', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ businessName: 'Otra Empresa SpA', nameMatches: false }),
      reputation: reputationAdapter(),
    });

    expect(evaluation.decision).toBe('Pendiente_Informacion');
    expect(evaluation.checks.find((check) => check.id === 'tax_registry')?.status).toBe('fail');
  });

  it('un proveedor fiscal caído no se disfraza de rechazo: queda como fallo con pregunta', async () => {
    const tax: TaxAdapter = {
      source: 'sii',
      async verify() {
        throw new Error('La verificación fiscal respondió 502.');
      },
    };

    const evaluation = await evaluateKyb(empresa, {}, { tax, reputation: reputationAdapter() });

    const check = evaluation.checks.find((candidate) => candidate.id === 'tax_registry');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatch(/No se pudo consultar/);
    expect(evaluation.decision).toBe('Pendiente_Informacion');
  });

  it('detecta señales de fraude en la reputación', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ fraudFlags: ['Denuncia por fraude'] }),
    });

    expect(evaluation.decision).toBe('Pendiente_Informacion');
    expect(evaluation.questions.map((question) => question.id)).toContain('reputation');
  });

  it('advierte por reseñas negativas sin bloquear por sí solo el puntaje', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ negativeReviews: 4 }),
    });

    const reputation = evaluation.checks.find((check) => check.id === 'reputation');
    expect(reputation?.status).toBe('warn');
    expect(evaluation.decision).toBe('Pendiente_Informacion');
  });

  it('un correo personal y sin sitio deja preguntas; las respuestas las resuelven', async () => {
    const informal: NormalizedKybApplication = {
      ...empresa,
      legalName: 'Torres Propiedades SpA',
      website: null,
      domain: null,
      email: 'ana.torres@gmail.com',
    };

    const deps = { tax: taxAdapter(), reputation: reputationAdapter() };

    const first = await evaluateKyb(informal, {}, deps);
    expect(first.decision).toBe('Pendiente_Informacion');
    expect(first.questions.map((question) => question.id).sort()).toEqual([
      'domain_web',
      'email_corporate',
      'email_domain_match',
    ]);
    expect(first.score).toBeGreaterThan(75);

    const clarifications = Object.fromEntries(
      first.questions.map((question) => [
        question.id,
        'El dominio corporativo es torrespropiedades.cl y el correo de contacto es contacto@torrespropiedades.cl.',
      ])
    );

    const second = await evaluateKyb(informal, clarifications, deps);
    expect(second.decision).toBe('Aceptada');
    expect(second.questions).toEqual([]);
  });

  it('una aclaración no arregla la verificación fiscal', async () => {
    const evaluation = await evaluateKyb(
      empresa,
      { tax_registry: 'Confirmo el RUT y la razón social de la empresa.' },
      {
        tax: taxAdapter({ exists: false, active: false, nameMatches: false, businessName: null }),
        reputation: reputationAdapter(),
      }
    );

    expect(evaluation.checks.find((check) => check.id === 'tax_registry')?.status).toBe('fail');
    expect(evaluation.decision).toBe('Pendiente_Informacion');
  });

  it('marca el sitio con alojamiento gratuito como advertencia', async () => {
    const gratuito: NormalizedKybApplication = {
      ...empresa,
      website: 'https://catedral.wixsite.com/inicio',
      domain: 'catedral.wixsite.com',
    };

    const evaluation = await evaluateKyb(gratuito, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });

    expect(evaluation.checks.find((check) => check.id === 'domain_web')?.status).toBe('warn');
  });
});
