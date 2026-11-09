/**
 * Puente entre un registro de socio y su alta.
 *
 * El panel mezcla dos caminos y hasta acá el pipeline mentía: el registro de una
 * corredora, una inmobiliaria o un profesional independiente se evaluaba solo y
 * se detenía en `Aceptada`, mientras que la propuesta comercial, el token de
 * alta y el panel solo existían para las altas de empresa. Un socio que entraba
 * por el formulario público nunca llegaba a tener panel sin que alguien lo
 * creara a mano.
 *
 * Cuando el registro queda aprobado se crea la solicitud de alta equivalente, ya
 * en `Calificado` —la evaluación del formulario es la que decide—, y se guarda el
 * vínculo en el `payload` del registro. A partir de ahí el tablero muestra **una
 * sola** tarjeta: el alta, que es la que tiene propuesta, plan y panel.
 *
 * La conversión es idempotente por dos lados:
 *
 * 1. si el registro ya tiene `kyb_application_id`, se devuelve esa alta;
 * 2. la base tiene un índice único en `kyb_applications.solicitud_origen`, así
 *    que dos peticiones simultáneas no pueden duplicar la fila.
 *
 * No mueve estados ni manda correos: eso queda en el autómata, que es quien sabe
 * si el solicitante ya fue avisado.
 */

import {
  normalizeKybApplication,
  type KybApplicationInput,
  type NormalizedKybApplication,
} from '@/lib/kyb/application';
import type { KybStatus } from '@/lib/kyb/status';
import {
  createApplication,
  findApplicationBySolicitudOrigen,
  getApplication,
} from '@/lib/kyb/store';
import type { KybApplication } from '@/lib/kyb/types';
import { isSocioKind, solicitudAltaId } from './socios';
import { updateSolicitudReview } from './solicitudesStore';
import type { Solicitud } from './solicitudes';

/**
 * Estados en los que un registro ya es un alta.
 *
 * `Aceptada` es el primero: aprobar el registro es aprobar la empresa, y el
 * tramo comercial (propuesta → alta → operando) arranca de ahí. Los demás son
 * los que puede alcanzar el alta después de la conversión; si el vínculo se
 * perdió, el registro igual se reconoce como convertido.
 */
const ALTA_STATUSES: readonly KybStatus[] = [
  'Aceptada',
  'Calificado',
  'Propuesta_Comercial',
  'Alta',
  'Operando',
];

/** ¿Este registro ya debería tener su alta? */
export function needsAlta(solicitud: Solicitud): boolean {
  return (
    isSocioKind(solicitud.kind) &&
    ALTA_STATUSES.includes(solicitud.status) &&
    solicitudAltaId(solicitud) === null
  );
}

/**
 * Los datos del registro, en la forma que valida el alta.
 *
 * No se inventa nada: lo que el formulario no pidió —el RUT de una empresa sin
 * RUT, el sitio web— viaja vacío y `normalizeKybApplication` decide si alcanza.
 */
export function applicationInputFromSolicitud(solicitud: Solicitud): KybApplicationInput {
  const payload = solicitud.payload ?? {};
  return {
    legalName: solicitud.company ?? solicitud.name,
    rut: typeof payload.rut === 'string' ? payload.rut : '',
    website: typeof payload.website === 'string' ? payload.website : '',
    email: solicitud.email,
    contactName: solicitud.name,
    phone: solicitud.phone,
    consent: true,
    coverage: payload.coverage,
    regions: payload.regions,
    message: solicitud.message ?? '',
    registrationKind: solicitud.kind,
    contactRole: typeof payload.role === 'string' ? payload.role : '',
    // El alta hereda lo que el registro declaró: si la persona dijo «no tengo
    // sitio», el panel no puede volver a pedirle el dominio como si faltara.
    hasWebsite:
      payload.hasWebsite === false ? false : payload.hasWebsite === true ? true : null,
    hasCompanyEmail:
      payload.hasCompanyEmail === false
        ? false
        : payload.hasCompanyEmail === true
          ? true
          : null,
  };
}

/** Normaliza el registro como solicitud de alta, sin tocar la base. */
export function highFromSolicitud(
  solicitud: Solicitud
): { ok: true; application: NormalizedKybApplication } | { ok: false; error: string } {
  const normalized = normalizeKybApplication(applicationInputFromSolicitud(solicitud));
  if (!normalized.ok) return normalized;
  return { ok: true, application: normalized.application };
}

export interface EnsureAltaResult {
  ok: boolean;
  application?: KybApplication;
  /** `true` solo la primera vez: es lo que distingue avisar de repetir. */
  created?: boolean;
  /** Por qué no se pudo convertir, en términos que el panel pueda mostrar. */
  error?: string;
  code?: 'invalid' | 'store';
}

/**
 * Crea (o reutiliza) el alta de un registro ya aprobado.
 *
 * Un fallo acá no debe romper la aprobación: el registro ya quedó en su estado y
 * el equipo lo ve en el panel. Se devuelve el error para que el llamador lo
 * muestre como advertencia y pueda reintentar desde «Re-evaluar».
 */
export async function ensureAltaForSolicitud(solicitud: Solicitud): Promise<EnsureAltaResult> {
  const existingId = solicitudAltaId(solicitud);
  if (existingId) {
    const found = await getApplication(existingId);
    if (found.ok && found.data) return { ok: true, application: found.data, created: false };
  }

  const byOrigin = await findApplicationBySolicitudOrigen(solicitud.id);
  if (byOrigin.ok && byOrigin.data) {
    // El alta existe pero el vínculo no se guardó: se repara acá para que el
    // panel no muestre las dos filas.
    await updateSolicitudReview(solicitud.id, { altaApplicationId: byOrigin.data.id });
    return { ok: true, application: byOrigin.data, created: false };
  }
  if (!byOrigin.ok) {
    return { ok: false, code: 'store', error: byOrigin.error ?? 'No se pudo leer el alta.' };
  }

  const high = highFromSolicitud(solicitud);
  if (!high.ok) {
    return {
      ok: false,
      code: 'invalid',
      error: `El registro no tiene los datos mínimos para el alta: ${high.error}`,
    };
  }

  const created = await createApplication(high.application, {
    status: 'Calificado',
    solicitudOrigen: solicitud.id,
  });
  if (!created.ok || !created.data) {
    return {
      ok: false,
      code: 'store',
      error: created.error ?? 'No se pudo crear el alta.',
    };
  }

  // Si esta escritura falla, la próxima corrida encuentra el alta por su origen
  // (`findApplicationBySolicitudOrigen`) y repara el vínculo. El alta ya existe:
  // no se borra nada por un error de anotación.
  const linked = await updateSolicitudReview(solicitud.id, {
    altaApplicationId: created.data.id,
  });
  if (!linked.ok) {
    console.warn('[socios] alta creada sin vínculo en el registro:', linked.error);
  }

  return { ok: true, application: created.data, created: true };
}

