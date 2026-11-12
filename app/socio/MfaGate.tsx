'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import { loadClient } from '@/lib/supabase/client';

/**
 * Puerta del segundo factor del panel.
 *
 * Si la cuenta tiene 2FA activo y la sesión entró solo con el enlace del correo
 * (`aal1`), el panel no se muestra: se pide el código de la app y, al
 * verificarlo, la sesión pasa a `aal2` y se recarga. La validación de verdad
 * ocurre en el servidor —las rutas `/api/partner/*` devuelven 403 mientras
 * falte—, esto es la pantalla para resolverlo.
 *
 * Cuando no hay segundo factor, o ya está verificada la sesión, renderiza el
 * contenido tal cual: el socio que no lo activó no ve nada distinto.
 */

interface MfaStatus {
  enrolled: boolean;
  requiresChallenge: boolean;
  factorId: string | null;
}

export default function MfaGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/partner/mfa', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json().catch(() => null);
        return (body?.data as MfaStatus) ?? null;
      })
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!status?.factorId || busy) return;

    const clean = code.replace(/\s/g, '');
    if (clean.length < 6) {
      setError('El código tiene seis dígitos.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const supabase = await loadClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: status.factorId,
      });
      if (challengeError || !challenge) {
        throw new Error(challengeError?.message ?? 'No se pudo iniciar la verificación.');
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: status.factorId,
        challengeId: challenge.id,
        code: clean,
      });
      if (verifyError) {
        throw new Error('El código no es válido o ya expiró. Probá con el que muestra la app ahora.');
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Comprobando tu sesión…
      </div>
    );
  }

  if (!status?.requiresChallenge) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-black text-slate-900">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          Verificación en dos pasos
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Tu cuenta la tiene activa. Escribí el código de seis dígitos de tu aplicación de
          autenticación para entrar al panel.
        </p>

        <form onSubmit={verify} className="mt-4">
          <label
            htmlFor="mfa-code"
            className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Código de la app
          </label>
          <div className="mt-1 flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              id="mfa-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-lg tracking-[0.3em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="000000"
            />
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? 'Verificando…' : 'Entrar al panel'}
          </button>
        </form>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Si perdiste el acceso a la aplicación, escribinos y el equipo lo resuelve contigo.
        </p>
      </div>
    </div>
  );
}
