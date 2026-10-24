'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, Loader2, Sparkles } from 'lucide-react';
import { KYB_PLANS, formatPlanPrice, type KybPlanId } from '@/lib/kyb/plans';
import { friendlyActivationError } from '@/lib/kyb/portal';

/**
 * Selector de plan de la etapa de alta.
 *
 * Son radios reales dentro de un `fieldset` (y no divs con `onClick`) para que
 * se elijan con teclado y los anuncie un lector de pantalla. El botón de
 * confirmar queda deshabilitado hasta que hay una elección explícita: no se
 * preselecciona nada, porque el plan es una decisión de la empresa y no un
 * valor por defecto que se pueda confirmar sin mirar.
 *
 * Lo que se envía es solo el identificador; precios, cupos y beneficios viven
 * en `lib/kyb/plans.ts` y el servidor los vuelve a resolver. Un plan inventado
 * desde el navegador no pasa la validación.
 */

interface PlanStepProps {
  token: string;
  onActivated: (result: { plan: string | null; emailed: boolean }) => void;
}

export default function PlanStep({ token, onActivated }: PlanStepProps) {
  const [selected, setSelected] = useState<KybPlanId | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selected || sending) return;
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/kyb/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, plan: selected }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(friendlyActivationError(body?.error));
        return;
      }

      const plan = typeof body.data?.plan === 'string' ? body.data.plan : selected;
      onActivated({ plan, emailed: body.email?.sent === true });
    } catch {
      setError('No pudimos conectarnos. Tu elección sigue acá; intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-black text-slate-900">Elige tu plan</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        El plan define cuántas publicaciones y cuántos usuarios tiene el panel de tu empresa.
        Al confirmar habilitamos el acceso con lo que elijas.
      </p>

      <fieldset className="mt-5 border-0 p-0">
        <legend className="sr-only">Plan mensual</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {KYB_PLANS.map((plan) => {
            const active = selected === plan.id;
            return (
              <label
                key={plan.id}
                className={`relative flex cursor-pointer flex-col rounded-2xl border bg-white p-5 transition-all focus-within:ring-2 focus-within:ring-blue-200 ${
                  active
                    ? 'border-blue-500 shadow-md shadow-blue-500/10'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="kyb-plan"
                  value={plan.id}
                  checked={active}
                  onChange={() => setSelected(plan.id)}
                  className="sr-only"
                />

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-black text-slate-900">
                      {plan.name}
                      {plan.id === 'profesional' && (
                        <Sparkles className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                      )}
                    </p>
                    <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                      {formatPlanPrice(plan.priceClp)}
                      <span className="ml-1 text-[11px] font-medium text-slate-400">/mes</span>
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                      active ? 'bg-blue-600 text-white' : 'border border-slate-300 text-transparent'
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                </div>

                <ul className="mt-4 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex gap-2 text-xs leading-relaxed text-slate-600"
                    >
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </label>
            );
          })}
        </div>
      </fieldset>

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
          Este paso no cobra nada: queda registrado el plan que elijas.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selected || sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending ? 'Habilitando panel…' : 'Confirmar plan y activar panel'}
        </button>
      </div>
    </div>
  );
}
