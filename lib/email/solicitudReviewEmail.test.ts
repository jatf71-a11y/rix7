import { describe, it, expect } from 'vitest';

import { buildSolicitudReviewEmail } from './solicitudApplicantEmail';

/**
 * El correo de revisión manual.
 *
 * No lleva enlace: el registro se frenó por el informe de deudas de la CMF y no
 * hay nada que la persona pueda responder. Lo que sí tiene que decir es el
 * motivo y quién decide, para que no se quede esperando un formulario que no
 * existe.
 */

const email = buildSolicitudReviewEmail({
  name: 'Camila Rojas',
  offerLabel: 'tu registro de Corredora',
  reason: 'Riesgo de crédito: la deuda impaga ($27.042.540) supera el máximo de $5.000.000.',
  siteUrl: 'https://rix7.cl',
});

describe('buildSolicitudReviewEmail', () => {
  it('dice que quedó en revisión y con qué motivo', () => {
    expect(email.subject).toMatch(/revisión/i);
    expect(email.text).toContain('Camila');
    expect(email.text).toMatch(/revisión del equipo/i);
    expect(email.text).toContain('27.042.540');
    expect(email.html).toContain('27.042.540');
  });

  it('no manda a un formulario ni pide nada', () => {
    expect(email.text).not.toContain('/socios/responder/');
    expect(email.html).not.toContain('/socios/responder/');
    expect(email.text).toMatch(/no tienes que hacer nada/i);
  });

  it('mantiene el marcador de etapa en el punto donde se detuvo', () => {
    expect(email.text).toContain('Etapa 3 de 7');
    expect(email.text).toContain('Pendiente de información');
  });

  it('escapa el motivo y el nombre: no inyecta HTML', () => {
    const raro = buildSolicitudReviewEmail({
      name: '<Ana>',
      offerLabel: 'tu registro',
      reason: '<script>alert(1)</script>',
      siteUrl: 'https://rix7.cl',
    });

    expect(raro.html).not.toContain('<script>alert(1)</script>');
    expect(raro.html).toContain('&lt;script&gt;');
    expect(raro.html).toContain('&lt;Ana&gt;');
  });
});
