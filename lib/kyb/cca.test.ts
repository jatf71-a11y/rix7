import { describe, it, expect } from 'vitest';

import { ccaMonthlyClp, ccaStockUf } from './cca';

/**
 * Determinación del CCA: la cuenta que el socio ve en su panel después del alta.
 *
 * Lo que importa que no se rompa: el CCA sale de las publicaciones reales (no de
 * una cifra guardada ni de una estimación) y se convierte a pesos con la fórmula
 * y el %CCA de Planes.
 */

const UF = 40_000;

describe('stock en UF', () => {
  it('suma las publicaciones y las pasa a UF con el valor del día', () => {
    // $4.000.000.000 en tres fichas, con la UF a $40.000, son UF 100.000.
    const stock = ccaStockUf([2_000_000_000, 1_500_000_000, 500_000_000], UF);

    expect(stock).toBe(100_000);
  });

  it('sin publicaciones el CCA es 0, no un error', () => {
    expect(ccaStockUf([], UF)).toBe(0);
  });

  it('ignora precios inválidos en vez de arrastrar la cuenta entera', () => {
    const stock = ccaStockUf([4_000_000_000, 0, Number.NaN, -10], UF);

    expect(stock).toBe(100_000);
  });

  it('sin UF no inventa un stock', () => {
    expect(ccaStockUf([4_000_000_000], 0)).toBe(0);
    expect(ccaStockUf([4_000_000_000], Number.NaN)).toBe(0);
  });

  it('redondea a dos decimales, que es la precisión con la que se declara', () => {
    // $1.000.000 con UF $39.999 son UF 25,00062…
    expect(ccaStockUf([1_000_000], 39_999)).toBe(25);
  });
});

describe('monto en pesos', () => {
  it('con %CCA 100 cobra la fórmula de siempre', () => {
    // UF 100.000 × $40.000 ÷ 1.000.000 = $4.000.
    expect(ccaMonthlyClp(100_000, UF, 100)).toBe(4_000);
  });

  it('con el %CCA de partida cobra el valor de la cartera: $180 millones → $180 al mes', () => {
    // 180.000.000 ÷ 40.000 = 4.500 UF; × $40.000 ÷ 1.000.000 = $180.
    const stock = ccaStockUf([180_000_000], UF);

    expect(stock).toBe(4_500);
    expect(Math.round(ccaMonthlyClp(stock, UF))).toBe(180);
  });

  it('el %CCA mueve el monto: 50 cobra la mitad y 200, el doble', () => {
    expect(ccaMonthlyClp(100_000, UF, 50)).toBe(2_000);
    expect(ccaMonthlyClp(100_000, UF, 200)).toBe(8_000);
  });

  it('sin stock no hay cobro', () => {
    expect(ccaMonthlyClp(0, UF, 100)).toBe(0);
  });
});
