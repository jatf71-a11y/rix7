'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/components/auth/AuthProvider';
import { loadClient } from '@/lib/supabase/client';
import { describePasswordSignInError } from '@/lib/utils/authMessages';

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const labelClass = 'mb-1.5 block text-xs font-bold text-slate-700';

/**
 * Puerta del panel cuando todavía no hay sesión de administración.
 *
 * Se entra con **correo y contraseña**, no con el enlace al correo del portal:
 * el enlace depende de las Redirect URLs del proyecto Supabase y el proveedor
 * integrado está limitado a dos correos por hora, así que era un punto de falla
 * para la única cuenta que abre el panel. La contraseña no reemplaza el control
 * de acceso —la sesión sigue necesitando `app_metadata.role = 'admin'` y todas
 * las APIs y la RLS vuelven a exigirlo—, solo cambia cómo se autentica.
 *
 * Cuando la cuenta pasa a ser admin, `router.refresh()` vuelve a ejecutar el
 * layout en el servidor y entra al panel sin recargar toda la aplicación.
 */
export default function AdminLogin({ status }: { status: number }) {
  const { isAdmin, isLoading, user, signOut } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) router.refresh();
  }, [isAdmin, router]);

  const unavailable = status === 503;
  const wrongRole = status === 403;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);

    try {
      const supabase = await loadClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(describePasswordSignInError(signInError.message));
        return;
      }

      // La sesión ya está en las cookies: el layout de `/admin` la revalida en
      // el servidor y, si el rol es admin, muestra el panel.
      router.refresh();
    } catch (caught) {
      setError(describePasswordSignInError(caught));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <LockKeyhole className="h-6 w-6 text-slate-500" />
          </div>

          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
            Rix7 · Panel interno
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Acceso al panel</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Solo para la cuenta de administración de Rix7. Este espacio no está
            enlazado desde el sitio público.
          </p>
        </div>

        {unavailable ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            No se puede verificar la sesión en este entorno. Revisa{' '}
            <a href="/api/health" className="font-semibold underline">
              /api/health
            </a>
            .
          </div>
        ) : (
          <>
            {wrongRole && user && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                La cuenta <strong>{user.email}</strong> no tiene rol de administración.
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="mt-2 inline-flex items-center gap-1.5 font-semibold underline"
                >
                  <LogOut className="h-3 w-3" />
                  Cerrar sesión
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="admin-email" className={labelClass}>
                  Correo electrónico
                </label>
                <input
                  id="admin-email"
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@correo.com"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="admin-password" className={labelClass}>
                  Contraseña
                </label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Tu contraseña"
                  className={inputClass}
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={sending || isLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {sending ? 'Verificando…' : 'Entrar al panel'}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
              Si ya iniciaste sesión con la cuenta de administración, el panel se abre solo.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
