/**
 * Job de solicitudes detenidas.
 *
 * El flujo automático resolvía el primer paso —evaluar, pedir datos, avisar— y
 * después se olvidaba: una solicitud podía quedarse meses en
 * «Pendiente de información» o en «Propuesta comercial» sin que nadie volviera a
 * escribir, y el tablero acumulaba fantasmas. El token vence a los 7 días, así
 * que además el enlace que tenía la persona dejaba de servir en silencio.
 *
 * Este módulo decide y ejecuta tres cosas, con la misma regla para los dos
 * caminos (registros de socio y altas de empresa):
 *
 * 1. **recordar** a los 3 y a los 10 días del paso, emitiendo un enlace nuevo;
 * 2. **cerrar** a los 30 días por falta de respuesta, avisando el motivo;
 * 3. no repetir nada: el conteo viaja en el registro (`reminders_sent` en el
 *    alta, `solicitud_nudges` en el `payload` del registro), así que correr el
 *    job dos veces el mismo día no manda dos correos.
 *
 * El cálculo de qué corresponde es puro y se prueba solo (`planNudge`); la
 * ejecución usa los mismos módulos que el panel —`resendKybLink` y
 * `resendSolicitudLink`—, para que un recordatorio y un reenvío manual no
 * puedan divergir.
 */

import { buildKybRejectedEmail } from '@/lib/email/kybEmails';
import { buildSolicitudRejectedEmail } from '@/lib/email/solicitudApplicantEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { resendKybLink } from '@/lib/kyb/onboarding';
import { latestProposal } from '@/lib/kyb/proposal';
import type { KybStatus } from '@/lib/kyb/status';
import {
  latestInformationRequest,
  listApplications,
  updateApplication,
} from '@/lib/kyb/store';
import type { KybApplication } from '@/lib/kyb/types';
import { SITE_URL } from '@/lib/site';
import { resendSolicitudLink } from './solicitudAutopilot';
import { SOLICITUD_REVIEW_KEYS as REVIEW_KEYS, solicitudOfferLabel } from './solicitudEvaluation';
import { solicitudAltaId } from './socios';
import type { Solicitud } from './solicitudes';
import { listSolicitudesForReview, updateSolicitudReview } from './solicitudesStore';

/** Días desde el inicio del paso en que se insiste. */
export const NUDGE_AFTER_DAYS = [3, 10] as const;

/**
 * Días después de los cuales el trámite se cierra por abandono.
 *
 * Treinta días son tres recordatorios y dos vencimientos de token: el que no
 * respondió en ese plazo no está esperando, y dejarlo abierto hace que el
 * tablero mienta. Cerrar no borra nada: la solicitud queda en `Rechazada` con su
 * historial y se puede volver a iniciar.
 */
export const ABANDON_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type NudgeAction = 'none' | 'remind' | 'close';

/**
 * Estados que el job puede cerrar solo.
 *
 * `Alta` queda afuera aunque el plazo venza: la propuesta ya está aceptada y
 * descartar esa venta es una decisión del equipo. `Pendiente_Informacion` y
 * `Propuesta_Comercial` sí: el candidato nunca respondió, y dejarlas abiertas
 * hace que el tablero mienta.
 */
export function canAutoClose(status: KybStatus): boolean {
  return status === 'Pendiente_Informacion' || status === 'Propuesta_Comercial';
}

export interface NudgePlan {
  action: NudgeAction;
  /** Días transcurridos desde el inicio del paso. */
  days: number;
  /** Días que faltan para el cierre; se muestra en el recordatorio. */
  closingInDays: number;
}

/**
 * Qué hacer con una solicitud detenida.
 *
 * `nudgesSent` es el número de avisos ya enviados: el primero sale a los 3 días
 * y el segundo a los 10. Con un contador en la base no hace falta comparar
 * fechas ni guardar el historial completo de envíos, y reejecutar el job no
 * duplica nada.
 *
 * Una fecha inválida —una fila vieja sin el dato— da `none`: no se cierra ni se
 * escribe a alguien por un cálculo roto.
 */
