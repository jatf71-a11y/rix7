/**
 * ¿Hay un proyecto Supabase real detrás de este build?
 *
 * El proyecto funciona sin Supabase (catálogo y corredoras en memoria, panel en
 * modo de prueba), y para eso el código tiene que poder distinguir entre un
 * proyecto configurado y el placeholder que usa `.env.local`.
 *
 * Estaba repetido en cuatro lugares con la misma comparación; vive acá una sola
 * vez. Es apto para cliente y servidor: solo lee variables públicas.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!url && !!key && !url.includes('placeholder');
}
