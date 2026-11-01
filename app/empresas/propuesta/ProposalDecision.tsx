'use client';

import React, { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import type { KybProposalDecision } from '@/lib/kyb/status';

/**
 * Decisión del candidato sobre la propuesta.
 *
 * Dos botones y un estado: mientras se envía no se puede volver a tocar, y
 * cuando el servidor responde se reemplazan por el resultado. La aceptación se
 * confirma en el servidor —el navegador no decide nada— y el mensaje final dice
 * qué pasa después, porque aceptar no es lo último del flujo: sigue elegir plan y
 * registrar el pago.
 */
export default function ProposalDecision({
  token,
  legalName,
  decision,
}: {
  token: string;
  legalName: string;
  decision: KybProposalDecision | null;
}) {
  const [sending, setSending] = useState<KybProposalDecision | null>(null);
  const [done, setDone] = useState<KybProposalDecision | null>(decision);
  const [error, setError] = useState<string | null>(null);

  async function answer(value: KybProposalDecision) {
    if (sending || done) return;
    setSending(value);
    setError(null);

    try {
      const response = await fetch('/api/kyb/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, decision: value }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No pudimos registrar tu respuesta. Intenta de nuevo.');
        return;
      }

      setDone(value);
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setSending(null);
    }
  }

  if (done === 'aceptada') {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
          <Check className="h-4 w-4" /> Propuesta aceptada
        </p>
        <p className="mt-1 text-sm leading-relaxed text-emerald-700">
          Te enviamos al correo de {legalName} el enlace para elegir el plan y habilitar el panel.
          Cuando el pago quede registrado, tu cuenta pasa a operando.
        </p>
      </div>
    );
  }

  if (done === 'rechazada') {
    return (
      <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-bold text-slate-700">Registramos que no te sirve</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Si quieres que revisemos los números, responde el correo de la propuesta y lo vemos
          juntos.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => answer('aceptada')}
          disabled={sending !== null}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending === 'aceptada' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Aceptar la propuesta
        </button>
        <button
          type="button"
          onClick={() => answer('rechazada')}
          disabled={sending !== null}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending === 'rechazada' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
          No me interesa
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Al aceptar seguimos con el alta y te enviamos el acceso para elegir el plan.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
