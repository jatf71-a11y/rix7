import { isSupabaseConfigured } from '@/lib/supabase/config';
import { SHARE_VIEW_COLUMNS, rowToShareView, type ShareView, type ShareViewRow } from './shareViews';

/**
 * Aperturas de los enlaces compartidos.
 *
 * - El **alta es pública**: quien abre el enlace no tiene cuenta. Se hace con la
 *   RPC `increment_share_view`, que es `SECURITY DEFINER` y solo suma de a uno,
 *   así que la tabla no necesita política de escritura.
 * - La **lectura es del equipo**: exige rol admin por la política RLS de la
 *   tabla, así que usa el cliente con la sesión del usuario.
 * - Sin Supabase configurado, las aperturas se cuentan en memoria del proceso
 *   para poder ver el informe funcionando. Se **pierden al reiniciar**, y el
 *   panel lo avisa en pantalla en lugar de mostrar un informe que parece real.
 */

export interface ShareViewWriteResult {
  ok: boolean;
  persisted: boolean;
  error?: string;
}

export interface ShareViewListResult {
  views: ShareView[];
  source: 'supabase' | 'memory';
  /** false = desarrollo sin Supabase: lo contado se pierde al reiniciar. */
  persistent: boolean;
}

/**
 * Respaldo en memoria, solo para desarrollo sin Supabase.
 *
 * Vive en `globalThis` y no en una variable de módulo por un motivo concreto:
 * en Next cada ruta del servidor compila su propio bundle, así que una variable
 * de módulo deja de ser un solo dato. La ruta que **cuenta** (`/api/share/view`)
 * y la que **informa** (`/api/admin/share-report`) tendrían cada una su lista, y
 * el informe saldría siempre vacío aunque las aperturas se estén contando. El
 * objeto global sí es el mismo proceso.
 *
 * En producción el estado real está en Supabase y esto no se usa.
 */
const devStore = globalThis as typeof globalThis & { __rix7DevShareViews?: ShareView[] };

function readDevViews(): ShareView[] {
  devStore.__rix7DevShareViews ??= [];
  return devStore.__rix7DevShareViews;
}

async function publicClient() {
  const { createPublicClient } = await import('@/lib/supabase/server');
  return createPublicClient();
}

async function sessionClient() {
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

/**
 * Suma una apertura.
 *
 * No recibe cuánto sumar: la RPC incrementa el contador de hoy en uno. Es a
 * propósito — con un valor a elección, un cliente podría fijar el número que
 * quisiera. Aun así un contador público no es inmanipulable (se puede llamar
 * muchas veces); sirve para decidir qué enlace conviene seguir usando, no para
 * facturar.
 */
export async function recordShareView(
  propertyId: string,
  partnerId: string | null
): Promise<ShareViewWriteResult> {
  if (!isSupabaseConfigured()) {
    const day = new Date().toISOString().slice(0, 10);
    const views = readDevViews();
    const existing = views.find((v) => v.propertyId === propertyId && v.day === day);
    if (existing) {
      existing.views += 1;
      // Se completa la atribución si faltaba, igual que hace la RPC.
      existing.partnerId ??= partnerId;
    } else {
      devStore.__rix7DevShareViews = [{ propertyId, day, partnerId, views: 1 }, ...views];
    }
    return { ok: true, persisted: false };
  }

  try {
    const supabase = await publicClient();
    const { error } = await supabase.rpc('increment_share_view', {
      p_property_id: propertyId,
      p_partner_id: partnerId,
    });

    if (error) return { ok: false, persisted: true, error: error.message };
    return { ok: true, persisted: true };
  } catch (error) {
    return {
      ok: false,
      persisted: true,
      error: error instanceof Error ? error.message : 'Error inesperado al registrar la apertura.',
    };
  }
}

/**
 * Aperturas de los últimos `days` días, para armar el informe.
 *
 * Trae solo la ventana que el panel va a mostrar: el total histórico lo calcula
 * el panel a partir de lo que devuelve esta consulta, y pedir años de filas
 * diarias para mostrar un mes sería traer de más.
 */
export async function listShareViews(days = 180): Promise<ShareViewListResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await sessionClient();
      const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await supabase
        .from('share_views')
        .select(SHARE_VIEW_COLUMNS)
        .gte('day', since)
        .order('day', { ascending: false })
        .limit(5000);

      if (!error && data) {
        const views = (data as ShareViewRow[])
          .map(rowToShareView)
          .filter((v): v is ShareView => v !== null);
        return { views, source: 'supabase', persistent: true };
      }
    } catch {
      // Supabase caído: se muestra lo que haya en memoria, que suele ser nada.
    }
  }

  return { views: readDevViews(), source: 'memory', persistent: false };
}

