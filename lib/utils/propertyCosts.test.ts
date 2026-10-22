/**
 * @vitest-environment node
 *
 * Los costos de la ficha no dependen de la operación: una propiedad en venta
 * con contribuciones informadas tiene que mostrarlas igual que una en arriendo.
 * Ese es el caso que este test fija, porque es el que se rompe si alguien
 * envuelve el bloque en un `if (isRent)`.
 */
import { describe, expect, it } from 'vitest';
import { propertyCosts } from './propertyCosts';

describe('propertyCosts', () => {
  it('muestra las contribuciones en una propiedad en venta', () => {
    expect(propertyCosts({ property_taxes: 310000 })).toEqual([
      { label: 'Contribuciones', amount: 310000, suffix: '/ año' },
    ]);
  });

  it('en arriendo muestra los tres datos, cada uno con su período', () => {
    expect(
      propertyCosts({ common_expenses: 85000, property_taxes: 310000, deposit: 850000 })
    ).toEqual([
      { label: 'Gastos comunes', amount: 85000, suffix: '/ mes' },
      { label: 'Contribuciones', amount: 310000, suffix: '/ año' },
      { label: 'Garantía', amount: 850000 },
    ]);
  });

  it('un monto ausente o en cero es «no informado» y no se lista', () => {
    expect(propertyCosts({})).toEqual([]);
    expect(propertyCosts({ common_expenses: 0, property_taxes: 0, deposit: 0 })).toEqual([]);
    expect(propertyCosts({ property_taxes: null })).toEqual([]);
  });
});
