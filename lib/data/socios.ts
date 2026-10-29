/**
 * Los socios en una sola lista.
 *
 * El panel tenía dos pantallas para la misma pregunta —«¿en qué quedó la
 * solicitud de esta corredora?»—: la bandeja de «Publicar» y el alta de
 * empresas. Ahora las dos se miran juntas, pero cada fila dice de dónde viene
 * porque el origen cambia lo que se puede hacer con ella:
 *
 * - `alta` es una solicitud de corredora o inmobiliaria que pasó por el motor de
 *   evaluación. Tiene puntaje, verificaciones y se mueve con decisiones, que
 *   disparan correos y tokens; el estado no se cambia a mano desde un selector.
 * - `registro` es el registro de un **agente independiente**, que no tiene
 *   empresa que verificar. Es una persona y el equipo lo mueve a mano.
 *
 * Un propietario que busca propuestas no es un socio: entra por «Publicar»
 * pidiendo que le compitan por su propiedad y vive en la sección de leads.
 *
 * Este módulo es puro (sin React, sin red) porque es donde un `kind` mal mapeado
 * se traduce en una fila en la columna equivocada del tablero.
 */

import type { KybApplication } from '@/lib/kyb/types';
import type { KybStatus } from '@/lib/kyb/status';
import type { Solicitud, SolicitudKind } from '@/lib/data/solicitudes';

/**
 * Las tres categorías con las que el equipo reparte el trabajo —corredoras,
 * inmobiliarias y agentes— más `empresa`, que agrupa a las altas que no
 * declararon cómo se registraron (las que llegan por la API directa). No se
 * mete en «corredora» para no inventar un dato que la solicitud no tiene.
 */
export type SocioCategory = 'corredora' | 'inmobiliaria' | 'agente' | 'empresa';

export const SOCIO_CATEGORY_LABELS: Record<SocioCategory, string> = {
  corredora: 'Corredora',
  inmobiliaria: 'Inmobiliaria',
  agente: 'Agente',
  empresa: 'Empresa sin tipo',
};

/** De dónde salió la fila; decide qué acciones ofrece la tarjeta. */
export type SocioSource = 'alta' | 'registro';

export interface SocioSolicitud {
  id: string;
  source: SocioSource;
  category: SocioCategory;
  status: KybStatus;
  /** Razón social de la empresa, o el nombre de la persona si es un agente. */
  name: string;
  contactName: string;
  email: string;
  phone: string;
  /** Solo las altas lo traen; el registro de agente no pide RUT de empresa. */
  rut: string | null;
  website: string | null;
  coverage: string | null;
  regions: string[];
  message: string | null;
  /** Puntaje del motor; `null` en los registros, que no se evalúan. */
  score: number | null;
  panelEnabled: boolean;
  createdAt: string;
}

/**
 * Los caminos de «Publicar» que son un socio.
 *
 * `propuestas` es el propietario que pide a los socios que le compitan por su
 * inmueble: no es un socio y vive en la sección de leads. Está en esta lista
 * —y no al revés— porque es la misma regla la que arma la bandeja y la que
 * cuenta el badge del menú: si el badge contara todo, «Solicitudes» avisaría
 * de propietarios que no están en la pantalla.
 */
export const SOCIO_SOLICITUD_KINDS = ['corredora', 'inmobiliaria', 'agente'] as const;

/** ¿Esta solicitud de «Publicar» es de un socio —o del propietario de un inmueble? */
export function isSocioKind(kind: SolicitudKind): kind is (typeof SOCIO_SOLICITUD_KINDS)[number] {
  return (SOCIO_SOLICITUD_KINDS as readonly string[]).includes(kind);
}

/** ¿Esta solicitud de «Publicar» va al panel de socios y no a los leads? */
export function isSocioSolicitud(solicitud: Solicitud): boolean {
  return isSocioKind(solicitud.kind);
}

function categoryFromRegistrationKind(kind: string | null): SocioCategory {
  return kind === 'corredora' || kind === 'inmobiliaria' ? kind : 'empresa';
}

export function socioFromApplication(application: KybApplication): SocioSolicitud {
  return {
    id: application.id,
    source: 'alta',
    category: categoryFromRegistrationKind(application.registrationKind),
    status: application.status,
    name: application.legalName,
    contactName: application.contactName,
    email: application.email,
    phone: application.phone,
    rut: application.rut,
    website: application.website,
    coverage: application.coverage,
    regions: application.regions,
    message: application.message,
    score: application.score,
    panelEnabled: application.panelEnabled,
    createdAt: application.createdAt,
  };
}

/**
 * Una solicitud de «Publicar» vista como socio.
 *
 * Solo se llama con un agente: los demás caminos no son socios y filtrarlos
 * acá evita que un propietario termine en el tablero si alguien cambia el
 * filtro de la página.
 */
export function socioFromSolicitud(solicitud: Solicitud): SocioSolicitud {
  return {
    id: solicitud.id,
    source: 'registro',
    category: 'agente',
    status: solicitud.status,
    name: solicitud.name,
    contactName: solicitud.name,
    email: solicitud.email,
    phone: solicitud.phone,
    rut: null,
    website: null,
    coverage: typeof solicitud.payload?.coverage === 'string' ? solicitud.payload.coverage : null,
    regions: Array.isArray(solicitud.payload?.regions) ? (solicitud.payload.regions as string[]) : [],
    message: solicitud.message,
    score: null,
    panelEnabled: false,
    createdAt: solicitud.createdAt,
  };
}

function timestamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Las dos fuentes en una lista, de la más reciente a la más vieja.
 *
 * El desempate es el `id`: dos solicitudes creadas en el mismo segundo —lo que
 * pasa en una prueba— no pueden cambiar de orden entre dos renders, o React
 * vuelve a montar las tarjetas y el campo que se estaba escribiendo se pierde.
 */
export function buildSocios(
  applications: readonly KybApplication[],
  solicitudes: readonly Solicitud[]
): SocioSolicitud[] {
  const socios = [
    ...applications.map(socioFromApplication),
    ...solicitudes.filter(isSocioSolicitud).map(socioFromSolicitud),
  ];

  return socios.sort((a, b) => {
    const byDate = timestamp(b.createdAt) - timestamp(a.createdAt);
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
}

export type SocioFilter = 'todas' | SocioCategory;

/** Conteo por categoría, con los ceros incluidos: los chips siempre son los mismos. */
export function socioCounts(socios: readonly SocioSolicitud[]): Record<SocioFilter, number> {
  const counts: Record<SocioFilter, number> = {
    todas: socios.length,
    corredora: 0,
    inmobiliaria: 0,
    agente: 0,
    empresa: 0,
  };

  for (const socio of socios) counts[socio.category] += 1;

  return counts;
}
