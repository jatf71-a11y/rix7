import type { Property } from '@/lib/types/property';

/** Una línea de costo de la ficha, ya lista para formatear en moneda. */
export interface PropertyCost {
  label: string;
  amount: number;
  /** Período del monto, cuando corresponde («/ mes», «/ año»). */
  suffix?: string;
}

/**
 * Costos que la ficha publica: gastos comunes, contribuciones y garantía.
 *
 * **No mira la operación** a propósito. Las contribuciones se pagan en venta y
 * en arriendo, y una casa en venta tiene gastos comunes si está en un
 * condominio: esconder las líneas según `status` obligaría a decidir de nuevo
 * qué dato aplica a cada caso. Lo que define si una línea aparece es que la
 * corredora haya informado un monto, no el estado de la propiedad.
 *
 * Un `0` —o un valor ausente— significa «no informado» y no se muestra: enseñar
 * «Contribuciones $0» en una ficha sería una afirmación falsa, no un dato.
 */
export function propertyCosts(
  property: Pick<Property, 'common_expenses' | 'property_taxes' | 'deposit'>
): PropertyCost[] {
  const costs: PropertyCost[] = [];

  if (property.common_expenses) {
    costs.push({ label: 'Gastos comunes', amount: property.common_expenses, suffix: '/ mes' });
  }
  if (property.property_taxes) {
    costs.push({ label: 'Contribuciones', amount: property.property_taxes, suffix: '/ año' });
  }
  if (property.deposit) {
    costs.push({ label: 'Garantía', amount: property.deposit });
  }

  return costs;
}
