'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

import { formatPlanPrice } from '@/lib/kyb/plans';
import type { PlanOption } from '@/lib/kyb/proposal';

/**
 * Las tres tarjetas de plan.
 *
 * Elegir uno llama a `/api/kyb/plan`: el servidor arma la propuesta con el precio
 * de ese plan en **Planes**, rota el token y responde con el de la propuesta.
 * Acá solo se navega a la pantalla de aceptación, que es la que ya existe.
 *
 * Los montos llegan resueltos del servidor; esta pantalla no calcula precios.
 */
export default function PlanChoice({
  token,
  plans,
  profileLabel,
  captacionMonthlyClp,
}: {
  token: string;
  plans: PlanOption[];
  profileLabel: string;
  captacionMonthlyClp: number;
}) {
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planId: string) {
    if (sending) return;
    setSending(planId);
    setError(null);

    try {
      const response = await fetch('/api/kyb/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, plan: planId }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success || !body.data?.redirect) {
        setError(body?.error ?? 'No pudimos guardar tu elección. Intenta de nuevo.');
        return;
      }

      router.push(body.data.redirect);
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Perfil de socio: <span className="text-slate-700">{profileLabel}</span>
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.planId}
            className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
              plan.recommended ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">{plan.planName}</p>
                {plan.recommended && (
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                    Sugerido
                  </p>
                )}
              </div>
              {plan.recommended && (
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
                >
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>

            <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">
              {formatPlanPrice(plan.monthlyClp)}
              <span className="ml-1 text-[11px] font-medium text-slate-400">/mes</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Alta inicial {formatPlanPrice(plan.altaClp)} · {plan.usuariosIncluidos}{' '}
              {plan.usuariosIncluidos === 1 ? 'usuario' : 'usuarios'}
            </p>

            <ul className="mt-4 flex-1 space-y-1.5 text-[11px] leading-relaxed text-slate-600">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => void choose(plan.planId)}
              disabled={sending !== null}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending === plan.planId && <Loader2 className="h-4 w-4 animate-spin" />}
              {sending === plan.planId ? 'Armando propuesta…' : `Elegir ${plan.planName}`}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-5 rounded-xl bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
        Todos los planes publican sin cupo. El <strong className="text-slate-700">CCA</strong> —la
        suma de tus publicaciones en UF— se determina después del alta, con tus propiedades ya
        cargadas, y se factura aparte de la mensualidad. La captación de leads, si la quieres,
        cuesta {formatPlanPrice(captacionMonthlyClp)} al mes para tu perfil.
      </p>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 text-sm font-semibold text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
