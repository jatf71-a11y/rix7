/**
 * Actividad de los enlaces de una corredora: compartidos, aperturas y contactos.
 *
 * El informe de `/admin/landings` mira todo el portal; este mira **una**
 * corredora y responde lo que necesita para decidir qué seguir mandando:
 *
 * - **Por enlace**: cuántas veces compartió cada propiedad, cuántas veces se
 *   abrió su landing y cuántos contactos generó.
 * - **Por canal**: WhatsApp, copiar enlace, compartir nativo y tarjeta. Para
 *   atribuir contactos a un canal se usa **último toque**: cada contacto se le
 *   asigna al compartido más reciente del mismo enlace anterior a su alta. Es
 *   una atribución honesta y explicable, no una certeza: si el enlace se movió
 *   por WhatsApp y después por correo, el contacto va al último canal usado.
 *
 * La **conversión** es siempre `contactos / compartidos`, tanto por enlace como
 * por canal, para que las dos tablas se lean igual. `null` no es 0 %: sin
 * compartidos la tasa no se puede calcular y mostrarla como 0 % diría que el
 * enlace fracasó cuando en realidad nunca se movió.
 *
 * Módulo puro: recibe lo que ya salió de la base y devuelve el informe armado,
 * así que las reglas (ventana, atribución, orden) se prueban sin Supabase.
 */

import { SHARE_CHANNELS, type ShareChannel, type ShareEvent } from './shareEvents';
import {
  LEAD_CHANNELS,
  LEAD_SOURCES,
  type Lead,
  type LeadChannel,
  type LeadSource,
} from './leads';
import { utcDay, windowStartDay, type ShareView } from './shareViews';

export interface PartnerLinkRow {
  propertyId: string;
  /** Compartidos dentro de la ventana. */
  shares: number;
  /** Aperturas dentro de la ventana (las landing abiertas). */
  views: number;
  /** Contactos dentro de la ventana. */
  contacts: number;
  /** Contactos / compartidos, o `null` si no hubo compartidos. */
  conversion: number | null;
}

export interface PartnerChannelRow {
  channel: ShareChannel;
  shares: number;
  /**
   * Contactos atribuidos a este canal por último toque (el compartido más
   * reciente del mismo enlace antes del contacto).
   */
  contacts: number;
  /** Contactos atribuidos / compartidos, o `null` sin compartidos. */
  conversion: number | null;
}

export interface PartnerEngagement {
  /** Días de la ventana, contando hoy. */
  windowDays: number;
  /** Primer día incluido en la ventana (`YYYY-MM-DD`, UTC). */
  since: string;
  totals: {
    shares: number;
    views: number;
    contacts: number;
    /** Contactos / compartidos, o `null` sin compartidos. */
    conversion: number | null;
    /** Contactos que se pudieron atribuir a un compartido previo. */
    attributedContacts: number;
    /** Contactos sin compartido previo del mismo enlace. */
    unattributedContacts: number;
    /** Enlaces (propiedades) con alguna actividad en la ventana. */
    properties: number;
  };
  /** Una fila por enlace, lo que más contactos generó primero. */
  byLink: PartnerLinkRow[];
  /** Solo los canales con actividad, el que más se usó primero. */
  byChannel: PartnerChannelRow[];
  /** Contactos por canal de contacto (formulario, WhatsApp, llamada, correo). */
  contactChannels: Array<{ channel: LeadChannel; count: number }>;
  /** Contactos por superficie donde se dejaron (ficha / landing). */
  contactSources: Array<{ source: LeadSource; count: number }>;
  /** Compartidos de la ventana, del más reciente al más antiguo. */
  recentShares: ShareEvent[];
  /** Contactos de la ventana, del más reciente al más antiguo. */
  recentContacts: Lead[];
}

/** Cociente protegido: sin denominador no hay tasa, no hay «0 %». */
function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

