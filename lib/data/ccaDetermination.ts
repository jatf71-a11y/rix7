import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { readPlanPricing } from './planPricingStore';

/**
 * La determinación del CCA de un socio: cuánto suman sus publicaciones y con qué
 * `%CCA` se cobra.
 *
 * No hay nada que guardar acá. El CCA es una consecuencia del tamaño de la
 * cartera del socio y del `%CCA` que el equipo fija en **Planes**, así que se
 * deriva en cada lectura: una cifra guardada quedaría vieja en cuanto cargue otra
 * propiedad, y se cobraría como si fuera la de hoy.
 *
 * La suma es sobre **todas sus propiedades**, sin mirar el estado: el CCA no mide
 * cuántas fichas están hoy en la vidriera —no se cobra por publicación—, sino el
 * volumen de cartera que el socio maneja. Por eso tampoco se filtra por
 * `for_sale`/`for_rent`: una propiedad vendida o arrendada sigue siendo parte de
 * ese volumen.
 *
 * La consulta va con la clave de servicio porque el panel necesita la cartera
 * completa del socio, incluidas las fichas que no están en la vidriera pública.
 * El `partnerId` lo resuelve la ruta desde la sesión: el cliente nunca elige de
 * quién es el CCA.
 */

export interface CcaDetermination {
  /** Suma de las propiedades del socio, en pesos. */
  stockClp: number;
  /** %CCA vigente en **Planes**. */
  ccaPct: number;
  /** false = no hay Supabase configurado y esto es una respuesta de relleno. */
  persistent: boolean;
  warning?: string;
}

interface PropertyRow {
  price: number | string | null;
}

interface PartnerPriceRow extends PropertyRow {
  partner_id: string | null;
}

/** La cartera de cada socio, en pesos, más el `%CCA` vigente. */
export interface CcaStockSummary {
  /** Id del socio → suma de su cartera en pesos. Los socios sin fichas van en 0. */
  stocks: Record<string, number>;
  /** %CCA vigente en **Planes**. */
  ccaPct: number;
  /** false = no hay Supabase configurado y los montos son de relleno. */
  persistent: boolean;
  warning?: string;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function readCcaDetermination(partnerId: string): Promise<CcaDetermination> {
  const pricing = await readPlanPricing();

  if (!isServiceRoleConfigured()) {
    return {
      stockClp: 0,
      ccaPct: pricing.config.ccaPct,
      persistent: false,
      warning: 'Supabase no está configurado: el CCA no se puede calcular.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('properties')
      .select('price')
      .eq('partner_id', partnerId)
      .limit(2000);

    const prices = ((data ?? []) as PropertyRow[]).map((row) => toNumber(row.price));

    return {
      // Mismo criterio que la cuenta corriente (`ccaLedger.ccaSnapshot`): una
      // ficha sin precio no resta. Si acá se sumara el negativo, el panel
      // mostraría un monto distinto del que se factura.
      stockClp: prices.reduce((sum, price) => (price > 0 ? sum + price : sum), 0),
      ccaPct: pricing.config.ccaPct,
      persistent: true,
      ...(error ? { warning: `No se pudo leer tu cartera (${error.message}).` } : {}),
    };
  } catch (error) {
    return {
      stockClp: 0,
      ccaPct: pricing.config.ccaPct,
      persistent: false,
      warning: `No se pudo calcular el CCA (${
        error instanceof Error ? error.message : 'error desconocido'
      }).`,
    };
  }
}

/**
 * Suma la cartera de **varios** socios en una sola consulta.
 *
 * Es la versión de lectura para el panel del equipo, donde el CCA se muestra en
 * la ficha de cada socio: pedirlo socio por socio sería una consulta por tarjeta
 * y una pantalla que tarda en abrir con el listado completo.
 *
 * Cada id pedido aparece en el resultado, con 0 si todavía no tiene fichas: la
 * ficha muestra «$0» —su cartera está vacía— en vez de un hueco que parezca un
 * dato que no se pudo leer.
 */
export async function readCcaStocks(partnerIds: string[]): Promise<CcaStockSummary> {
  const pricing = await readPlanPricing();
  const unique = Array.from(new Set(partnerIds.filter((id) => id.trim().length > 0)));

  const empty: Record<string, number> = {};
  for (const id of unique) empty[id] = 0;

  if (unique.length === 0) {
    return { stocks: empty, ccaPct: pricing.config.ccaPct, persistent: true };
  }

  if (!isServiceRoleConfigured()) {
    return {
      stocks: empty,
      ccaPct: pricing.config.ccaPct,
      persistent: false,
      warning: 'Supabase no está configurado: el CCA no se puede calcular.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('properties')
      .select('partner_id, price')
      .in('partner_id', unique)
      .limit(20000);

    const stocks = { ...empty };
    for (const row of (data ?? []) as PartnerPriceRow[]) {
      if (!row.partner_id) continue;
      const price = toNumber(row.price);
      if (price > 0) stocks[row.partner_id] = (stocks[row.partner_id] ?? 0) + price;
    }

    return {
      stocks,
      ccaPct: pricing.config.ccaPct,
      persistent: true,
      ...(error ? { warning: `No se pudo leer la cartera (${error.message}).` } : {}),
    };
  } catch (error) {
    return {
      stocks: empty,
      ccaPct: pricing.config.ccaPct,
      persistent: false,
      warning: `No se pudo calcular el CCA (${
        error instanceof Error ? error.message : 'error desconocido'
      }).`,
    };
  }
}