export function planNudge({
  since,
  nudgesSent,
  now = new Date(),
}: {
  since: string | null | undefined;
  nudgesSent: number;
  now?: Date;
}): NudgePlan {
  const start = since ? Date.parse(since) : Number.NaN;
  if (Number.isNaN(start)) return { action: 'none', days: 0, closingInDays: ABANDON_AFTER_DAYS };

  const days = Math.floor((now.getTime() - start) / DAY_MS);
  const closingInDays = Math.max(0, ABANDON_AFTER_DAYS - days);

  if (days >= ABANDON_AFTER_DAYS) return { action: 'close', days, closingInDays: 0 };
  if (days >= NUDGE_AFTER_DAYS[1] && nudgesSent < 2) return { action: 'remind', days, closingInDays };
  if (days >= NUDGE_AFTER_DAYS[0] && nudgesSent < 1) return { action: 'remind', days, closingInDays };
  return { action: 'none', days, closingInDays };
}

/**
 * Desde cuándo está detenida un alta.
 *
 * No es `updatedAt` —cualquier escritura lo mueve, incluido el propio
 * recordatorio—, es el hito que abrió el paso: la ronda de preguntas, el envío
 * de la propuesta o la aceptación que dejó el alta pendiente de plan.
 */
function stuckSince(application: KybApplication, request: string | null): string | null {
  if (application.status === 'Pendiente_Informacion') {
    return request ?? application.updatedAt;
  }
  if (application.status === 'Propuesta_Comercial') {
    return latestProposal(application.proposal)?.sentAt ?? application.updatedAt;
  }
  if (application.status === 'Alta') {
    return latestProposal(application.proposal)?.decidedAt ?? application.updatedAt;
  }
  return null;
}

/** Qué estados atiende el job. `Alta` solo mientras falte confirmar el plan. */
function isNudgeable(application: KybApplication): boolean {
  if (application.panelEnabled) return false;
  return (
    application.status === 'Pendiente_Informacion' ||
    application.status === 'Propuesta_Comercial' ||
    application.status === 'Alta'
  );
}

export interface NudgeItem {
  id: string;
  source: 'alta' | 'registro';
  status: KybStatus;
  action: NudgeAction;
  days: number;
  emailSent?: boolean;
  error?: string;
}

export interface NudgeReport {
  runAt: string;
  dryRun: boolean;
  applications: NudgeItem[];
  solicitudes: NudgeItem[];
  errors: string[];
}

async function closeApplication(application: KybApplication): Promise<void> {
  const transition = await updateApplication(application.id, {
    status: 'Rechazada',
    // El enlace deja de existir: nadie puede reactivar un trámite cerrado con un
    // token viejo.
    tokenHash: null,
    tokenPurpose: null,
    tokenExpiresAt: null,
  });
  if (!transition.ok) throw new Error(transition.error ?? 'No se pudo cerrar el alta.');

  const email = await sendEmail({
    to: application.email,
    ...buildKybRejectedEmail({
      legalName: application.legalName,
      contactName: application.contactName,
      reason: `Cerramos el trámite de alta porque no recibimos respuesta en ${ABANDON_AFTER_DAYS} días. Si todavía te interesa, responde este correo y lo reabrimos.`,
      siteUrl: SITE_URL,
    }),
  });
  if (!email.sent && !email.skipped) {
    console.error('[nudges] no se pudo avisar el cierre del alta:', email.error);
  }
}

async function closeSolicitud(solicitud: Solicitud): Promise<void> {
  const stored = await updateSolicitudReview(solicitud.id, {
    status: 'Rechazada',
    answerTokenHash: null,
  });
  if (!stored.ok) throw new Error(stored.error ?? 'No se pudo cerrar el registro.');

  const email = await sendEmail({
    to: solicitud.email,
    ...buildSolicitudRejectedEmail({
      name: solicitud.name,
      offerLabel: solicitudOfferLabel(solicitud.kind),
      reason: `Cerramos tu registro porque quedó esperando información durante ${ABANDON_AFTER_DAYS} días. Si todavía te interesa, responde este correo y lo volvemos a abrir.`,
      siteUrl: SITE_URL,
    }),
  });
  if (!email.sent && !email.skipped) {
    console.error('[nudges] no se pudo avisar el cierre del registro:', email.error);
  }
}

