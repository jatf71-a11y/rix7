import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import { listApplications, updateApplication } from '@/lib/kyb/store';
import {
  dueDateFor,
  normalizePago,
  periodLabel,
  situacionDe,
  type BillingPeriod,
  type SituacionResult,
  type SituacionSocio,
} from './cobranza';

/**
 * Cobranza de la suscripción: lectura del estado de cada socio y las dos
 * acciones del equipo (registrar un pago, confirmar o levantar la morosidad).
 *
 * Todo pasa por la clave de servicio: `partner_billing` está cerrada por RLS sin
 * políticas —es información comercial— y `partners.moroso` la escribe solo el
 * equipo. Las reglas de fechas y montos viven en `cobranza.ts`; acá solo se lee
 * y se escribe.
 *
 * La morosidad se **confirma a mano**, pero se **levanta sola** cuando el pago
 * deja al socio sin períodos vencidos: regularizar es pagar, y obligar a un
 * segundo clic para que sus publicaciones vuelvan al portal no aporta nada.
 */

export interface SocioCobranza {
  partnerId: string;
  name: string;
  email: string;
  moroso: boolean;
  morosoDesde: string | null;
  morosoNota: string | null;
  situacion: SituacionSocio;
  deudaClp: number;
  periodosVencidos: string[];
  proximoVencimiento: string | null;
  ultimoPago: { period: string; paidAt: string; amountClp: number } | null;
  periodos: BillingPeriod[];
}

export interface CobranzaList {
  socios: SocioCobranza[];
  persistent: boolean;
  warning?: string;
}

interface PartnerRow {
  id: string;
  name: string;
  contact_email: string | null;
  moroso: boolean | null;
  moroso_desde: string | null;
  moroso_nota: string | null;
}

interface BillingRow {
  partner_id: string;
  period: string;
  amount_clp: number;
  due_date: string;
  paid_at: string | null;
  note: string | null;
}

function toPeriod(row: BillingRow): BillingPeriod {
  return {
    partnerId: row.partner_id,
    period: row.period,
    amountClp: row.amount_clp,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    note: row.note,
  };
}

/** Todos los socios con su situación de cobranza, del más atrasado al día. */
export async function listCobranza(today: Date = new Date()): Promise<CobranzaList> {
  if (!isServiceRoleConfigured()) {
    return {
      socios: [],
      persistent: false,
      warning:
        'Supabase no está configurado (o falta la clave de servicio): la cobranza no puede leer ni guardar nada.',
    };
  }

  try {
    const supabase = createServiceRoleClient();
    const [partnersResult, billingResult] = await Promise.all([
      supabase
        .from('partners')
        .select('id, name, contact_email, moroso, moroso_desde, moroso_nota')
        .order('name', { ascending: true })
        .limit(2000),
      supabase
        .from('partner_billing')
        .select('partner_id, period, amount_clp, due_date, paid_at, note')
        .order('period', { ascending: false })
        .limit(5000),
    ]);

    if (partnersResult.error) {
      return {
        socios: [],
        persistent: true,
        warning: `No se pudieron leer los socios (${partnersResult.error.message}).`,
      };
    }

    const byPartner = new Map<string, BillingPeriod[]>();
    for (const row of (billingResult.data ?? []) as BillingRow[]) {
      const list = byPartner.get(row.partner_id) ?? [];
      list.push(toPeriod(row));
      byPartner.set(row.partner_id, list);
    }

    const socios = ((partnersResult.data ?? []) as PartnerRow[]).map((partner) => {
      const periodos = byPartner.get(partner.id) ?? [];
      const situacion = situacionDe({
        periods: periodos,
        moroso: !!partner.moroso,
        today,
      });
      const pagados = periodos
        .filter((row) => row.paidAt)
        .sort((a, b) => b.period.localeCompare(a.period));

      return {
        partnerId: partner.id,
        name: partner.name,
        email: partner.contact_email ?? '',
        moroso: !!partner.moroso,
        morosoDesde: partner.moroso_desde,
        morosoNota: partner.moroso_nota,
        situacion: situacion.estado,
        deudaClp: situacion.deudaClp,
        periodosVencidos: situacion.periodosVencidos,
        proximoVencimiento: situacion.proximoVencimiento,
        ultimoPago: pagados[0]
          ? {
              period: pagados[0].period,
              paidAt: pagados[0].paidAt ?? '',
              amountClp: pagados[0].amountClp,
            }
          : null,
        periodos: periodos.sort((a, b) => b.period.localeCompare(a.period)),
      } satisfies SocioCobranza;
    });

    // Lo que reclama atención primero: morosos y vencidos arriba, después el
    // resto; dentro de cada grupo, por nombre.
    const rank: Record<SituacionSocio, number> = {
      moroso: 0,
      vencido: 1,
      por_vencer: 2,
      sin_facturar: 3,
      al_dia: 4,
    };

    socios.sort(
      (a, b) => rank[a.situacion] - rank[b.situacion] || a.name.localeCompare(b.name, 'es-CL')
    );

    return { socios, persistent: true };
  } catch (error) {
    return {
      socios: [],
      persistent: false,
      warning: `No se pudo consultar la cobranza (${
        error instanceof Error ? error.message : 'error desconocido'
      }).`,
    };
  }
}

