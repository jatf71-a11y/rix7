'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, ShieldCheck, UserX } from 'lucide-react';

import MfaPanel from '@/app/socio/cuenta/MfaPanel';

/**
 * Seguridad de la cuenta del equipo.
 *
 * Tres piezas, en el orden en que se necesitan:
 *
 * 1. **Activar el segundo factor** — el mismo componente que usa el socio, con
 *    la ruta del equipo.
 * 2. **Códigos de recuperación** — la salida cuando se pierde el teléfono. Se
 *    muestran una sola vez y el servidor guarda solo su hash: si se pierden, se
 *    generan de nuevo y el lote anterior deja de servir.
 * 3. **Reset de otra cuenta del equipo** — el camino acompañado, con registro y
 *    aviso por correo a la persona afectada.
 */

interface MfaData {
  enrolled: boolean;
  requiresChallenge: boolean;
  factorId: string | null;
  codesLeft: number;
}

export default function AdminCuentaPage() {
  const [mfa, setMfa] = useState<MfaData | null>(null);
  const [loading, setLoading] = useState(true);

  const [codes, setCodes] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [targetEmail, setTargetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/mfa', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.data) setMfa(body.data as MfaData);
      else setMfa(null);
    } catch {
      setMfa(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function generate() {
    setGenerating(true);
    setCodesError(null);
    setCodes(null);

    try {
      const response = await fetch('/api/admin/mfa/recovery-codes', { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        setCodesError(body?.error ?? 'No se pudieron generar los códigos.');
        return;
      }
      setCodes(body.codes as string[]);
      await loadStatus();
    } catch {
      setCodesError('Sin conexión con el servidor.');
    } finally {
      setGenerating(false);
    }
  }

  async function copyCodes() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCodesError('El navegador no dejó copiar: seleccioná los códigos y copialos a mano.');
    }
  }

  async function resetOther(event: React.FormEvent) {
    event.preventDefault();
    if (resetBusy) return;

    setResetBusy(true);
    setResetMessage(null);

    try {
      const response = await fetch('/api/admin/team/mfa-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setResetMessage({ ok: false, text: body?.error ?? 'No se pudo quitar el segundo factor.' });
        return;
      }

      const aviso = body.notified?.sent
        ? 'y le avisamos por correo'
        : body.notified?.skipped
          ? 'pero el aviso por correo no salió (falta configuración)'
          : 'pero el aviso por correo falló';
      setResetMessage({
        ok: true,
        text: `Le quitamos ${body.removed} factor(es) a ${body.email} ${aviso}. Quedó registrado.`,
      });
      setTargetEmail('');
    } catch {
      setResetMessage({ ok: false, text: 'Sin conexión con el servidor.' });
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-black text-slate-900">Mi cuenta del equipo</h1>
        <p className="mt-1 text-xs text-slate-500">
          La cuenta que administra socios, planes y accesos. Su segundo factor es obligatorio para
          operar.
        </p>
      </div>

      <MfaPanel endpoint="/api/admin/mfa" />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <KeyRound className="h-4 w-4 text-slate-400" /> Códigos de recuperación
        </h2>

        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el estado…
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              Si perdés el teléfono, uno de estos códigos te deja entrar y quitar el segundo factor
              para volver a activarlo. Cada código sirve <strong>una sola vez</strong>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Te quedan <strong className="text-slate-900">{mfa?.codesLeft ?? 0}</strong> de 10.
            </p>

            {!mfa?.enrolled && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                Activá primero la verificación en dos pasos: los códigos son su llave de repuesto.
              </p>
            )}

            {codes && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold text-slate-700">
                  Guardalos fuera del teléfono y de este navegador. No se vuelven a mostrar.
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-slate-800">
                  {codes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void copyCodes()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white/60"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copiados' : 'Copiar los diez'}
                </button>
              </div>
            )}

            {codesError && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {codesError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating || !mfa?.enrolled}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {generating ? 'Generando…' : codes ? 'Generar un lote nuevo' : 'Generar códigos'}
            </button>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <UserX className="h-4 w-4 text-slate-400" /> Resetear el segundo factor de otra cuenta
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Para cuando la persona ya no tiene ninguno de sus códigos. Queda registrado en la bitácora
          del equipo y se le avisa por correo.
        </p>

        <form onSubmit={resetOther} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="reset-email" className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Correo de la cuenta
            </label>
            <input
              id="reset-email"
              type="email"
              value={targetEmail}
              onChange={(event) => setTargetEmail(event.target.value)}
              placeholder="persona@rix7.cl"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            type="submit"
            disabled={resetBusy || !targetEmail.includes('@')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {resetBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {resetBusy ? 'Quitando…' : 'Quitar el 2FA'}
          </button>
        </form>

        {resetMessage && (
          <p
            role="status"
            className={`mt-2 text-xs ${resetMessage.ok ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {resetMessage.text}
          </p>
        )}
      </section>
    </div>
  );
}
