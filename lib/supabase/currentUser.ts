import { createClient } from './server';
import { isSupabaseConfigured } from './config';

/**
 * Id de la persona que está usando el portal, o `null`.
 *
 * Lo comparten las rutas y las páginas de servidor que dependen de la sesión
 * (favoritos, búsquedas guardadas). Estaba duplicado en cada ruta; tener una
 * sola versión evita que una quede con un chequeo más laxo que las otras.
 *
 * Nunca lanza: si no hay Supabase configurado, si no hay sesión o si la lectura
 * falla, devuelve `null`. Quien llama decide qué decir (401 en una API, invitación
 * a entrar en una página).
 */
export async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
