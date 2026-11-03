'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { formatPlanPrice } from '@/lib/kyb/plans';
import type { AltaPlanSummary } from '@/lib/kyb/proposal';
import { friendlyActivationError } from '@/lib/kyb/portal';

/**
 * Confirmación del plan en la etapa de alta.
 *
 * El plan ya está decidido: lo fijó la propuesta que la empresa aceptó, con los
 * montos que salieron de **Planes** (alta inicial, mensualidad, usuarios). Antes
 * esta pantalla ofrecía los tres planes del catálogo del código, con precios que
 * el panel había dejado de usar: el candidato podía aceptar una propuesta de
 * $19.990 y llegar a un paso que le mostraba otros números. Por eso acá no se
 * elige de nuevo —cambiarlo invalidaría lo aceptado—, se confirma.
 *
 * Lo que se envía sigue siendo solo el identificador del plan; el servidor lo
 * vuelve a validar contra el catálogo.
 */

interface PlanStepProps {
  token: string;
  /** El plan y los montos que el servidor calculó para esta solicitud. */
  planSummary: AltaPlanSummary;
  onActivated: (result: { plan: string | null; emailed: boolean }) => void;
}

export default function PlanStep({ token, planSummary, onActivated }: PlanStepProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!confirmed || sending) return;
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/kyb/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, plan: planSummary.planId }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(friendlyActivationError(body?.error));
        return;
      }

      const plan = typeof body.data?.plan === 'string' ? body.data.plan : planSummary.planId;
      onActivated({ plan, emailed: body.email?.sent === true });
    } catch {
      setError('No pudimos conectarnos. Tu plan sigue acá; intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-black text-slate-900">Confirma tu plan</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Es el plan de la propuesta que aceptaste. Al confirmarlo habilitamos el acceso al panel de
        tu empresa.
      </p>

      <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm shadow-blue-500/5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-slate-900">{planSummary.planName}</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              {formatPlanPrice(planSummary.monthlyClp)}
              <span className="ml-1 text-[11px] font-medium text-slate-400">/mes</span>
            </p>
          </div>
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
          >
            <Check className="h-3 w-3" />
          </span>
        </div>

        <dl className="mt-4 space-y-2 text-xs leading-relaxed text-slate-600">
          <div className="flex items-baseline justify-between gap-4">
            <dt>Alta inicial</dt>
            <dd className="font-bold text-slate-900">{formatPlanPrice(planSummary.altaClp)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt>Publicaciones activas</dt>
            <dd className="font-bold text-slate-900">{planSummary.listings}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt>Usuarios incluidos</dt>
            <dd className="font-bold text-slate-900">{planSummary.usuariosIncluidos}</dd>
          </div>
        </dl>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {planSummary.source === 'propuesta'
            ? 'Montos de la propuesta que aceptaste.'
            : 'Montos vigentes según el perfil de tu cuenta.'}
        </p>
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>Confirmo el plan y la mensualidad de la propuesta.</span>
      </label>

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Este paso no cobra nada: queda registrado el plan que confirmes y el alta se cierra cuando
          el pago quede registrado.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!confirmed || sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending ? 'Habilitando panel…' : 'Confirmar plan y activar panel'}
        </button>
      </div>
    </div>
  );
}
