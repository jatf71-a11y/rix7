import { describe, expect, it } from 'vitest';

import { ccaSnapshot } from './ccaLedger';

/**
 * La cuenta del CCA es la que respalda cada factura: si estos números cambian,
 * cambia lo que se le cobra al socio. Por eso se prueba acá, sobre la función
 * pura, y no a través de la base.
 */
describe('ccaSnapshot', () => {
  it('sin cartera el CCA es 0 y el monto también', () => {
    const snapshot = ccaSnapshot([], 41_274.2, 100);

    expect(snapshot.stockClp).toBe(0);
    expect(snapshot.ccaUf).toBe(0);
    expect(snapshot.amountClp).toBe(0);
  });

  it('convierte la cartera a UF y aplica el %CCA', () => {
    // El caso del panel: $2.215.330.000 de cartera con la UF en $41.274,2.
    const snapshot = ccaSnapshot([2_215_330_000], 41_274.2, 100);

    expect(snapshot.stockClp).toBe(2_215_330_000);
    expect(snapshot.ccaUf).toBe(53_673.48);
    // 53.673,48 UF × 41.274,2 ÷ 1.000.000 = 2.215,33 → se factura 2.215.
    expect(snapshot.amountClp).toBe(2_215);
  });

  it('suma varias propiedades: el CCA es de la cartera, no de una ficha', () => {
    const snapshot = ccaSnapshot([100_000_000, 50_000_000, 25_000_000], 40_000, 100);

    expect(snapshot.stockClp).toBe(175_000_000);
    expect(snapshot.ccaUf).toBe(4_375);
    // 4.375 UF × $40.000 ÷ 1.000.000 = $175 con %CCA 100.
    expect(snapshot.amountClp).toBe(175);
  });

  it('el %CCA escala el monto de forma proporcional', () => {
    const full = ccaSnapshot([100_000_000], 40_000, 100);
    const half = ccaSnapshot([100_000_000], 40_000, 50);

    expect(half.amountClp).toBe(Math.round(full.amountClp / 2));
    // El CCA en UF no cambia: el porcentaje es del precio, no del volumen.
    expect(half.ccaUf).toBe(full.ccaUf);
  });

  it('una ficha sin precio válido no resta ni rompe la cuenta', () => {
    const conBasura = ccaSnapshot([100_000_000, Number.NaN, -5, 0], 40_000, 100);
    const limpio = ccaSnapshot([100_000_000], 40_000, 100);

    expect(conBasura.stockClp).toBe(limpio.stockClp);
    expect(conBasura.amountClp).toBe(limpio.amountClp);
  });

  it('sin UF no inventa un monto', () => {
    const snapshot = ccaSnapshot([100_000_000], 0, 100);

    expect(snapshot.ccaUf).toBe(0);
    expect(snapshot.amountClp).toBe(0);
  });
});
