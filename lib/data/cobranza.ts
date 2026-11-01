/**
 * Cobranza de la suscripción de un socio.
 *
 * La suscripción es mensual y de período fijo: cada mes se factura un período
 * (`YYYY-MM`) con su vencimiento, y cuando el pago entra se marca esa fila. No
 * hay una máquina de estados de pago: **el estado se deriva** de la fecha y de si
 * hay pago, así que una base sin mantenimiento no acumula filas «vencidas» que
 * alguien tenía que actualizar a mano.
 *
 * Dos cosas distintas que conviene no mezclar:
 *
 * - **Vencido** es un hecho de la base: pasó la fecha de pago y no hay pago.
 * - **Moroso** es una decisión del equipo: alguien lo confirmó y a partir de ahí
 *   las publicaciones del socio no se muestran en el portal hasta que regularice.
 *
 * La morosidad no se deriva sola a propósito. Ocultar todas las fichas de una
 * corredora es una decisión comercial con consecuencias públicas; que la tome un
 * cálculo de fechas sin que nadie la mire sería demasiado.
 *
 * El módulo es puro: fechas y números, sin red ni base, para poder probar los
 * bordes (día de vencimiento, gracia, cambio de año) sin tocar Supabase.
 */

/** Día del mes en que vence el período. */
export const BILLING_DUE_DAY = 10;

/**
 * Días de gracia después del vencimiento antes de considerar el período vencido.
 *
 * Sin gracia, un pago hecho el 11 a las 09:00 con vencimiento el 10 ya figuraba
 * como deuda y el aviso del panel asustaba a un socio que estaba al día.
 */
export const BILLING_GRACE_DAYS = 5;

export interface BillingPeriod {
  partnerId: string;
  /** Período facturado, «YYYY-MM». */
  period: string;
  amountClp: number;
  /** Vencimiento, «YYYY-MM-DD». */
  dueDate: string;
  /** Cuándo se pagó; `null` mientras no entra. */
  paidAt: string | null;
  note: string | null;
}

export type PeriodState = 'pagado' | 'pendiente' | 'vencido';

/**
 * Situación de un socio frente a la cobranza.
 *
 * - `sin_facturar` — todavía no se le emitió ningún período (recién activado).
 * - `al_dia` — todos los períodos vencidos están pagados.
 * - `por_vencer` — el período en curso sigue impago pero dentro de plazo.
 * - `vencido` — hay un período pasado de la gracia sin pagar.
 * - `moroso` — el equipo confirmó la morosidad: publicaciones fuera del portal.
 */
export type SituacionSocio = 'sin_facturar' | 'al_dia' | 'por_vencer' | 'vencido' | 'moroso';

