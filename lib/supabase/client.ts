import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase del navegador, cargado **cuando hace falta**.
 *
 * El SDK pesa ~66 kB gzip y hasta ahora viajaba en el bundle inicial de todas
 * las páginas —incluidas la home y la ficha, donde la mayoría de las visitas no
 * tiene sesión— porque `AuthProvider` lo importaba de forma estática desde el
 * layout raíz. Con `import()` el código queda en un chunk aparte: se descarga
 * recién cuando hay una sesión que consultar o cuando alguien abre el acceso.
 *
 * Una sola instancia por página: el proveedor, el modal y quien llame después
 * comparten esta promesa. Dos clientes sobre el mismo storage se pisarían los
 * eventos de sesión.
 */

let pending: Promise<SupabaseClient> | null = null;

export function loadClient(): Promise<SupabaseClient> {
  if (!pending) {
    pending = import('@supabase/ssr').then(({ createBrowserClient }) => {
      const supabaseUrl =
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
      const supabaseAnonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

      return createBrowserClient(supabaseUrl, supabaseAnonKey);
    });
  }
  return pending;
}

/** Olvida el cliente cargado. Solo para los tests. */
export function resetClientForTests(): void {
  pending = null;
}
