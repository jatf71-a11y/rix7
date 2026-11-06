import { buildCcaChangeEmail } from '@/lib/email/ccaEmails';
import { sendEmail } from '@/lib/email/sendEmail';
import { ccaMonthlyClp, ccaStockUf } from '@/lib/kyb/cca';
import { SITE_URL } from '@/lib/site';
import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { readPlanPricing } from './planPricingStore';

/**
 * Cuenta corriente del CCA por socio.
 *
 * El CCA **no es un precio fijo**: es la suma de la cartera del socio, en UF, y
 * por eso cambia cada vez que publica, edita o borra una propiedad —y también
 * cuando el equipo mueve el `%CCA` en **Planes**—. Como se factura junto a la
 * mensualidad, alguien tiene que poder decir cuánto va a pagar este mes y por
 * qué. Eso es esta cuenta corriente.
 *
 * Cada movimiento guarda la cuenta completa (cartera, UF del día, `%CCA` y
 * monto) y el monto anterior. No se guarda «el CCA actual»: se deriva de la
 * cartera y del `%CCA` vigente, y una cifra única quedaría vieja en cuanto el
 * socio cargue otra propiedad. El historial, en cambio, no se puede recalcular
 * con datos de hoy: la UF y el `%CCA` de ayer tienen que quedar como estaban.
 *
 * Un cambio de monto dispara **un correo al socio**. Sin monto nuevo no hay
 * correo: editar el título de una ficha no mueve la cuenta.
 */

/** Por qué se movió la cuenta. */
export type CcaReason = 'alta' | 'cartera' | 'planes';

/** Una línea de la cuenta corriente. */
export interface CcaMovement {
  id: string;
  /** Lo que se factura ese mes por CCA, en pesos. */
  amountClp: number;
  /** Monto del movimiento anterior; `null` en la línea base del alta. */
  previousAmountClp: number | null;
  stockClp: number;
  ccaUf: number;
  ufClp: number;
  ccaPct: number;
  reason: CcaReason;
  createdAt: string;
}

/** La cuenta del momento: lo que el panel muestra como cartera y monto. */
export interface CcaSnapshot {
  stockClp: number;
  ccaUf: number;
  ufClp: number;
  ccaPct: number;
  amountClp: number;
}

export interface CcaSyncResult {
  ok: boolean;
  /** true = el monto cambió y quedó un movimiento nuevo. */
  changed: boolean;
  amountClp: number;
  previousAmountClp: number | null;
  emailed: boolean;
  error?: string;
}

interface CcaMovementRow {
  id: string;
  amount_clp: number | string;
  previous_amount_clp: number | string | null;
  stock_clp: number | string;
  cca_uf: number | string;
  uf_clp: number | string;
  cca_pct: number | string;
  reason: string;
  created_at: string;
}

interface PartnerRow {
  id: string;
  name: string;
  contact_email: string | null;
}

