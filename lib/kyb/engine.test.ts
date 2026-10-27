import { describe, it, expect } from 'vitest';
import { evaluateKyb, kybSizeBand } from './engine';
import type { NormalizedKybApplication } from './application';
import type { ReputationAdapter, ReputationSignals } from './adapters/reputation';
import { simulatedTaxRecord } from './adapters/tax';
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
        workers: 12,
        revenueClp: 612_000_000,
        revenueYear: 2025,
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
        negativeTopics: [],
        mentions: [],
        ...overrides,
      };
    },
  };
}

describe('evaluateKyb', () => {
  it('acepta con las siete verificaciones limpias y puntaje 100', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });

    expect(evaluation.decision).toBe('Aceptada');
    expect(evaluation.score).toBe(100);
    expect(evaluation.checks).toHaveLength(7);
    expect(evaluation.questions).toEqual([]);
  });

  it('los pesos de las siete verificaciones suman 100', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });

    const total = evaluation.checks.reduce((sum, check) => sum + check.weight, 0);
    expect(total).toBe(100);
  });

  it('el tramo de tamaño sale de la dotación y la facturación solo lo acompaña', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ workers: 120 }),
      reputation: reputationAdapter(),
    });

    const check = evaluation.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/120/);
    expect(check?.detail).toMatch(/mediana/i);
    expect(check?.evidence).toEqual({ source: 'simulated' });
    // El tramo se calcula por dotación (120 → mediana) y la facturación viaja
    // como referencia del registro, no como criterio.
    expect(check?.facts).toContainEqual({
      label: 'Cómo se mide el tramo',
      value: 'dotación de trabajadores (Ley 20.416)',
    });
    expect(check?.facts).toContainEqual({
      label: 'Facturación aproximada',
      value: '≈ $612 millones al año (ejercicio 2025)',
    });
    expect(check?.detail).toMatch(/facturación aproximada/i);
    // Sigue sin pedírsele: la pregunta es por dotación, no por ventas.
    expect(check?.question).toBeUndefined();
  });

  it('sin facturación en el registro se dice «sin dato» en vez de estimarla', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ revenueClp: null, revenueYear: null }),
      reputation: reputationAdapter(),
    });

    const check = evaluation.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('pass');
    expect(check?.facts).toContainEqual({
      label: 'Facturación aproximada',
      value: 'sin dato en el registro',
    });
    // Ni una cifra inventada ni una frase que diga «de sin dato»: simplemente no
    // se menciona la facturación.
    expect(check?.detail).not.toMatch(/facturaci/i);
  });

  it('las ventas simuladas son coherentes con la dotación del registro simulado', () => {
    const record = simulatedTaxRecord({ rut: '76.543.210-3', legalName: 'Catedral SpA' });

    expect(record.workers).not.toBeNull();
    expect(record.revenueClp).not.toBeNull();
    expect(record.revenueClp! % 1_000_000).toBe(0);
    expect(record.revenueYear).toBe(new Date().getUTCFullYear() - 1);

    // Entre $18M y $78M por trabajador: la referencia acompaña la escala que ya
    // informa la dotación, no la contradice.
    const porTrabajador = record.revenueClp! / (record.workers as number);
    expect(porTrabajador).toBeGreaterThanOrEqual(18_000_000);
    expect(porTrabajador).toBeLessThanOrEqual(78_000_000);
  });

  it('cada verificación llega con los datos concretos que revisó', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ negativeReviews: 4 }),
    });

    for (const check of evaluation.checks) {
      expect(check.facts?.length, check.id).toBeGreaterThan(0);
    }

    const reputationCheck = evaluation.checks.find((check) => check.id === 'reputation');
    expect(reputationCheck?.facts).toContainEqual({
      label: 'Umbral de advertencia',
      value: '3 reseñas negativas o más',
    });
    expect(
      reputationCheck?.facts?.find((fact) => fact.label === 'Qué se buscó')?.value
    ).toContain('Catedral Propiedades SpA');
  });

  it('la respuesta de la empresa queda como hecho, no solo en el relato', async () => {
    const informal: NormalizedKybApplication = {
      ...empresa,
      website: null,
      domain: null,
      email: 'ana.torres@gmail.com',
    };
    const deps = { tax: taxAdapter(), reputation: reputationAdapter() };

    const first = await evaluateKyb(informal, {}, deps);
    const clarifications = Object.fromEntries(
      first.questions.map((question) => [
        question.id,
        'El dominio corporativo es catedralpropiedades.cl y el correo es contacto@catedralpropiedades.cl.',
      ])
    );

    const second = await evaluateKyb(informal, clarifications, deps);
    const check = second.checks.find((candidate) => candidate.id === 'domain_web');
    expect(check?.status).toBe('pass');
    expect(check?.facts).toContainEqual({
      label: 'Respuesta de la empresa',
      value: 'El dominio corporativo es catedralpropiedades.cl y el correo es contacto@catedralpropiedades.cl.',
    });
  });

  it('los tramos de tamaño siguen la dotación (Ley 20.416), no las ventas', () => {
    expect(kybSizeBand(1).id).toBe('micro');
    expect(kybSizeBand(9).id).toBe('micro');
    expect(kybSizeBand(10).id).toBe('pequena');
    expect(kybSizeBand(49).id).toBe('pequena');
    expect(kybSizeBand(50).id).toBe('mediana');
    expect(kybSizeBand(199).id).toBe('mediana');
    expect(kybSizeBand(200).id).toBe('grande');
  });

  it('sin dotación en el registro advierte y pregunta, sin pedir facturación', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ workers: null }),
      reputation: reputationAdapter(),
    });

    const check = evaluation.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/no informa la dotación/);
    // Sin dotación, la facturación del registro sigue visible como referencia.
    expect(check?.detail).toMatch(/\$612 millones/);
    expect(check?.question).toMatch(/trabajadores/);
    expect(check?.question).not.toMatch(/ventas|facturaci/i);
    expect(evaluation.questions.map((question) => question.id)).toContain('company_size');
    expect(evaluation.decision).toBe('Pendiente_Informacion');
  });

  it('la advertencia de reputación dice a qué se deben las reseñas negativas', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({
        negativeReviews: 4,
        negativeTopics: ['cobros no informados', 'demoras en la entrega'],
      }),
    });

    const check = evaluation.checks.find((candidate) => candidate.id === 'reputation');
    expect(check?.status).toBe('warn');
    expect(check?.facts).toContainEqual({
      label: 'Motivo de las reseñas',
      value: 'cobros no informados · demoras en la entrega',
    });
  });

  it('una búsqueda que no discrimina el motivo lo declara en vez de rellenarlo', async () => {
    const sinDetalle = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ negativeReviews: 4, negativeTopics: [] }),
    });

    const check = sinDetalle.checks.find((candidate) => candidate.id === 'reputation');
    expect(check?.facts).toContainEqual({
      label: 'Motivo de las reseñas',
      value: 'sin detalle en la fuente consultada',
    });

    const sinResenas = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ negativeReviews: 0 }),
    });
    expect(
      sinResenas.checks.find((candidate) => candidate.id === 'reputation')?.facts
    ).toContainEqual({ label: 'Motivo de las reseñas', value: 'sin reseñas negativas' });
  });

  it('una empresa activa sin trabajadores se advierte, no se acepta en silencio', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter({ workers: 0 }),
      reputation: reputationAdapter(),
    });

    const check = evaluation.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/0 trabajadores/);
  });

  it('un registro caído deja el tamaño sin dato en vez de inventarlo', async () => {
    const tax: TaxAdapter = {
      source: 'sii',
      async verify() {
        throw new Error('La verificación fiscal respondió 502.');
      },
    };

    const evaluation = await evaluateKyb(empresa, {}, { tax, reputation: reputationAdapter() });
    const check = evaluation.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/No se pudo consultar la dotación/);
    expect(check?.evidence).toEqual({ source: 'sii' });
  });

  it('una aclaración de la empresa resuelve la advertencia de tamaño', async () => {
    const deps = { tax: taxAdapter({ workers: null }), reputation: reputationAdapter() };

    const first = await evaluateKyb(empresa, {}, deps);
    expect(first.checks.find((check) => check.id === 'company_size')?.status).toBe('warn');

    const second = await evaluateKyb(
      empresa,
      { company_size: 'Somos ocho personas en total, contando a los dos socios.' },
      deps
    );

    const check = second.checks.find((candidate) => candidate.id === 'company_size');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/ocho personas/);
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

  it('la advertencia dice de dónde salió el dato', async () => {
    const simulated = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter({ negativeReviews: 4 }),
    });
    expect(simulated.checks.find((check) => check.id === 'reputation')?.evidence).toEqual({
      source: 'simulated',
      mentions: [],
    });

    const search: ReputationAdapter = {
      source: 'search',
      async check() {
        return {
          source: 'search',
          fraudFlags: [],
          negativeReviews: 4,
          negativeTopics: [],
          mentions: [{ title: 'Reclamos en foros', url: 'https://foros.cl/reclamo' }],
        };
      },
    };

    const evaluated = await evaluateKyb(empresa, {}, { tax: taxAdapter(), reputation: search });
    expect(evaluated.checks.find((check) => check.id === 'reputation')?.evidence).toEqual({
      source: 'search',
      mentions: [{ title: 'Reclamos en foros', url: 'https://foros.cl/reclamo' }],
    });
  });

  it('la verificación fiscal señala el registro que la respondió', async () => {
    const simulated = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });
    expect(simulated.checks.find((check) => check.id === 'tax_registry')?.evidence).toEqual({
      source: 'simulated',
    });

    const sii: TaxAdapter = {
      source: 'sii',
      async verify() {
        return {
          source: 'sii',
          exists: true,
          active: true,
          businessName: 'Catedral Propiedades SpA',
          activity: 'Servicios inmobiliarios',
          workers: 12,
          revenueClp: 612_000_000,
          revenueYear: 2025,
          nameMatches: true,
        };
      },
    };

    const evaluated = await evaluateKyb(empresa, {}, { tax: sii, reputation: reputationAdapter() });
    expect(evaluated.checks.find((check) => check.id === 'tax_registry')?.evidence).toEqual({
      source: 'sii',
    });
  });

  it('las verificaciones que solo releen la solicitud lo declaran', async () => {
    const evaluation = await evaluateKyb(empresa, {}, {
      tax: taxAdapter(),
      reputation: reputationAdapter(),
    });

    for (const id of ['tax_rut', 'domain_web', 'email_corporate', 'email_domain_match']) {
      expect(evaluation.checks.find((check) => check.id === id)?.evidence?.source, id).toBe(
        'declared'
      );
    }
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
