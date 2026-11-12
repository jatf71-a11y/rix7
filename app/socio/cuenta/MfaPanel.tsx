'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

import { loadClient } from '@/lib/supabase/client';

/**
 * Seguridad de la cuenta: activar o desactivar la verificación en dos pasos.
 *
 * El enrolamiento es el de Supabase Auth (TOTP): se genera el secreto, la app
 * lo lee del QR (o del código de respaldo que se muestra al lado) y se confirma
 * con un código. Recién ahí el factor queda `verified` y el panel empieza a
 * pedirlo al entrar.
 *
 * Desactivar exige una sesión ya verificada en esta sesión del navegador, que es
 * lo que garantiza Supabase: no se puede apagar el segundo factor desde una
 * sesión que no lo pasó.
 */

interface MfaStatus {
  enrolled: boolean;
  requiresChallenge: boolean;
  factorId: string | null;
}

interface EnrolledFactor {
  id: string;
  qrCode: string;
  secret: string;
}

function errorMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (/totp.*(disabled|not enabled)|factor.*not.*allowed/i.test(raw)) {
    return 'La verificación por TOTP no está habilitada en el proyecto de Supabase (Authentication → Multi-Factor Auth).';
  }
  return raw;
}

export default function MfaPanel() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<EnrolledFactor | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/partner/mfa', { cache: 'no-store' })
      .then(async (response) => (response.ok ? (await response.json())?.data : null))
      .then((data) => {
        if (!cancelled) setStatus((data as MfaStatus) ?? null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startEnrollment() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const supabase = await loadClient();
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Rix7',
      });

      if (enrollError || !data?.totp) {
        throw new Error(errorMessage(enrollError?.message, 'No se pudo iniciar la activación.'));
      }

      setEnrolling({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la activación.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (!enrolling || busy) return;

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
        factorId: enrolling.id,
      });
      if (challengeError || !challenge) {
        throw new Error(challengeError?.message ?? 'No se pudo verificar el código.');
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrolling.id,
        challengeId: challenge.id,
        code: clean,
      });
      if (verifyError) {
        throw new Error('El código no coincide. Revisá la hora de tu teléfono e intentá de nuevo.');
      }

      // La sesión pasó a aal2: se recarga para que el panel y la tarjeta lean el
      // estado nuevo y no quede un factor «unverified» colgado en memoria.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el código.');
      setBusy(false);
    }
  }

  async function disable() {
    if (busy || !status?.factorId) return;
    setBusy(true);
    setError(null);

    try {
      const supabase = await loadClient();
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({
        factorId: status.factorId,
      });
      if (unenrollError) {
        throw new Error(
          errorMessage(
            unenrollError.message,
            'No se pudo desactivar. Verificá el código de tu app e intentá de nuevo.'
          )
        );
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desactivar la verificación.');
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <ShieldCheck className="h-4 w-4 text-slate-400" />
        Verificación en dos pasos
      </h2>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el estado…
        </p>
      ) : enrolling ? (
        <form onSubmit={confirmEnrollment} className="mt-3">
          <p className="text-xs leading-relaxed text-slate-600">
            Escaneá el código con tu aplicación de autenticación (Google Authenticator, Authy,
            1Password) y escribí el código de seis dígitos para confirmar.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* El QR viene como SVG en data URI: se muestra tal cual, sin red. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrolling.qrCode}
              alt="Código QR para configurar la verificación en dos pasos"
              className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-2"
            />
            <div className="min-w-[12rem] flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Si no podés escanear
              </p>
              <p className="mt-1 break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700">
                {enrolling.secret}
              </p>
              <label
                htmlFor="mfa-enroll-code"
                className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                Código de la app
              </label>
              <input
                id="mfa-enroll-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-base tracking-[0.3em] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="000000"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy ? 'Verificando…' : 'Activar la verificación'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEnrolling(null);
                setCode('');
                setError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : status?.enrolled ? (
        <>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Activada
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Al entrar al panel te pedimos el código de tu aplicación además del enlace del correo.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {confirmingOff ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-red-700">¿Desactivar la verificación?</span>
              <button
                type="button"
                onClick={() => void disable()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Sí, desactivar
              </button>
              <button
                type="button"
                onClick={() => setConfirmingOff(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingOff(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <ShieldOff className="h-3.5 w-3.5" /> Desactivar
            </button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Sumá un código de tu teléfono al enlace del correo. Si alguien consigue entrar a tu
            correo, igual no puede abrir el panel sin ese código.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void startEnrollment()}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? 'Preparando…' : 'Activar la verificación'}
          </button>
        </>
      )}
    </section>
  );
}
