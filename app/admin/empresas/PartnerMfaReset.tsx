'use client';

import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';

/**
 * Quitar la verificación en dos pasos de una cuenta del socio.
 *
 * Vive en la ficha del socio y no en una pantalla aparte: el caso es operativo
 * —«cambié de teléfono»— y quien lo atiende ya está mirando a esa empresa. Se
 * pide el correo exacto de la cuenta porque un socio puede tener varios
 * usuarios, y el servidor rechaza cualquier correo que no esté vinculado a esta
 * ficha.
 */
export default function PartnerMfaReset({ partnerId }: { partnerId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/partners/mfa-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerId, email }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setResult({
          tone: 'error',
          text: body?.error ?? 'No se pudo quitar la verificación.',
        });
        return;
      }

      // El resultado dice las tres cosas por separado —qué se borró, si salió el
      // correo y si quedó el registro— porque cada una puede fallar sola.
      const notified = body.notified as { sent?: boolean; skipped?: boolean } | null;
      const audit = body.audit as { ok?: boolean } | null;
      const mailLine = notified?.sent
        ? ' Se le avisó por correo.'
        : ' El aviso por correo no salió: confirmáselo por otro medio.';
      const auditLine = audit && audit.ok === false ? ' Ojo: la acción no quedó en el registro.' : '';

      setResult({
        tone: 'ok',
        text:
          body.removed > 0
            ? `Listo: se quitaron ${body.removed} ${body.removed === 1 ? 'factor' : 'factores'} de ${body.email}. Puede volver a activarlo desde «Mi cuenta».${mailLine}${auditLine}`
            : 'Esa cuenta no tenía la verificación activada.',
      });
      setEmail('');
    } catch {
      setResult({ tone: 'error', text: 'Sin conexión con el servidor.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <KeyRound className="w-3.5 h-3.5 text-slate-400" />
          Segundo factor
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setResult(null);
          }}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
        >
          {open ? 'Cancelar' : 'Quitar 2FA'}
        </button>
      </div>

      {!open ? (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          Si el socio perdió su aplicación de códigos, se le puede quitar la verificación y volver
          a activarla al entrar.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-2">
          <label
            htmlFor={`mfa-reset-${partnerId}`}
            className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Correo de la cuenta
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id={`mfa-reset-${partnerId}`}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="persona@empresa.cl"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={busy || email.trim().length < 5}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy ? 'Quitando…' : 'Confirmar'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Tiene que ser una cuenta vinculada a este socio; si no, no se toca.
          </p>
        </form>
      )}

      {result && (
        <p
          role="status"
          className={`mt-2 text-[11px] ${result.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
