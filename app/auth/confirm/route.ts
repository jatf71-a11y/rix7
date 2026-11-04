import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * `/auth/confirm` — canjea el enlace de acceso del correo por una sesión.
 *
 * Supabase devuelve los enlaces que genera el servidor con los tokens en el
 * **fragmento** (`#access_token=…`). El cliente de `@supabase/ssr` trabaja con
 * cookies y espera un `?code=` con su verificador, así que ese fragmento nunca
 * se canjeaba: el botón «Entrar al panel» del correo aterrizaba en `/socio` con
 * la persona todavía fuera, viendo la pantalla de acceso.
 *
 * Acá el `token_hash` llega como parámetro normal, se canjea en el servidor con
 * `verifyOtp` y la sesión queda escrita en las cookies —el mismo mecanismo que
 * usa el resto del panel—. Por eso el correo del alta apunta a esta ruta y no
 * al enlace que devuelve Supabase.
 *
 * Solo acepta `magiclink` y solo destinos internos: un `next` con host o
 * esquema propios convertiría la ruta en un redirector abierto.
 */

const DEFAULT_NEXT = '/socio';

/** Ruta interna de destino, o la del panel si lo que vino no lo es. */
function safeNext(value: string | null): string {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_NEXT;
  return value;
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

/**
 * Vuelve al destino con el error en la URL. El modal de acceso ya lee
 * `error`/`error_description` y lo muestra, así que un enlace vencido se explica
 * en vez de dejar a la persona en la pantalla de acceso sin motivo.
 */
function redirectWithError(request: NextRequest, next: string, description: string) {
  const url = new URL(next, request.nextUrl.origin);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', description);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') ?? 'magiclink';
  const next = safeNext(searchParams.get('next'));

  if (!tokenHash) {
    return redirectWithError(request, next, 'El enlace no trae el token de acceso.');
  }

  if (type !== 'magiclink') {
    return redirectWithError(request, next, 'El enlace no sirve para entrar.');
  }

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (error) return redirectWithError(request, next, error.message);
  } catch {
    return redirectWithError(
      request,
      next,
      'No pudimos verificar el enlace. Pide uno nuevo desde el acceso.'
    );
  }

  return redirectTo(request, next);
}