/** Instante en milisegundos, o `null` si la fecha no se puede leer. */
function timeOf(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Compartido más reciente de un enlace anterior al contacto. */
function lastShareBefore(events: ShareEvent[], leadTime: number): ShareEvent | null {
  let latest: ShareEvent | null = null;
  let latestTime = -Infinity;

  for (const event of events) {
    const time = timeOf(event.createdAt);
    if (time === null || time > leadTime || time < latestTime) continue;
    latest = event;
    latestTime = time;
  }

  return latest;
}

function contactsByChannel(leads: Lead[]): PartnerEngagement['contactChannels'] {
  return LEAD_CHANNELS.map((channel) => ({
    channel,
    count: leads.filter((lead) => lead.channel === channel).length,
  }));
}

function contactsBySource(leads: Lead[]): PartnerEngagement['contactSources'] {
  return LEAD_SOURCES.map((source) => ({
    source,
    count: leads.filter((lead) => lead.source === source).length,
  }));
}

/**
 * Arma el informe de una corredora.
 *
 * @param input.views Aperturas de `share_views` (ya acotadas a la corredora).
 * @param input.leads Contactos de `leads` de la corredora.
 * @param input.events Compartidos de `share_events` de la corredora. Deben
 *   traer, al menos, los de la ventana; los anteriores sirven para atribuir un
 *   contacto que llegó después de que el enlace dejara de compartirse.
 * @param input.days Días de la ventana (por defecto 30).
 * @param input.now Instante de referencia, inyectable para poder probarlo.
 */
export function buildPartnerEngagement(
  input: {
    views: ShareView[];
    leads: Lead[];
    events: ShareEvent[];
  },
  options: { days?: number; now?: Date } = {}
): PartnerEngagement {
  const windowDays = Math.max(1, Math.floor(options.days ?? 30));
  const since = windowStartDay(windowDays, options.now ?? new Date());

  const inWindow = (value: string): boolean => {
    const day = utcDay(value);
    return !!day && day >= since;
  };

  // Compartidos: los de la ventana alimentan las tablas; **todos** los recibidos
  // participan de la atribución, porque un contacto puede llegar días después
  // del último envío del enlace.
  const sharesInWindow = input.events.filter((event) => inWindow(event.createdAt));
  const eventsByProperty = new Map<string, ShareEvent[]>();
  for (const event of input.events) {
    const list = eventsByProperty.get(event.propertyId);
    if (list) list.push(event);
    else eventsByProperty.set(event.propertyId, [event]);
  }

  const viewsInWindow = input.views.filter((view) => view.day >= since);
  const leadsInWindow = input.leads.filter((lead) => inWindow(lead.createdAt));

  const links = new Map<string, PartnerLinkRow>();
  const linkRow = (propertyId: string): PartnerLinkRow => {
    const existing = links.get(propertyId);
    if (existing) return existing;
    const created: PartnerLinkRow = {
      propertyId,
      shares: 0,
      views: 0,
      contacts: 0,
      conversion: null,
    };
    links.set(propertyId, created);
    return created;
  };

  for (const view of viewsInWindow) linkRow(view.propertyId).views += view.views;
  for (const event of sharesInWindow) linkRow(event.propertyId).shares += 1;
  for (const lead of leadsInWindow) {
    if (lead.propertyId) linkRow(lead.propertyId).contacts += 1;
  }

  // Atribución por último toque: un canal solo recibe el contacto si hay un
  // compartido previo del mismo enlace. Los demás se informan aparte, sin
  // repartirlos a la fuerza entre canales.
  const channelRows = new Map<ShareChannel, PartnerChannelRow>();
  const channelRow = (channel: ShareChannel): PartnerChannelRow => {
    const existing = channelRows.get(channel);
    if (existing) return existing;
    const created: PartnerChannelRow = { channel, shares: 0, contacts: 0, conversion: null };
    channelRows.set(channel, created);
    return created;
  };

  for (const event of sharesInWindow) channelRow(event.channel).shares += 1;

  let unattributedContacts = 0;
  let attributedContacts = 0;

  for (const lead of leadsInWindow) {
    const leadTime = timeOf(lead.createdAt);
    if (!lead.propertyId || leadTime === null) {
      unattributedContacts += 1;
      continue;
    }

    const prior = lastShareBefore(eventsByProperty.get(lead.propertyId) ?? [], leadTime);
    if (prior) {
      channelRow(prior.channel).contacts += 1;
      attributedContacts += 1;
    } else {
      unattributedContacts += 1;
    }
  }

  const byLink = Array.from(links.values());
  for (const row of byLink) row.conversion = ratio(row.contacts, row.shares);
  byLink.sort(
    (a, b) =>
      b.contacts - a.contacts ||
      b.shares - a.shares ||
      b.views - a.views ||
      a.propertyId.localeCompare(b.propertyId, 'es')
  );

  // Se ordenan por orden de canal y no por actividad: la tabla se lee siempre
  // igual entre visitas y no salta de renglón cuando cambia un contador.
  const byChannel = SHARE_CHANNELS.map((channel) => channelRows.get(channel))
    .filter((row): row is PartnerChannelRow => !!row && (row.shares > 0 || row.contacts > 0))
    .map((row) => ({ ...row, conversion: ratio(row.contacts, row.shares) }));

  const recentShares = [...sharesInWindow].sort(
    (a, b) => (timeOf(b.createdAt) ?? 0) - (timeOf(a.createdAt) ?? 0)
  );
  const recentContacts = [...leadsInWindow].sort(
    (a, b) => (timeOf(b.createdAt) ?? 0) - (timeOf(a.createdAt) ?? 0)
  );

  const totalsShares = sharesInWindow.length;
  const totalsViews = viewsInWindow.reduce((sum, view) => sum + view.views, 0);
  const totalsContacts = leadsInWindow.length;

  return {
    windowDays,
    since,
    totals: {
      shares: totalsShares,
      views: totalsViews,
      contacts: totalsContacts,
      conversion: ratio(totalsContacts, totalsShares),
      attributedContacts,
      unattributedContacts,
      properties: byLink.length,
    },
    byLink,
    byChannel,
    contactChannels: contactsByChannel(leadsInWindow),
    contactSources: contactsBySource(leadsInWindow),
    recentShares,
    recentContacts,
  };
}

