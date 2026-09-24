/**
 * Aperturas de los enlaces compartidos, y el informe que las cruza con los
 * contactos.
 *
 * La pregunta que responde esto no es «cuánta gente vio la página» sino **qué
 * enlaces traen interesados**: una corredora manda el mismo departamento por
 * WhatsApp a diez personas y necesita saber si conviene seguir por ahí.
 *
 * Por eso el informe cruza dos fuentes que existen por separado:
 *
 * - **Aperturas** (`public.share_views`): contadores agregados por propiedad y
 *   día. Cuentan enlaces abiertos, no personas — no hay IP ni identificador.
 * - **Contactos** (`public.leads`): ya guardan `partner_id`, `property_id` y el
 *   canal. No hubo que registrar nada nuevo para saber a quién le escribieron.
 *
 * Módulo puro: recibe lo que ya salió de la base y devuelve el informe armado,
 * así que las reglas (ventana, tasa, orden, a quién se atribuye cada cosa) se
 * prueban sin tocar Supabase.
 */

/** Fila de `public.share_views` tal como la devuelve Supabase. */
export interface ShareViewRow {
  property_id: string | null;
  day: string | null;
  partner_id: string | null;
  views: number | null;
}

/** Aperturas de una propiedad en un día. */
export interface ShareView {
  propertyId: string;
  /** Día UTC (`YYYY-MM-DD`), igual que la columna `day`. */
  day: string;
  partnerId: string | null;
  views: number;
}

export const SHARE_VIEW_COLUMNS = 'property_id,day,partner_id,views';

export function rowToShareView(row: ShareViewRow): ShareView | null {
  // Una fila sin id de propiedad o sin día no es contabilizable: descartarla es
  // preferible a inventarle una clave y ensuciar el informe.
  if (!row.property_id || !row.day) return null;

  return {
    propertyId: row.property_id,
    day: row.day.slice(0, 10),
    partnerId: row.partner_id ?? null,
    views: Math.max(0, Number(row.views) || 0),
  };
}

/** Lo mínimo que el informe necesita de un contacto (`Lead` lo cumple). */
export interface ShareLeadInput {
  propertyId: string | null;
  partnerId: string | null;
  createdAt: string;
}

export interface PartnerShareRow {
  /** `null` = contactos o aperturas sin corredora atribuida. */
  partnerId: string | null;
  /** Aperturas dentro de la ventana. */
  views: number;
  /** Aperturas desde siempre. */
  viewsTotal: number;
  contacts: number;
  contactsTotal: number;
  /**
   * Contactos por apertura (0–1), o `null` si no hubo ninguna apertura.
   *
   * `null` y `0` no son lo mismo: sin aperturas la tasa **no se puede calcular**
   * (división por cero disfrazada), y mostrar «0 %» diría que el enlace fracasó
   * cuando en realidad nunca se abrió.
   */
  contactRate: number | null;
  /** Cuántas propiedades distintas tuvieron actividad. */
  properties: number;
  /** Último día (UTC) con aperturas, dentro o fuera de la ventana. */
  lastViewDay: string | null;
}

export interface PropertyShareRow {
  propertyId: string;
  partnerId: string | null;
  views: number;
  viewsTotal: number;
  contacts: number;
  contactRate: number | null;
  lastViewDay: string | null;
}

export interface ShareReport {
  /** Días de la ventana, contando hoy. */
  windowDays: number;
  /** Primer día incluido en la ventana (`YYYY-MM-DD`, UTC). */
  since: string;
  totals: {
    views: number;
    viewsTotal: number;
    contacts: number;
    contactsTotal: number;
    contactRate: number | null;
    partners: number;
    properties: number;
  };
  partners: PartnerShareRow[];
  properties: PropertyShareRow[];
}

