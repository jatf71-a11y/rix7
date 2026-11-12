/**
 * La cuenta del socio, para su propio panel.
 *
 * El socio pagó el alta, eligió un plan y autorizó el CCA mensual, pero hasta
 * ahora su panel no se lo decía: había publicaciones y CCA, y nada sobre la
 * suscripción que está pagando. Esta lectura junta lo que el alta ya dejó en
 * `kyb_applications` —plan, fecha de alta, autorización del CCA y cantidad de
 * usuarios— con los montos vigentes de **Planes**, que son los que se facturan
 * hoy y no los de la propuesta original.
 *
 * Es una lectura pura del lado del servidor: el `partnerId` lo resuelve el guard
 * desde la sesión, nunca el cliente.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { isKybPlanId, getKybPlan, type KybPlanId } from '@/lib/kyb/plans';
import { planPrice } from '@/lib/kyb/planPricing';
import { readPlanPricing } from '@/lib/data/planPricingStore';

export interface PartnerAccount {
  legalName: string;
  /** Estado del alta: `Operando` es un cliente con acceso al panel. */
  status: string;
  panelEnabled: boolean;
  planId: KybPlanId | null;
  planName: string | null;
  /** Monto del alta, ya cobrado. */
  altaClp: number | null;
  /** Mensualidad vigente, sin CCA. */
  monthlyClp: number | null;
  /** Usuarios que el plan incluye. */
  usersIncluded: number | null;
  /** La facturación de la suscripción es mensual por definición del plan. */
  billing: 'mensual';
  activatedAt: string | null;
  /** Fecha en que el socio autorizó el cobro del CCA. */
  ccaAuthorizedAt: string | null;
  /**
   * Cierre del primer período mensual, contado desde el alta. No es el «período
   * en curso»: la suscripción se cobra todos los meses el día 1 y no se
   * prorratea, así que para un alta vieja esta fecha ya pasó.
   */
  periodEndsAt: string | null;
  /** `true` cuando no se pudo leer la base y se muestra solo lo que hay. */
  persistent: boolean;
  warning?: string;
}

/** Primer día del mes siguiente: la facturación es mensual y no se prorratea. */
export function nextMonthStart(from: string | null, now: Date = new Date()): string | null {
  const base = from ? new Date(from) : now;
  if (Number.isNaN(base.getTime())) return null;
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * La cuenta de un socio, o `null` si todavía no tiene alta.
 *
 * No inventa nada: sin fila en `kyb_applications` no hay suscripción que
 * mostrar. Los montos salen de **Planes**; si el plan ya no está en el catálogo,
 * se devuelve el id guardado y los montos en `null`, en vez de mostrar los de
 * otro plan.
 */
export async function readPartnerAccount(partnerId: string): Promise<PartnerAccount | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('kyb_applications')
    .select('legal_name, status, plan, panel_enabled, activated_at, cca_authorized_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const planId = isKybPlanId(data.plan) ? data.plan : null;
  const pricing = await readPlanPricing().catch(() => null);
  const price = pricing && planId ? planPrice(pricing.config, planId) : null;
  const catalog = planId ? getKybPlan(planId) : null;

  const activatedAt = data.activated_at ?? null;

  return {
    legalName: data.legal_name,
    status: data.status,
    panelEnabled: !!data.panel_enabled,
    planId,
    planName: catalog?.name ?? null,
    altaClp: price?.altaInicialClp ?? null,
    monthlyClp: price?.mensualBaseClp ?? null,
    usersIncluded: price?.usuariosIncluidos ?? catalog?.users ?? null,
    billing: 'mensual',
    activatedAt,
    ccaAuthorizedAt: data.cca_authorized_at ?? null,
    periodEndsAt: nextMonthStart(activatedAt),
    persistent: true,
    ...(planId && !price
      ? { warning: 'El plan guardado no está en el catálogo de Planes: los montos no se pueden mostrar.' }
      : {}),
  };
}