/** Situación de un socio puntual, para el aviso de su panel. */
export async function situacionDePartner(
  partnerId: string,
  today: Date = new Date()
): Promise<SituacionResult | null> {
  if (!isServiceRoleConfigured()) return null;

  try {
    const supabase = createServiceRoleClient();
    const [partnerResult, billingResult] = await Promise.all([
      supabase.from('partners').select('moroso').eq('id', partnerId).maybeSingle(),
      supabase
        .from('partner_billing')
        .select('partner_id, period, amount_clp, due_date, paid_at, note')
        .eq('partner_id', partnerId)
        .limit(500),
    ]);

    if (partnerResult.error) return null;

    const moroso = !!(partnerResult.data as { moroso?: boolean } | null)?.moroso;
    const periods = ((billingResult.data ?? []) as BillingRow[]).map(toPeriod);
    return situacionDe({ periods, moroso, today });
  } catch {
    return null;
  }
}

export interface CobranzaActionResult {
  ok: boolean;
  error?: string;
  situacion?: SituacionResult;
}

/**
 * Registra el pago de un período.
 *
 * Es un `upsert` por `(partner_id, period)`: un período se factura una vez, y
 * corregir un monto o volver a marcarlo pagado no duplica la fila.
 *
 * Dos efectos en la misma corrida:
 * 1. Si el socio queda sin períodos vencidos, se le levanta la morosidad y sus
 *    publicaciones vuelven al portal.
 * 2. Si el alta de ese socio estaba en `Alta` —plan elegido, panel habilitado,
 *    sin pagar—, pasa a `Operando`: es el cierre del pipeline que definió el
 *    equipo.
 */
export async function registrarPago(input: {
  partnerId: unknown;
  period?: unknown;
  amountClp?: unknown;
  note?: unknown;
}): Promise<CobranzaActionResult> {
  const partnerId = typeof input.partnerId === 'string' ? input.partnerId.trim() : '';
  if (!partnerId) return { ok: false, error: 'Falta el socio del pago.' };

  const pago = normalizePago(input);
  if (!pago.ok) return { ok: false, error: pago.error };

  if (!isServiceRoleConfigured()) {
    return { ok: false, error: 'Supabase no está configurado: el pago no se puede guardar.' };
  }

  try {
    const supabase = createServiceRoleClient();
    const now = new Date().toISOString();

    const { error } = await supabase.from('partner_billing').upsert(
      {
        partner_id: partnerId,
        period: pago.data.period,
        amount_clp: pago.data.amountClp,
        due_date: dueDateFor(pago.data.period),
        paid_at: now,
        note: pago.data.note,
        updated_at: now,
      },
      { onConflict: 'partner_id,period' }
    );

    if (error) return { ok: false, error: `No se pudo guardar el pago: ${error.message}` };

    // La situación se recalcula con lo que quedó guardado, no con lo que creía
    // el panel: es la base la que dice si el socio sigue debiendo.
    //
    // La condición mira **solo** los períodos vencidos, y no el estado: mientras
    // la marca esté puesta el estado es «moroso» por definición, así que exigir
    // «no estar moroso» volvía inalcanzable el levantamiento y un socio que
    // pagaba seguía bloqueado hasta que alguien lo destrabara a mano.
    const situacion = await situacionDePartner(partnerId);
    if (situacion && situacion.periodosVencidos.length === 0) {
      await supabase
        .from('partners')
        .update({ moroso: false, moroso_desde: null, moroso_nota: null })
        .eq('id', partnerId)
        .eq('moroso', true);
    }

    await promoverAOperando(partnerId);

    return { ok: true, situacion: situacion ?? undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado al registrar el pago.',
    };
  }
}

/**
 * Cierra el alta del socio que acaba de pagar.
 *
 * Solo mueve una solicitud en `Alta` con el `partner_id` del socio: un alta que
 * todavía no eligió plan no se toca, y si ya está `Operando` no hay nada que
 * hacer. Si falla, el pago igual quedó guardado —por eso no se devuelve error—.
 */
async function promoverAOperando(partnerId: string): Promise<void> {
  try {
    const list = await listApplications(500);
    const application = list.ok
      ? list.data?.applications.find(
          (item) => item.partnerId === partnerId && item.status === 'Alta'
        )
      : undefined;

    if (application) {
      await updateApplication(application.id, { status: 'Operando' });
    }
  } catch {
    // El pago ya está registrado; el estado del alta se puede corregir a mano.
  }
}

/** Confirma o levanta la morosidad de un socio. */
export async function setMorosidad(input: {
  partnerId: unknown;
  moroso: unknown;
  nota?: unknown;
}): Promise<CobranzaActionResult> {
  const partnerId = typeof input.partnerId === 'string' ? input.partnerId.trim() : '';
  if (!partnerId) return { ok: false, error: 'Falta el socio.' };
  if (typeof input.moroso !== 'boolean') {
    return { ok: false, error: 'Hay que decir si el socio queda moroso o al día.' };
  }

  if (!isServiceRoleConfigured()) {
    return { ok: false, error: 'Supabase no está configurado: no se puede cambiar la morosidad.' };
  }

  const nota = typeof input.nota === 'string' ? input.nota.trim() : '';

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from('partners')
      .update({
        moroso: input.moroso,
        moroso_desde: input.moroso ? new Date().toISOString() : null,
        moroso_nota: input.moroso ? nota || null : null,
      })
      .eq('id', partnerId);

    if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` };

    const situacion = await situacionDePartner(partnerId);
    return { ok: true, situacion: situacion ?? undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado al cambiar la morosidad.',
    };
  }
}

/** Etiqueta legible del período, para los mensajes de la API. */
export function labelPeriod(period: string): string {
  return periodLabel(period);
}
