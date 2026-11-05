/**
 * El CCA: la suma de las propiedades de un socio, en UF.
 *
 * **No es un producto que se contrate, ni un servicio que se active, ni un cobro
 * por publicación**: es una determinación que se resuelve **después del alta**,
 * ligada al volumen de cartera que el socio maneja —cuántas publicaciones va a
 * hacer— y no a cuántas fichas están hoy en la vidriera. Antes se firmaba en la
 * propuesta comercial con una estimación en UF de propiedades que el candidato
 * todavía no había cargado; el número era una promesa. Ahora sale de su cartera,
 * y por eso cambia solo cada vez que suma una propiedad.
 *
 * La fórmula es la que definió el equipo (`planPricing`):
 *
 *   $CCA = CCA × valor de la UF ÷ 1.000.000 × %CCA
 *
 * El `%CCA` lo fija **Planes** y el monto se factura junto a la mensualidad. El
 * módulo es puro: recibe los precios y la UF ya resueltos y devuelve la cuenta,
 * para que el panel, la facturación y los tests digan exactamente lo mismo.
 */

import { DEFAULT_CCA_PCT, ccaAmountClp } from './planPricing';

/**
 * CCA del socio, en UF: la suma de su cartera dividida por la UF del día.
 *
 * Los precios se guardan en pesos —así vienen de `properties`— y el CCA se
 * expresa en UF porque es la unidad con la que se define el concepto. Un precio
 * inválido se ignora: una ficha con el monto en cero no puede restarle CCA a las
 * demás.
 */
export function ccaStockUf(pricesClp: number[], ufValueClp: number): number {
  if (!Number.isFinite(ufValueClp) || ufValueClp <= 0) return 0;

  const total = pricesClp.reduce(
    (sum, price) => (Number.isFinite(price) && price > 0 ? sum + price : sum),
    0
  );

  // Dos decimales: es la precisión con la que se declara el CCA y la que se
  // muestra en el panel. El monto en pesos no se redondea acá.
  return Math.round((total / ufValueClp) * 100) / 100;
}

/** Lo que el CCA representa en pesos con el `%CCA` vigente. */
export function ccaMonthlyClp(
  stockUf: number,
  ufValueClp: number,
  ccaPct: number = DEFAULT_CCA_PCT
): number {
  return ccaAmountClp(stockUf, ufValueClp, ccaPct);
}
