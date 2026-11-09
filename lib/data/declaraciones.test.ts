import { describe, expect, it } from 'vitest';

import { evaluateSolicitud } from './solicitudEvaluation';
import { normalizeSolicitud } from './solicitudes';

/**
 * En una corredora o inmobiliaria estos datos son obligatorios; en un
 * profesional independiente son opcionales. Pero «no lo llené» y «no lo tengo»
 * no son lo mismo: la declaración entra en la evaluación y baja el puntaje sin
 * bloquear, porque un profesional sin sitio ni correo corporativo es un perfil
 * más básico, no un registro incompleto.
 */
function agente(payload: Record<string, unknown> = {}) {
  return {
    id: 'sol-agente-1',
    kind: 'agente' as const,
    name: 'Ana Pérez',
    email: 'ana@gmail.com',
    phone: '+56 9 8765 4321',
    company: null,
    message: null,
    payload: {
      rut: '12.345.678-5',
      role: '',
      coverage: 'nacional',
      regions: [],
      website: '',
      ...payload,
    },
    status: 'Recibida' as const,
    createdAt: '2026-11-06T00:00:00.000Z',
  };
}

describe('normalizeSolicitud · declaraciones del profesional', () => {
  it('acepta «no tengo sitio» sin exigir una dirección', () => {
    const result = normalizeSolicitud({
      kind: 'agente',
      name: 'Ana Pérez',
      email: 'ana@gmail.com',
      phone: '+56 9 8765 4321',
      consent: true,
      rut: '12.345.678-5',
      coverage: 'nacional',
      hasWebsite: false,
      hasCompanyEmail: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solicitud.payload.hasWebsite).toBe(false);
    expect(result.solicitud.payload.hasCompanyEmail).toBe(false);
  });

  it('no guarda una declaración que nadie hizo', () => {
    const result = normalizeSolicitud({
      kind: 'agente',
      name: 'Ana Pérez',
      email: 'ana@gmail.com',
      phone: '+56 9 8765 4321',
      consent: true,
      rut: '12.345.678-5',
      coverage: 'nacional',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('hasWebsite' in result.solicitud.payload).toBe(false);
  });

  it('rechaza negar el sitio y mandar una dirección a la vez', () => {
    const result = normalizeSolicitud({
      kind: 'agente',
      name: 'Ana Pérez',
      email: 'ana@gmail.com',
      phone: '+56 9 8765 4321',
      consent: true,
      rut: '12.345.678-5',
      coverage: 'nacional',
      website: 'https://anaperez.cl',
      hasWebsite: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe('evaluateSolicitud · declaraciones del profesional', () => {
  it('evalúa el perfil básico sin volver a preguntar', () => {
    const evaluation = evaluateSolicitud(
      agente({ hasWebsite: false, hasCompanyEmail: false })
    );

    const sitio = evaluation.checks.find((check) => check.id === 'sitio');
    const correo = evaluation.checks.find((check) => check.id === 'correo');

    expect(sitio?.status).toBe('warn');
    expect(sitio?.question).toBeUndefined();
    expect(sitio?.detail).toContain('Declaraste no tener sitio web');
    // La ausencia declarada pesa: no es un «sin dato», es parte del perfil.
    expect(sitio?.weight).toBeGreaterThan(0);

    expect(correo?.status).toBe('warn');
    expect(correo?.question).toBeUndefined();
    expect(correo?.detail).toContain('Declaraste que el correo es personal');
  });

  it('sin declaración no inventa una respuesta que el profesional no dio', () => {
    const evaluation = evaluateSolicitud(agente());

    const sitio = evaluation.checks.find((check) => check.id === 'sitio');
    expect(sitio?.detail).toContain('No declaró sitio web');
    expect(sitio?.detail).not.toContain('Declaraste');
  });

  it('declarar la ausencia puntúa más bajo que no responder', () => {
    const sinResponder = evaluateSolicitud(agente());
    const declarado = evaluateSolicitud(agente({ hasWebsite: false, hasCompanyEmail: false }));

    expect(sinResponder.decision).toBe('Aceptada');
    expect(declarado.decision).toBe('Aceptada');
    expect(declarado.score).toBeLessThan(sinResponder.score);
  });

  it('un correo personal declarado pesa aunque el dominio sea propio', () => {
    const evaluation = evaluateSolicitud({
      ...agente({ hasCompanyEmail: false }),
      email: 'ana@perez.cl',
    });

    const correo = evaluation.checks.find((check) => check.id === 'correo');
    expect(correo?.status).toBe('warn');
    expect(correo?.detail).toContain('aunque el dominio es propio');
    expect(correo?.question).toBeUndefined();
  });
});
