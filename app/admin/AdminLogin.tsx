'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * Puerta del panel cuando todavía no hay sesión de administración.
 *
 * Vive dentro de `app/admin/layout.tsx`, pero fuera del shell: si el guard no
 * deja pasar, no se muestra ninguna sección del panel, solo esta tarjeta. El
 * acceso al panel sigue siendo el mismo modal de cuenta del portal; lo que
 * cambia es que ahora el panel tiene una URL propia y aquí se explica.
 *
 * Cuando la cuenta pasa a ser admin, `router.refresh()` vuelve a ejecutar el
 * layout en el servidor y entra al panel sin recargar toda la aplicación.
 */
export default function AdminLogin({ status }: { status: number }) {
  const { openAuthModal, isAdmin, isLoading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAdmin) router.refresh();
  }, [isAdmin, router]);

  const unavailable = status === 503;
  const wrongRole = status === 403;

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <LockKeyhole className="h-6 w-6 text-slate-500" />
        </div>

        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
          Rix7 · Panel interno
        </p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Acceso al panel</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Este espacio es solo para la cuenta de administración de Rix7. No está
          enlazado desde el sitio público.
        </p>

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
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                La cuenta <strong>{user.email}</strong> no tiene rol de administración.
              </p>
            )}

            <button
              type="button"
              onClick={() => openAuthModal('entrar al panel de administración')}
              disabled={isLoading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" />
              {user ? 'Cambiar de cuenta' : 'Entrar con mi cuenta'}
            </button>

            <p className="mt-3 text-[11px] text-slate-400">
              Si ya iniciaste sesión, espera un momento: el panel se abre solo.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