/** Día UTC (`YYYY-MM-DD`) de un instante. Mismo criterio que la columna `day`. */
export function utcDay(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Primer día de la ventana: «últimos N días, contando hoy».
 *
 * Se calcula sobre días UTC y no sobre horas, porque es la granularidad con la
 * que se guardan las aperturas y la única en la que las dos fuentes se pueden
 * comparar sin que un contacto de las 23:59 caiga de un lado y su apertura del
 * otro.
 */
export function windowStartDay(days: number, now: Date = new Date()): string {
  const span = Math.max(1, Math.floor(days));
  const start = new Date(now.getTime() - (span - 1) * 24 * 60 * 60 * 1000);
  return utcDay(start);
}

/** Tasa de contactos por apertura, o `null` si no hubo aperturas. */
export function contactRate(contacts: number, views: number): number | null {
  if (views <= 0) return null;
  return contacts / views;
}

function compareRows(
  a: { views: number; contacts: number; key: string },
  b: { views: number; contacts: number; key: string }
): number {
  // Lo que más se abrió primero; a igualdad de aperturas, lo que más contactos
  // generó. El desempate final es por clave para que el orden sea estable (dos
  // consultas iguales no deben reordenar la tabla).
  return b.views - a.views || b.contacts - a.contacts || a.key.localeCompare(b.key, 'es');
}

/**
 * Cruza aperturas y contactos en el informe que ve el equipo.
 *
 * @param views Aperturas crudas de `share_views`.
 * @param leads Contactos crudos de `leads`.
 * @param options.days Días de la ventana (por defecto 30).
 * @param options.now Instante de referencia, inyectable para poder probarlo.
 */
export function buildShareReport(
  views: ShareView[],
  leads: ShareLeadInput[],
  options: { days?: number; now?: Date } = {}
): ShareReport {
  const windowDays = Math.max(1, Math.floor(options.days ?? 30));
  const now = options.now ?? new Date();
  const since = windowStartDay(windowDays, now);

  const partners = new Map<string | null, PartnerShareRow>();
  const properties = new Map<string, PropertyShareRow>();

  const partnerRow = (partnerId: string | null): PartnerShareRow => {
    const existing = partners.get(partnerId);
    if (existing) return existing;
    const created: PartnerShareRow = {
      partnerId,
      views: 0,
      viewsTotal: 0,
      contacts: 0,
      contactsTotal: 0,
      contactRate: null,
      properties: 0,
      lastViewDay: null,
    };
    partners.set(partnerId, created);
    return created;
  };

  const propertyRow = (propertyId: string, partnerId: string | null): PropertyShareRow => {
    const existing = properties.get(propertyId);
    if (existing) {
      // Un contacto sin corredora no debe borrar la atribución de las aperturas.
      if (!existing.partnerId && partnerId) existing.partnerId = partnerId;
      return existing;
    }
    const created: PropertyShareRow = {
      propertyId,
      partnerId,
      views: 0,
      viewsTotal: 0,
      contacts: 0,
      contactRate: null,
      lastViewDay: null,
    };
    properties.set(propertyId, created);
    return created;
  };

  for (const view of views) {
    const partner = partnerRow(view.partnerId);
    const property = propertyRow(view.propertyId, view.partnerId);

    partner.viewsTotal += view.views;
    property.viewsTotal += view.views;

    if (!partner.lastViewDay || view.day > partner.lastViewDay) partner.lastViewDay = view.day;
    if (!property.lastViewDay || view.day > property.lastViewDay) property.lastViewDay = view.day;

    if (view.day >= since) {
      partner.views += view.views;
      property.views += view.views;
    }
  }

  for (const lead of leads) {
    const day = utcDay(lead.createdAt);
    const inWindow = !!day && day >= since;

    const partner = partnerRow(lead.partnerId);
    partner.contactsTotal += 1;
    if (inWindow) partner.contacts += 1;

    // Un contacto sin propiedad cuenta para la corredora pero no para ningún
    // enlace: atribuirlo a una propiedad sería inventar de dónde vino.
    if (lead.propertyId) {
      const property = propertyRow(lead.propertyId, lead.partnerId);
      property.contacts += 1;
    }
  }

  for (const row of Array.from(partners.values())) {
    row.contactRate = contactRate(row.contacts, row.views);
    row.properties = Array.from(properties.values()).filter((p) => p.partnerId === row.partnerId).length;
  }

  for (const row of Array.from(properties.values())) {
    row.contactRate = contactRate(row.contacts, row.views);
  }

  const partnerList = Array.from(partners.values()).sort((a, b) =>
    compareRows(
      { views: a.views, contacts: a.contacts, key: a.partnerId ?? '~' },
      { views: b.views, contacts: b.contacts, key: b.partnerId ?? '~' }
    )
  );

  const propertyList = Array.from(properties.values()).sort((a, b) =>
    compareRows(
      { views: a.views, contacts: a.contacts, key: a.propertyId },
      { views: b.views, contacts: b.contacts, key: b.propertyId }
    )
  );

  const totalsViews = partnerList.reduce((sum, p) => sum + p.views, 0);
  const totalsViewsAll = partnerList.reduce((sum, p) => sum + p.viewsTotal, 0);
  const totalsContacts = partnerList.reduce((sum, p) => sum + p.contacts, 0);
  const totalsContactsAll = partnerList.reduce((sum, p) => sum + p.contactsTotal, 0);

  return {
    windowDays,
    since,
    totals: {
      views: totalsViews,
      viewsTotal: totalsViewsAll,
      contacts: totalsContacts,
      contactsTotal: totalsContactsAll,
      contactRate: contactRate(totalsContacts, totalsViews),
      partners: partnerList.length,
      properties: propertyList.length,
    },
    partners: partnerList,
    properties: propertyList,
  };
}
