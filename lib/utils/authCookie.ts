/**
 * ¿Esta visita trae una sesión de Supabase en las cookies?
 *
 * Es la señal que evita descargar el SDK de Supabase (~66 kB gzip) para
 * averiguar que nadie inició sesión. La comprobación tiene que ser **tolerante**
 * porque el nombre exacto depende del proyecto y del formato del token:
 *
 * - `sb-<ref>-auth-token` — la cookie de sesión normal;
 * - `sb-<ref>-auth-token.0`, `.1`, … — el mismo token partido cuando no cabe en
 *   una cookie (sesiones con muchos claims);
 * - `sb-<ref>-auth-token-code-verifier` — el testigo del flujo OAuth, que también
 *   significa «esta visita viene de un acceso» y conviene atender.
 *
 * Ante la duda se responde que sí: un falso positivo cuesta cargar el SDK, y un
 * falso negativo costaría mostrar a una persona con sesión como si no la
 * tuviera. Si la cookie no delataba la sesión, abrir el acceso la recupera.
 */
export function hasAuthSessionCookie(cookieString: string): boolean {
  return String(cookieString ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const name = part.split('=')[0] ?? '';
      return name.startsWith('sb-') && name.includes('auth-token');
    });
}

/**
 * ¿Corresponde cargar el SDK de Supabase para resolver la sesión?
 *
 * Solo en un proyecto real **y** con una sesión a la vista. Es la regla que se
 * aplica al montar el portal: la home, la ficha y el listado son visitas
 * anónimas casi siempre, y ahí el SDK no tiene nada que averiguar.
 */
export function shouldLoadSession({
  configured,
  cookieString,
}: {
  configured: boolean;
  cookieString: string;
}): boolean {
  return configured && hasAuthSessionCookie(cookieString);
}
