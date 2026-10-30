import { createServiceRoleClient, isServiceRoleConfigured } from '@/lib/supabase/admin';
import {
  DEFAULT_PLAN_PRICING,
  PLAN_PRICING_KEY,
  normalizePlanPricing,
  type PlanPricingConfig,
} from '@/lib/kyb/planPricing';

/**
 * Persistencia de la configuración de precios de los planes.
 *
 * Una sola fila (`plan_settings` con `key = 'planes'`) guarda la base de cada
 * plan, el factor de cada perfil y los ajustes por celda. No es una tabla con
 * una columna por precio a propósito: la forma del dato cambia con el producto
 * (mañana un plan nuevo, un perfil más) y una fila JSON evita una migración por
 * cada cambio de catálogo. Lo que **no** se relaja es la validación: pasa por
 * `normalizePlanPricing` tanto al leer como al escribir, así una fila editada a
 * mano en Supabase no rompe la pantalla ni cobra un precio absurdo.
 *
 * La tabla está cerrada por RLS sin políticas (solo `service_role` la toca), y
 * este módulo usa justamente esa clave desde la ruta de administración. Sin
 * Supabase —o sin clave de servicio— se guarda en memoria del proceso para
 * poder probar el panel, y se dice que no es persistente: un precio que se
 * pierde al reiniciar no puede parecer guardado.
 */

export type PlanPricingSource = 'supabase' | 'memory' | 'default';

export interface PlanPricingRead {
  config: PlanPricingConfig;
  /** De dónde salió lo que se devuelve. */
  source: PlanPricingSource;
  /** false = un guardado se pierde al reiniciar el proceso. */
  persistent: boolean;
  /** Solo cuando hay algo que el equipo tiene que saber. */
  warning?: string;
}

export interface PlanPricingWrite {
  ok: boolean;
  persistent: boolean;
  error?: string;
}

/**
 * Respaldo en memoria para desarrollo sin base.
 *
 * En `globalThis` y no en una variable de módulo: cada ruta del servidor se
 * compila en su propio bundle, y la que guarda y la que lee tienen que ver el
 * mismo dato.
 */
const devStore = globalThis as typeof globalThis & {
  __rix7PlanPricing?: PlanPricingConfig;
};

export async function readPlanPricing(): Promise<PlanPricingRead> {
  if (!isServiceRoleConfigured()) {
    const stored = devStore.__rix7PlanPricing;
    return stored
      ? { config: stored, source: 'memory', persistent: false }
      : {
          config: DEFAULT_PLAN_PRICING,
          source: 'default',
          persistent: false,
          warning:
            'Supabase no está configurado (o falta la clave de servicio): los precios que se guarden acá no se conservan al reiniciar.',
        };
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('plan_settings')
      .select('value')
      .eq('key', PLAN_PRICING_KEY)
      .maybeSingle();

    if (error) {
      return {
        config: devStore.__rix7PlanPricing ?? DEFAULT_PLAN_PRICING,
        source: 'default',
        persistent: false,
        warning: `No se pudo leer la configuración guardada (${error.message}). Se muestran los precios de partida.`,
      };
    }

    if (!data) {
      // La tabla existe y todavía no hay fila: es el estado normal antes del
      // primer guardado, no un error.
      return { config: DEFAULT_PLAN_PRICING, source: 'default', persistent: true };
    }

    const parsed = normalizePlanPricing(data.value);
    if (!parsed.ok || !parsed.config) {
      return {
        config: DEFAULT_PLAN_PRICING,
        source: 'default',
        persistent: true,
        warning: `La configuración guardada no es válida (${parsed.error}). Se muestran los precios de partida.`,
      };
    }

    return { config: parsed.config, source: 'supabase', persistent: true };
  } catch (error) {
    return {
      config: devStore.__rix7PlanPricing ?? DEFAULT_PLAN_PRICING,
      source: 'default',
      persistent: false,
      warning: `No se pudo consultar la base (${
        error instanceof Error ? error.message : 'error desconocido'
      }). Se muestran los precios de partida.`,
    };
  }
}

export async function writePlanPricing(input: unknown): Promise<PlanPricingWrite> {
  const parsed = normalizePlanPricing(input);
  if (!parsed.ok || !parsed.config) {
    return { ok: false, persistent: false, error: parsed.error ?? 'Configuración inválida.' };
  }

  if (!isServiceRoleConfigured()) {
    devStore.__rix7PlanPricing = parsed.config;
    return { ok: true, persistent: false };
  }

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('plan_settings').upsert(
      {
        key: PLAN_PRICING_KEY,
        value: parsed.config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    if (error) {
      return { ok: false, persistent: true, error: `No se pudo guardar: ${error.message}` };
    }

    // Se guarda también en memoria: si la base falla en la próxima lectura, el
    // panel sigue mostrando lo último que el equipo dejó, no los precios viejos.
    devStore.__rix7PlanPricing = parsed.config;
    return { ok: true, persistent: true };
  } catch (error) {
    return {
      ok: false,
      persistent: true,
      error: error instanceof Error ? error.message : 'Error inesperado al guardar.',
    };
  }
}