/** Período del mes en curso, en UTC (el portal factura en horario de Chile). */
export function currentPeriod(today: Date = new Date()): string {
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ¿Tiene forma de período «YYYY-MM» con mes válido? */
export function isValidPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Vencimiento de un período: el día fijo del mismo mes. */
export function dueDateFor(period: string): string {
  return `${period}-${String(BILLING_DUE_DAY).padStart(2, '0')}`;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** «2026-11» → «noviembre de 2026». */
export function periodLabel(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [year, month] = period.split('-');
  return `${MONTHS[Number(month) - 1]} de ${year}`;
}

function dayNumber(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : Number.NaN;
}

/** Estado de una fila: pagada, dentro de plazo o vencida (con gracia). */
export function periodState(row: BillingPeriod, today: Date = new Date()): PeriodState {
  if (row.paidAt) return 'pagado';
  const due = dayNumber(row.dueDate);
  if (!Number.isFinite(due)) return 'pendiente';
  const now = Math.floor(today.getTime() / 86_400_000);
  return now > due + BILLING_GRACE_DAYS ? 'vencido' : 'pendiente';
}

export interface SituacionResult {
  estado: SituacionSocio;
  /** Suma de los períodos impagos, vencidos o no. */
  deudaClp: number;
  /** Períodos pasados de la gracia sin pago, del más viejo al más nuevo. */
  periodosVencidos: string[];
  /** Primer vencimiento impago, o `null` si no hay nada pendiente. */
  proximoVencimiento: string | null;
}

/**
 * Situación completa de un socio.
 *
 * La marca manual manda: si el equipo confirmó la morosidad, el estado es
 * `moroso` aunque después haya entrado un pago —levantarla es una decisión
 * explícita—, pero la deuda se sigue calculando para que la pantalla muestre
 * cuánto falta.
 */
export function situacionDe({
  periods,
  moroso,
  today = new Date(),
}: {
  periods: BillingPeriod[];
  moroso: boolean;
  today?: Date;
}): SituacionResult {
  const ordered = [...periods].sort((a, b) => a.period.localeCompare(b.period));

  const unpaid = ordered.filter((row) => !row.paidAt);
  const vencidos = unpaid.filter((row) => periodState(row, today) === 'vencido');
  const deudaClp = unpaid.reduce((total, row) => total + Math.max(0, row.amountClp), 0);
  const proximoVencimiento =
    unpaid.length > 0
      ? unpaid.map((row) => row.dueDate).sort((a, b) => a.localeCompare(b))[0] ?? null
      : null;

  const base = {
    deudaClp,
    periodosVencidos: vencidos.map((row) => row.period),
    proximoVencimiento,
  };

  if (ordered.length === 0) return { ...base, estado: 'sin_facturar' };
  if (moroso) return { ...base, estado: 'moroso' };
  if (vencidos.length > 0) return { ...base, estado: 'vencido' };
  if (unpaid.length > 0) return { ...base, estado: 'por_vencer' };
  return { ...base, estado: 'al_dia' };
}

/** Etiqueta y tono de la situación, para el panel y el aviso del socio. */
export const SITUACION_LABELS: Record<SituacionSocio, string> = {
  sin_facturar: 'Sin facturar',
  al_dia: 'Al día',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  moroso: 'Moroso',
};

export const SITUACION_TONES: Record<SituacionSocio, string> = {
  sin_facturar: 'border-slate-200 bg-slate-50 text-slate-600',
  al_dia: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  por_vencer: 'border-amber-200 bg-amber-50 text-amber-800',
  vencido: 'border-orange-200 bg-orange-50 text-orange-800',
  moroso: 'border-red-200 bg-red-50 text-red-700',
};

/** Tope de un período: más que esto no es una mensualidad, es un error. */
export const MAX_PERIOD_CLP = 50_000_000;

export type PagoValidation =
  | { ok: true; data: { period: string; amountClp: number; note: string | null } }
  | { ok: false; error: string };

/**
 * Valida el registro de un pago.
 *
 * El monto se puede corregir a mano (un descuento, un prorrateo), pero tiene que
 * ser un entero mayor que cero: un período «pagado» por $0 no es un pago y
 * dejaría al socio al día sin haber pagado nada.
 */
export function normalizePago(input: {
  period?: unknown;
  amountClp?: unknown;
  note?: unknown;
}): PagoValidation {
  if (!isValidPeriod(input.period)) {
    return { ok: false, error: 'El período tiene que ser un mes con formato AAAA-MM.' };
  }

  const raw = typeof input.amountClp === 'string' ? Number(input.amountClp) : input.amountClp;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { ok: false, error: 'El monto tiene que ser un entero en pesos.' };
  }
  if (raw <= 0) return { ok: false, error: 'El monto del pago tiene que ser mayor que cero.' };
  if (raw > MAX_PERIOD_CLP) return { ok: false, error: 'El monto está fuera del rango razonable.' };

  const note = typeof input.note === 'string' ? input.note.trim() : '';

  return { ok: true, data: { period: input.period, amountClp: raw, note: note || null } };
}
