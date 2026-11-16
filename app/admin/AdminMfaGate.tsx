'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, LifeBuoy, Loader2, ShieldCheck } from 'lucide-react';

import { loadClient } from '@/lib/supabase/client';

/**
 * Puerta del segundo factor del panel del equipo.
 *
 * Es la cuenta que administra socios, planes y accesos: si tiene 2FA activo y la
 * sesión entró solo con el enlace del correo (`aal1`), el panel no se muestra
 * hasta escribir el código de la app. La validación real está en el servidor
 * (`requireAdmin` devuelve 403 `mfa_required`), esto es la pantalla para
 * resolverla.
 *
 * Y tiene la salida que el socio no necesita: **código de recuperación**. Si la
 * persona perdió el teléfono, entra con uno de sus diez códigos, el servidor lo
 * marca usado y le quita el factor para que pueda volver a enrolar. Sin esto, el
 * único camino sería que otro admin se lo resetee, y un equipo de una sola
 * persona quedaría afuera de su propio panel.
 */

interface MfaStatus {
  enrolled: boolean;
  requiresChallenge: boolean;
  factorId: string | null;
}

export default function AdminMfaGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/admin/mfa', { cache: 'no-store' })
      .then(async (response) => (response.ok ? (await response.json())?.data : null))
      .then((data) => {
        if (!cancelled) setStatus(data ?? null);
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

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/mfa/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: recovery }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? 'No se pudo usar el código.');
      }
      // El factor ya no existe: al recargar, la sesión deja de pedir `aal2`.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo usar el código.');
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
          Verificación en dos pasos del equipo
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Esta cuenta administra socios, planes y accesos. Escribí el código de seis dígitos de tu
          aplicación para continuar.
        </p>

        {mode === 'code' ? (
          <form onSubmit={verify} className="mt-4">
            <label
              htmlFor="admin-mfa-code"
              className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Código de la app
            </label>
            <div className="mt-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                id="admin-mfa-code"
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
        ) : (
          <form onSubmit={redeem} className="mt-4">
            <label
              htmlFor="admin-recovery-code"
              className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Código de recuperación
            </label>
            <div className="mt-1 flex items-center gap-2">
              <LifeBuoy className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                id="admin-recovery-code"
                value={recovery}
                onChange={(event) => setRecovery(event.target.value)}
                autoComplete="off"
                maxLength={20}
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-base uppercase tracking-[0.2em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="XXXX-XXXX"
              />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Cada código sirve una vez y quita el segundo factor para que puedas volver a
              activarlo con tu teléfono nuevo.
            </p>

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
              {busy ? 'Verificando…' : 'Usar el código'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'code' ? 'recovery' : 'code');
            setError(null);
          }}
          className="mt-3 text-[11px] font-semibold text-blue-700 hover:underline"
        >
          {mode === 'code' ? 'Perdí el teléfono: usar un código de recuperación' : 'Volver al código de la app'}
        </button>
      </div>
    </div>
  );
}