/**
 * Corre el job.
 *
 * `dryRun` calcula y no escribe ni envía: es la forma de ver qué haría antes de
 * dejarlo agendado. Los errores no cortan la corrida —una fila rota no puede
 * impedir que se avise a las demás— y se informan en `errors`.
 */
export async function runSocioNudges({
  now = new Date(),
  dryRun = false,
}: {
  now?: Date;
  dryRun?: boolean;
} = {}): Promise<NudgeReport> {
  const report: NudgeReport = {
    runAt: now.toISOString(),
    dryRun,
    applications: [],
    solicitudes: [],
    errors: [],
  };

  const applications = await listApplications(500);
  if (!applications.ok || !applications.data) {
    report.errors.push(applications.error ?? 'No se pudieron leer las altas.');
  } else {
    for (const application of applications.data.applications) {
      if (!isNudgeable(application)) continue;

      const request =
        application.status === 'Pendiente_Informacion'
          ? (await latestInformationRequest(application.id))?.requestedAt ?? null
          : null;
      const plan = planNudge({
        since: stuckSince(application, request),
        nudgesSent: application.remindersSent ?? 0,
        now,
      });
      if (plan.action === 'none') continue;
      if (plan.action === 'close' && !canAutoClose(application.status)) continue;

      const item: NudgeItem = {
        id: application.id,
        source: 'alta',
        status: application.status,
        action: plan.action,
        days: plan.days,
      };

      if (!dryRun) {
        try {
          if (plan.action === 'remind') {
            const resent = await resendKybLink(application.id, {
              reminder: true,
              closingInDays: plan.closingInDays,
            });
            if (!resent.ok) throw new Error(resent.error ?? 'No se pudo reenviar el enlace.');
            item.emailSent = !!resent.email?.sent;
            const marked = await updateApplication(application.id, {
              remindersSent: (application.remindersSent ?? 0) + 1,
              lastReminderAt: now.toISOString(),
            });
            if (!marked.ok) throw new Error(marked.error ?? 'No se pudo anotar el recordatorio.');
          } else {
            await closeApplication(application);
          }
        } catch (error) {
          item.error = error instanceof Error ? error.message : 'Error inesperado.';
          report.errors.push(`alta ${application.id}: ${item.error}`);
        }
      }

      report.applications.push(item);
    }
  }

  const solicitudes = await listSolicitudesForReview(500);
  for (const solicitud of solicitudes) {
    // Convertida en alta: la atiende la rama de altas, no esta.
    if (solicitudAltaId(solicitud)) continue;
    if (solicitud.status !== 'Pendiente_Informacion') continue;

    const expiresAt = solicitud.payload?.[REVIEW_KEYS.tokenExpiresAt];
    const issuedAt =
      typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt))
        ? // El token se emite 7 días antes de vencer: esa es la fecha del pedido.
          new Date(Date.parse(expiresAt) - 7 * DAY_MS).toISOString()
        : solicitud.createdAt;

    const nudges = solicitud.payload?.[REVIEW_KEYS.nudges];
    const nudgesSent =
      nudges && typeof nudges === 'object' && typeof (nudges as { count?: unknown }).count === 'number'
        ? (nudges as { count: number }).count
        : 0;

    const plan = planNudge({ since: issuedAt, nudgesSent, now });
    if (plan.action === 'none') continue;

    const item: NudgeItem = {
      id: solicitud.id,
      source: 'registro',
      status: solicitud.status,
      action: plan.action,
      days: plan.days,
    };

    if (!dryRun) {
      try {
        if (plan.action === 'remind') {
          const resent = await resendSolicitudLink(solicitud.id);
          if (!resent.ok) throw new Error(resent.error ?? 'No se pudo reenviar el enlace.');
          item.emailSent = !!resent.email?.sent;
          const marked = await updateSolicitudReview(solicitud.id, {
            nudges: { count: nudgesSent + 1, lastAt: now.toISOString() },
          });
          if (!marked.ok) throw new Error(marked.error ?? 'No se pudo anotar el recordatorio.');
        } else {
          await closeSolicitud(solicitud);
        }
      } catch (error) {
        item.error = error instanceof Error ? error.message : 'Error inesperado.';
        report.errors.push(`registro ${solicitud.id}: ${item.error}`);
      }
    }

    report.solicitudes.push(item);
  }

  return report;
}