interface PriceRow {
  price: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * La cuenta del CCA para una cartera y una UF dadas.
 *
 * Es pura a propósito: la usan el panel, el registro de movimientos y los
 * tests, y así los tres dicen exactamente lo mismo. El monto se redondea a
 * pesos porque es lo que se factura.
 */
export function ccaSnapshot(pricesClp: number[], ufClp: number, ccaPct: number): CcaSnapshot {
  // Un precio vacío, en cero o negativo es un dato que falta, no cartera
  // negativa: incluirlo restaría CCA a las demás fichas.
  const stockClp = pricesClp.reduce((sum, price) => {
    const value = toNumber(price);
    return value > 0 ? sum + value : sum;
  }, 0);
  const ccaUf = ccaStockUf([stockClp], ufClp);
  return {
    stockClp,
    ccaUf,
    ufClp,
    ccaPct,
    amountClp: Math.round(ccaMonthlyClp(ccaUf, ufClp, ccaPct)),
  };
}

/**
 * Valor de la UF del día, del mismo origen que `/api/indicators`.
 *
 * Devuelve `null` si no se puede leer: sin UF no hay cuenta que registrar, y
 * preferimos no escribir un movimiento inventado (ni mandar un correo con un
 * monto que no es). El próximo cambio lo registrará.
 */
export async function readUfClp(): Promise<number | null> {
  try {
    const response = await fetch('https://mindicador.cl/api', {
      next: { revalidate: 3600 },
      headers: { 'User-Agent': 'Rix7-Portal-Inmobiliario/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { uf?: { valor?: unknown } };
    const value = toNumber(body.uf?.valor as number | string | undefined);
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function partnerEmail(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partnerId: string
): Promise<PartnerRow | null> {
  const { data } = await supabase
    .from('partners')
    .select('id, name, contact_email')
    .eq('id', partnerId)
    .maybeSingle();
  return (data as PartnerRow | null) ?? null;
}

async function stockPrices(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partnerId: string
): Promise<number[]> {
  const { data } = await supabase
    .from('properties')
    .select('price')
    .eq('partner_id', partnerId)
    .limit(2000);
  return ((data ?? []) as PriceRow[]).map((row) => toNumber(row.price));
}

async function latestMovement(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partnerId: string
): Promise<CcaMovement | null> {
  const { data } = await supabase
    .from('partner_cca_ledger')
    .select('id, amount_clp, previous_amount_clp, stock_clp, cca_uf, uf_clp, cca_pct, reason, created_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? movementFromRow(data as CcaMovementRow) : null;
}

function movementFromRow(row: CcaMovementRow): CcaMovement {
  return {
    id: row.id,
    amountClp: toNumber(row.amount_clp),
    previousAmountClp:
      row.previous_amount_clp === null ? null : toNumber(row.previous_amount_clp),
    stockClp: toNumber(row.stock_clp),
    ccaUf: toNumber(row.cca_uf),
    ufClp: toNumber(row.uf_clp),
    ccaPct: toNumber(row.cca_pct),
    reason: row.reason === 'alta' || row.reason === 'planes' ? row.reason : 'cartera',
    createdAt: row.created_at,
  };
}

/**
 * Recalcula el CCA de un socio y, si el monto mensual cambió, deja el
 * movimiento y le avisa por correo.
 *
 * Se llama después de cada escritura del panel (`alta`, `edición` o `baja` de
 * una publicación) y después de guardar **Planes** cuando cambia el `%CCA`.
 * Nunca lanza: un fallo al registrar la cuenta no puede deshacer una
 * publicación que ya se guardó; se devuelve el error para quien quiera
 * mostrarlo o loguearlo.
 */
export async function syncPartnerCca(
  partnerId: string,
  options: { reason?: CcaReason } = {}
): Promise<CcaSyncResult> {
  const empty = { changed: false, amountClp: 0, previousAmountClp: null, emailed: false };

  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      ...empty,
      error: 'Supabase no está configurado: la cuenta corriente del CCA no se puede registrar.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const pricing = await readPlanPricing();
    const [prices, ufClp, previous, partner] = await Promise.all([
      stockPrices(supabase, partnerId),
      readUfClp(),
      latestMovement(supabase, partnerId),
      partnerEmail(supabase, partnerId),
    ]);

    if (ufClp === null) {
      return {
        ok: false,
        ...empty,
        previousAmountClp: previous?.amountClp ?? null,
        error: 'No se pudo leer la UF del día: el movimiento no se registró.',
      };
    }

    const snapshot = ccaSnapshot(prices, ufClp, pricing.config.ccaPct);
    const previousAmountClp = previous?.amountClp ?? null;

    // Sin cambio de monto no hay línea nueva ni correo. La cartera puede haber
    // cambiado sin mover el monto (un cambio de precio que no altera el redondeo
    // en pesos); la cuenta no se ensucia con eso.
    if (previousAmountClp !== null && previousAmountClp === snapshot.amountClp) {
      return {
        ok: true,
        changed: false,
        amountClp: snapshot.amountClp,
        previousAmountClp,
        emailed: false,
      };
    }

    const { data, error } = await supabase
      .from('partner_cca_ledger')
      .insert({
        partner_id: partnerId,
        amount_clp: snapshot.amountClp,
        previous_amount_clp: previousAmountClp,
        stock_clp: snapshot.stockClp,
        cca_uf: snapshot.ccaUf,
        uf_clp: snapshot.ufClp,
        cca_pct: snapshot.ccaPct,
        reason: previousAmountClp === null ? 'alta' : options.reason ?? 'cartera',
      })
      .select('id')
      .single();

    if (error) {
      return {
        ok: false,
        changed: false,
        amountClp: snapshot.amountClp,
        previousAmountClp,
        emailed: false,
        error: `No se pudo registrar el movimiento del CCA: ${error.message}`,
      };
    }

    // El primer movimiento con monto > 0 es el primer cobro: también se avisa.
    // La línea base del alta (cartera vacía, $0) no manda correo.
    const shouldEmail =
      !!partner?.contact_email && (previousAmountClp !== null || snapshot.amountClp > 0);

    if (!shouldEmail) {
      return {
        ok: true,
        changed: true,
        amountClp: snapshot.amountClp,
        previousAmountClp,
        emailed: false,
      };
    }

    const built = buildCcaChangeEmail({
      partnerName: partner?.name ?? partnerId,
      amountClp: snapshot.amountClp,
      previousAmountClp,
      stockClp: snapshot.stockClp,
      ccaUf: snapshot.ccaUf,
      ufClp: snapshot.ufClp,
      ccaPct: snapshot.ccaPct,
      siteUrl: SITE_URL,
    });
    const sent = await sendEmail({ to: partner.contact_email as string, ...built });
    if (!sent.sent && !sent.skipped) {
      console.error('[cca] no se pudo avisar el cambio de CCA:', sent.error);
    }

    return {
      ok: true,
      changed: true,
      amountClp: snapshot.amountClp,
      previousAmountClp,
      emailed: sent.sent,
      ...(sent.sent || sent.skipped ? {} : { error: sent.error }),
    };
  } catch (error) {
    return {
      ok: false,
      ...empty,
      error: error instanceof Error ? error.message : 'Error inesperado al registrar el CCA.',
    };
  }
}

/**
 * Recalcula la cuenta de **todos** los socios.
 *
 * Se usa cuando cambia el `%CCA` en Planes: ese número multiplica la cartera de
 * cada socio, así que un ajuste mueve la facturación de todos. Cada uno recibe
 * su propio correo con su monto; los que no tienen cartera quedan en $0 y no se
 * les escribe nada.
 */
export async function syncAllPartnerCca(
  options: { reason?: CcaReason } = {}
): Promise<{ ok: boolean; partners: number; changed: number; error?: string }> {
  if (!isServiceRoleConfigured()) {
    return {
      ok: false,
      partners: 0,
      changed: 0,
      error: 'Supabase no está configurado: no se pueden recalcular las cuentas del CCA.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase.from('partners').select('id').limit(1000);
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);

    let changed = 0;
    for (const id of ids) {
      const result = await syncPartnerCca(id, options);
      if (result.changed) changed += 1;
    }

    return { ok: true, partners: ids.length, changed };
  } catch (error) {
    return {
      ok: false,
      partners: 0,
      changed: 0,
      error: error instanceof Error ? error.message : 'No se pudieron recalcular las cuentas.',
    };
  }
}

/**
 * Cuándo el socio autorizó el cobro del CCA.
 *
 * Se guarda en la solicitud de alta (`kyb_applications.cca_authorized_at`), no
 * en el socio: es una decisión del solicitante en el paso de Alta y forma parte
 * del expediente. El panel y la ficha del equipo la muestran como prueba de que
 * el cargo se aprobó antes de la primera factura.
 *
 * `null` = no hay autorización registrada (alta anterior a la 0033, o alta que
 * todavía no se cerró).
 */
export async function readCcaAuthorization(partnerId: string): Promise<string | null> {
  if (!isServiceRoleConfigured()) return null;

  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from('kyb_applications')
      .select('cca_authorized_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const value = (data as { cca_authorized_at?: string | null } | null)?.cca_authorized_at;
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Los últimos movimientos de un socio, del más nuevo al más viejo.
 *
 * Es lo que el panel muestra como cuenta corriente. La lectura va con la clave
 * de servicio y el `partnerId` lo resuelve la ruta desde la sesión: el cliente
 * nunca elige de quién es la cuenta.
 */
export async function readCcaMovements(
  partnerId: string,
  limit = 12
): Promise<{ movements: CcaMovement[]; persistent: boolean; warning?: string }> {
  if (!isServiceRoleConfigured()) {
    return {
      movements: [],
      persistent: false,
      warning: 'Supabase no está configurado: la cuenta corriente no está disponible.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('partner_cca_ledger')
      .select('id, amount_clp, previous_amount_clp, stock_clp, cca_uf, uf_clp, cca_pct, reason, created_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return {
      movements: ((data ?? []) as CcaMovementRow[]).map(movementFromRow),
      persistent: true,
      ...(error ? { warning: `No se pudo leer la cuenta corriente (${error.message}).` } : {}),
    };
  } catch (error) {
    return {
      movements: [],
      persistent: false,
      warning: `No se pudo leer la cuenta corriente (${
        error instanceof Error ? error.message : 'error desconocido'
      }).`,
    };
  }
}
