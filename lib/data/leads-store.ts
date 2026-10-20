import { isSupabaseConfigured } from '@/lib/supabase/config';
import { LEAD_COLUMNS, rowToLead, type Lead, type LeadRow, type NormalizedLead } from './leads';

/**
 * Contactos de visitas interesadas.
 *
 * - El **alta es pública**: la visita no tiene cuenta, así que se escribe con el
 *   cliente sin cookies y lo permite la política RLS de inserción.
 * - La **lectura es del equipo**: exige rol admin, por lo que usa el cliente con
 *   la sesión del usuario para que el JWT lleve su rol.
 * - Sin Supabase configurado, los contactos se guardan en memoria del proceso
 *   para poder probar el panel, marcados como no persistentes. Perder un
 *   contacto en producción es peor que no tener el dato: en ese caso se avisa.
 */

export interface LeadWriteResult {
  ok: boolean;
  persisted: boolean;
  error?: string;
}

export interface LeadListResult {
  leads: Lead[];
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: lo guardado se pierde al reiniciar */
  persistent: boolean;
}

/**
 * Respaldo en memoria, solo para desarrollo sin Supabase.
 *
 * Vive en `globalThis` y no en variables de módulo porque en Next cada ruta del
 * servidor compila su propio bundle: una variable de módulo deja de ser un solo
 * dato. La ruta que **deja** el contacto (`/api/leads`) y la que lo **lee**
 * (`/api/leads` y el informe de enlaces) tendrían cada una su lista, y en
 * desarrollo los contactos recién dejados no aparecerían en el panel.
 */
const devStore = globalThis as typeof globalThis & {
  __rix7DevLeads?: Lead[];
  __rix7DevLeadCounter?: number;
};

function readDevLeads(): Lead[] {
  devStore.__rix7DevLeads ??= [];
  return devStore.__rix7DevLeads;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/** Alta de un contacto ya validado por `normalizeLead`. */
export async function createLead(lead: NormalizedLead): Promise<LeadWriteResult> {
  if (!isSupabaseConfigured()) {
    devStore.__rix7DevLeadCounter = (devStore.__rix7DevLeadCounter ?? 0) + 1;
    devStore.__rix7DevLeads = [
      {
        id: `memoria-${devStore.__rix7DevLeadCounter}`,
        propertyId: lead.property_id,
        partnerId: lead.partner_id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        channel: lead.channel,
        source: lead.source,
        message: lead.message,
        createdAt: new Date().toISOString(),
      },
      ...readDevLeads(),
    ];

    return { ok: true, persisted: false };
  }

  try {
    const supabase = await publicClient();
    const { error } = await supabase.from('leads').insert({
      property_id: lead.property_id,
      partner_id: lead.partner_id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      channel: lead.channel,
      source: lead.source,
      message: lead.message,
    });

    if (error) return { ok: false, persisted: true, error: error.message };

    return { ok: true, persisted: true };
  } catch (error) {
    return {
      ok: false,
      persisted: true,
      error: error instanceof Error ? error.message : 'Error inesperado al guardar el contacto.',
    };
  }
}

/**
 * Contactos de **una** corredora, para su panel.
 *
 * Es una lectura distinta de `listLeads` (que es del equipo y ve todo el
 * portal): acá el filtro por `partner_id` es obligatorio y va además de la RLS,
 * igual que en `listPartnerPublications`. Así una cuenta de socio no puede ver
 * los contactos de otra aunque una política mal configurada lo permitiera.
 *
 * La migración `0017_socio_actividad` habilita la lectura de estos contactos
 * para el rol `member` cuando la fila es de su corredora; sin ella la RLS los
 * oculta y el panel muestra cero actividad en vez de un error.
 */
export async function listPartnerLeads(
  partnerId: string,
  limit = 500
): Promise<LeadListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_COLUMNS)
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return {
          leads: (data as LeadRow[]).map(rowToLead),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return {
    leads: readDevLeads()
      .filter((lead) => lead.partnerId === partnerId)
      .slice(0, limit),
    source: 'memory',
    persistent: false,
  };
}

/** Listado para el panel, del más reciente al más antiguo. */
export async function listLeads(limit = 200): Promise<LeadListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return {
          leads: (data as LeadRow[]).map(rowToLead),
          source: 'supabase',
          persistent: true,
        };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que será poco o nada.
    }
  }

  return { leads: readDevLeads().slice(0, limit), source: 'memory', persistent: false };
}

