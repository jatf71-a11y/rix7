import { describe, expect, it } from 'vitest';

import { buildCcaChangeEmail } from './ccaEmails';

/**
 * El correo del CCA es el aviso de un cobro mensual variable: tiene que decir el
 * monto, de dónde sale y cuánto era antes. Un correo que solo diga «tu CCA
 * cambió» obliga al socio a creer o a llamar.
 */
const base = {
  partnerName: 'Catedral Propiedades SpA',
  stockClp: 2_215_330_000,
  ccaUf: 53_673.48,
  ufClp: 41_274.2,
  ccaPct: 100,
  siteUrl: 'https://rix7.cl',
};

describe('buildCcaChangeEmail', () => {
  it('muestra el monto nuevo, el anterior y la cuenta completa', () => {
    const email = buildCcaChangeEmail({
      ...base,
      amountClp: 2_215,
      previousAmountClp: 1_800,
    });

    expect(email.subject).toBe('Tu CCA mensual cambió: $2.215');
    expect(email.text).toContain('$2.215');
    expect(email.text).toContain('$1.800');
    expect(email.text).toContain('53.673,48 UF');
    expect(email.text).toContain('100%');
    expect(email.text).toContain('$2.215.330.000');
    // La fórmula va escrita: el monto no es un capricho.
    expect(email.text).toContain('CCA × valor de la UF ÷ 1.000.000 × %CCA');
    // Y se dice explícitamente que el correo no cobra nada.
    expect(email.text).toMatch(/No hay ningún cobro en este correo/);
    expect(email.html).toContain('$2.215');
    expect(email.html).toContain('Antes: $1.800');
  });

  it('el primer monto se presenta como el inicio de la cuenta, sin «antes»', () => {
    const email = buildCcaChangeEmail({
      ...base,
      amountClp: 2_215,
      previousAmountClp: null,
    });

    expect(email.subject).toBe('Tu CCA mensual en Rix7: $2.215');
    expect(email.text).toContain('Este es el primer monto de tu cuenta');
    expect(email.html).not.toContain('Antes:');
  });

  it('distingue cuando el monto baja', () => {
    const email = buildCcaChangeEmail({
      ...base,
      amountClp: 900,
      previousAmountClp: 2_215,
    });

    expect(email.text).toContain('bajó');
    expect(email.html).toContain('#047857');
  });

  it('escapa el nombre de la empresa en el HTML', () => {
    const email = buildCcaChangeEmail({
      ...base,
      partnerName: '<script>alert(1)</script>',
      amountClp: 0,
      previousAmountClp: null,
    });

    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
