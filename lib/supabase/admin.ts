import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente con **clave de servicio**.
 *
 * Solo lo usa el job de alertas, que tiene que leer las búsquedas guardadas de
 * **todas** las personas y el correo de cada una. Las políticas RLS lo impiden a
 * propósito (`auth.uid() = user_id`), así que ese trabajo no puede hacerse con
 * la clave anónima.
 *
 * Dos consecuencias que conviene tener presentes:
 *
 * 1. Esta clave **salta RLS por completo**: nunca debe llegar al navegador ni a
 *    un componente de cliente, y por eso este módulo solo se importa desde rutas
 *    de servidor.
 * 2. No se puede usar la `NEXT_PUBLIC_` para ella: el nombre de la variable
 *    (`SUPABASE_SERVICE_ROLE_KEY`) no lleva el prefijo justamente para que Next
 *    no la exponga.
 */

export function isServiceRoleConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!url && !!key && !url.includes('placeholder');
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    /**
     * Lecturas **siempre frescas**.
     *
     * Next cachea los `fetch` GET por URL, y estas consultas son la misma URL
     * para todos los que preguntan (`…?status=eq.Pendiente_Informacion`): sin
     * esto, la página del token servía la lista de pendientes de la primera
     * visita. En producción se vio así: un enlace ya respondido seguía abriendo
     * el formulario, y un token recién emitido no habría aparecido. Son datos
     * con estado (tokens, decisiones, duplicados): no hay nada que cachear.
     */
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
