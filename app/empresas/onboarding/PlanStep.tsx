'use client';

import React, { useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { formatPlanPrice } from '@/lib/kyb/plans';
import type { CcaExample } from '@/lib/kyb/cca';
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
 *
 * Además, acá se **autoriza el cobro del CCA**. Es un cargo mensual distinto del
 * plan: se calcula sobre la cartera del socio (la suma de sus publicaciones en
 * UF) y cambia cada vez que publica o da de baja una propiedad. Nadie puede
 * recibir esa factura sin haberla aprobado, así que el botón no se habilita sin
 * las dos casillas. El monto no se estima acá: todavía no hay cartera, y una
 * cifra inventada sería una promesa. Se explica cómo se calcula y se avisa que
 * cada cambio llega por correo.
 */

interface PlanStepProps {
  token: string;
  /** El plan y los montos que el servidor calculó para esta solicitud. */
  planSummary: AltaPlanSummary;
  /** Ejemplo en pesos con la UF y el %CCA vigentes; `null` si falta alguno. */
  ccaExample?: CcaExample | null;
  onActivated: (result: { plan: string | null; emailed: boolean }) => void;
}

/** Porcentaje con hasta dos decimales, como se configura en Planes. */
function formatPct(value: number): string {
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value)} %`;
}

export default function PlanStep({ token, planSummary, ccaExample, onActivated }: PlanStepProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [ccaAccepted, setCcaAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!confirmed || !ccaAccepted || sending) return;
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/kyb/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, plan: planSummary.planId, ccaAccepted: true }),
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

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-bold text-slate-900">
          CCA: un cobro mensual, aparte de la mensualidad
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          El <strong>CCA</strong> se factura <strong>todos los meses</strong> junto a la mensualidad
          del plan. No es un pago único, no es un cobro por publicación y no depende de cuántas
          fichas publiques: se calcula sobre el valor de tu cartera —la suma de tus publicaciones,
          expresada en UF— con el <strong>%CCA</strong> que Rix7 publica en Planes.
        </p>
        <p className="mt-2 rounded-lg bg-white px-3 py-2 font-mono text-[11px] text-slate-500">
          $CCA = CCA (UF) × valor UF ÷ 1.000.000 × %CCA
        </p>
        {ccaExample && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Con la UF vigente ({formatPlanPrice(ccaExample.ufClp)}) y el %CCA vigente (
            {formatPct(ccaExample.ccaPct)}): una cartera de{' '}
            {formatPlanPrice(ccaExample.stockClp)} —{formatPct(ccaExample.ccaUf).replace(' %', '')}{' '}
            UF— paga <strong>{formatPlanPrice(ccaExample.monthlyClp)} al mes</strong>. Si tu cartera
            es más chica o más grande, el monto baja o sube en la misma proporción.
          </p>
        )}
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-600">
          <li>
            · Sin publicaciones el CCA es <strong>$0</strong>: no hay un mínimo que pagar.
          </li>
          <li>· Es proporcional a tu cartera: si la duplicas, el CCA se duplica.</li>
          <li>· Cambia cuando cambia tu cartera o el %CCA, y cada cambio te llega por correo.</li>
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          El primer monto se determina después del alta, con tus propiedades ya cargadas. En tu panel
          ves la cuenta completa —cartera, CCA en UF, %CCA y monto— y el historial de cada mes.
        </p>

        <label className="mt-3 flex items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={ccaAccepted}
            onChange={(event) => setCcaAccepted(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Entiendo que el CCA es un cobro mensual y autorizo su facturación junto a la
            mensualidad.
          </span>
        </label>
      </div>

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
          Hoy no se cobra nada: al confirmar queda registrado el plan y tu autorización del CCA, y
          el acceso al panel se habilita en este mismo paso. La facturación del período la emite
          Rix7 por separado.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!confirmed || !ccaAccepted || sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending ? 'Habilitando panel…' : 'Confirmar plan y activar panel'}
        </button>
      </div>
    </div>
  );
}
