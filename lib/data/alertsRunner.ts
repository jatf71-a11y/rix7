import type { Property } from '@/lib/types/property';
import { filterProperties } from './propertyFilters';
import { listCandidateProperties } from './propertySource';
import {
  describeSavedSearch,
  isNotifiable,
  savedSearchToParams,
  type SavedSearch,
} from './savedSearches';
import {
  getUserEmail,
  listSearchesToNotify,
  markSearchNotified,
} from './savedSearchesStore';
import { buildAlertEmail } from '@/lib/email/alertEmail';
import { sendEmail } from '@/lib/email/sendEmail';
import { isServiceRoleConfigured } from '@/lib/supabase/admin';

/**
 * Job de alertas de búsquedas guardadas.
 *
 * Recorre las búsquedas activas, busca propiedades publicadas desde el último
 * aviso que encajen con cada una y manda un correo. Nunca lanza: devuelve un
 * informe, porque lo corre un cron y un fallo silencioso es peor que un informe
 * con errores a la vista.
 *
 * Dos reglas que evitan el correo molesto:
 *
 * 1. **Primera corrida = línea base.** Si una búsqueda nunca fue avisada, se
 *    marca la fecha y no se manda nada: la persona acaba de ver esos resultados
 *    en pantalla; avisarle de lo mismo por correo sería ruido.
 * 2. **Si no se pudo enviar, no se avanza la fecha.** Así el aviso no se pierde:
 *    el próximo intento vuelve a ver las mismas propiedades.
 */

/** Máximo de propiedades listadas en un correo. */
const MAX_PROPERTIES_PER_EMAIL = 20;

export type AlertOutcome =
  | 'sent'
  | 'baseline'
  | 'no-matches'
  | 'no-recipient'
  | 'email-skipped'
  | 'error'
  | 'skipped';

export interface AlertRunEntry {
  searchId: string;
  label: string;
  outcome: AlertOutcome;
  matched: number;
  detail?: string;
}

export interface AlertRunReport {
  at: string;
  dryRun: boolean;
  /** De dónde salieron las propiedades evaluadas. */
  source: 'supabase' | 'catalog';
  searches: number;
  matched: number;
  sent: number;
  entries: AlertRunEntry[];
}

interface RunOptions {
  /** No envía ni modifica nada: solo informa qué pasaría. */
  dryRun?: boolean;
  /** Momento de referencia (inyectable para las pruebas). */
  now?: Date;
  siteUrl: string;
  /** Búsquedas y propiedades inyectables, para poder probar el job sin base. */
  searches?: SavedSearch[];
  properties?: Property[];
}

export async function runPropertyAlerts({
  dryRun = false,
  now = new Date(),
  siteUrl,
  searches,
  properties,
}: RunOptions): Promise<AlertRunReport> {
  const loaded = properties ? { properties, source: 'catalog' as const } : await listCandidateProperties();
  const candidates = loaded.properties;
  const activas = searches ?? (await listSearchesToNotify());

  const entries: AlertRunEntry[] = [];
  let matchedTotal = 0;
  let sent = 0;

  for (const search of activas) {
    if (!isNotifiable(search)) {
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'skipped',
        matched: 0,
        detail: 'Sin aviso activo o sin filtros que acoten la búsqueda.',
      });
      continue;
    }

    const params = savedSearchToParams(search.filters);
    const since = search.lastNotifiedAt ? new Date(search.lastNotifiedAt) : null;

    // En dry-run se ignora la fecha de corte a propósito: sirve para ver qué
    // mandaría hoy, que es lo que uno quiere comprobar antes de activarlo.
    const matched = filterProperties(candidates, params).filter((p) => {
      if (dryRun || !since) return true;
      // Sin fecha de creación no se puede saber si es nueva: se deja fuera para
      // no repetir una propiedad ya avisada.
      if (!p.created_at) return false;
      return new Date(p.created_at) > since;
    });

    if (!since && !dryRun) {
      // No se suma a `matched`: de estas propiedades no se avisa nada, y el
      // total del informe debe cuadrar con la suma del detalle.
      await markSearchNotified(search.id, now);
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'baseline',
        matched: 0,
        detail: 'Primera corrida: se fijó la línea base sin enviar correo.',
      });
      continue;
    }

    matchedTotal += matched.length;

    if (matched.length === 0) {
      if (!dryRun) await markSearchNotified(search.id, now);
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'no-matches',
        matched: 0,
      });
      continue;
    }

    const to = await getUserEmail(search.userId);
    if (!to) {
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'no-recipient',
        matched: matched.length,
        detail: 'No se pudo resolver el correo; no se avanza la fecha para reintentar.',
      });
      continue;
    }

    const email = buildAlertEmail({
      // La etiqueta se calcula al guardar; si faltara, se describe desde los
      // filtros para que el correo nunca salga sin decir qué búsqueda es.
      label: search.label || describeSavedSearch(search.filters),
      properties: matched.slice(0, MAX_PROPERTIES_PER_EMAIL),
      siteUrl,
    });

    if (dryRun) {
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'sent',
        matched: matched.length,
        detail: `Simulación: se enviaría «${email.subject}» a ${to}.`,
      });
      continue;
    }

    const result = await sendEmail({ to, ...email });

    if (result.sent) {
      sent += 1;
      await markSearchNotified(search.id, now);
      entries.push({
        searchId: search.id,
        label: search.label,
        outcome: 'sent',
        matched: matched.length,
      });
      continue;
    }

    entries.push({
      searchId: search.id,
      label: search.label,
      outcome: result.skipped ? 'email-skipped' : 'error',
      matched: matched.length,
      detail: result.error,
    });
  }

  return {
    at: now.toISOString(),
    dryRun,
    source: loaded.source,
    searches: activas.length,
    matched: matchedTotal,
    sent,
    entries,
  };
}

/** ¿Hay con qué correr el job? Sin clave de servicio no se puede leer entre usuarios. */
export function alertsJobConfigured(): boolean {
  return isServiceRoleConfigured();
}
