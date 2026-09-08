export type Currency = 'CLP' | 'UF' | 'USD';

// Tasas oficiales por defecto (se actualizan dinámicamente desde el Banco Central de Chile)
export const DEFAULT_UF_RATE = 39500;
export const DEFAULT_USD_RATE = 950;

/**
 * Convierte un monto base en CLP a la moneda objetivo usando las tasas oficiales
 */
export function convertPrice(
  amountInClp: number,
  targetCurrency: Currency,
  ufRate: number = DEFAULT_UF_RATE,
  usdRate: number = DEFAULT_USD_RATE
): number {
  if (targetCurrency === 'UF') {
    return amountInClp / (ufRate || DEFAULT_UF_RATE);
  }
  if (targetCurrency === 'USD') {
    return amountInClp / (usdRate || DEFAULT_USD_RATE);
  }
  return amountInClp;
}

/**
 * Formatea un número según la moneda seleccionada (CLP '$', UF 'UF', USD 'US$')
 * con el tipo de cambio oficial del Banco Central de Chile
 */
export function formatPrice(
  amountInClp: number,
  currency: Currency = 'CLP',
  locale: string = 'es-CL',
  isRent: boolean = false,
  ufRate: number = DEFAULT_UF_RATE,
  usdRate: number = DEFAULT_USD_RATE
): string {
  if (isNaN(amountInClp)) return '$ 0';

  if (currency === 'UF') {
    const rate = ufRate || DEFAULT_UF_RATE;
    const ufValue = amountInClp / rate;
    // Si es arriendo mensual (valores menores a 100 UF), mostrar 1 decimal (ej: UF 22,5)
    const formatted = ufValue < 100
      ? `UF ${ufValue.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
      : `UF ${Math.round(ufValue).toLocaleString('es-CL')}`;
    return isRent ? `${formatted} /mes` : formatted;
  }

  if (currency === 'USD') {
    const rate = usdRate || DEFAULT_USD_RATE;
    const usdValue = amountInClp / rate;
    const formatted = `US$ ${Math.round(usdValue).toLocaleString('en-US')}`;
    return isRent ? `${formatted} /mes` : formatted;
  }

  // Pesos Chilenos (CLP '$')
  const formatted = `$ ${Math.round(amountInClp).toLocaleString('es-CL')}`;
  return isRent ? `${formatted} /mes` : formatted;
}

/**
 * Formatea la superficie en metros cuadrados (m²) o hectáreas si es parcela/terreno grande
 */
export function formatArea(sqm: number): string {
  if (isNaN(sqm)) return '0 m²';
  if (sqm >= 10000) {
    const ha = (sqm / 10000).toFixed(1);
    return `${ha} ha (${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(sqm)} m²)`;
  }
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(sqm)} m²`;
}

/**
 * Formatea un número simple con separadores de miles
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('es-CL').format(num);
}

/**
 * Etiqueta legible para el tipo de propiedad en Rix7
 */
export function getPropertyTypeLabel(type: string): string {
  const types: Record<string, string> = {
    all: 'Todos los tipos',
    apartment: 'Departamentos',
    house: 'Casas',
    premium: 'Premium',
    penthouse: 'Premium',
    parcel: 'Parcelas',
    office: 'Oficinas',
    land: 'Terrenos',
    parking: 'Estacionamientos',
    local: 'Locales',
    warehouse: 'Bodegas',
  };
  return types[type] || type;
}

/**
 * Etiqueta legible para el estado de operación (Venta / Arriendo)
 */
export function getStatusLabel(status: string): string {
  const statuses: Record<string, string> = {
    for_sale: 'En Venta',
    for_rent: 'En Arriendo',
    sold: 'Vendido',
  };
  return statuses[status] || status;
}
