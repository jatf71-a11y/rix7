'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';

import { formatPlanPrice } from '@/lib/kyb/plans';
import type { LeadBracket } from '@/lib/kyb/planPricing';
import type { KybCommercialTerms } from '@/lib/kyb/proposal';
import type { KybProposalDecision } from '@/lib/kyb/status';

/**
 * Decisión del candidato sobre la propuesta.
 *
 * Aceptar es decir que sí al plan y elegir si contrata la **captación de leads**,
 * que es el otro producto que se cobra por mes. El **CCA** no se decide acá: es
 * una determinación que se resuelve después del alta, con las publicaciones que
 * el socio cargue. Antes se pedía una estimación en UF en este paso, y esa
 * estimación tenía que adivinar propiedades que todavía no existían.
 */

function bracketLabel(bracket: LeadBracket, unit: 'uf' | 'clp'): string {
  const from = unit === 'uf' ? `UF ${bracket.from.toLocaleString('es-CL')}` : formatPlanPrice(bracket.from);
  if (bracket.to === null) return `Más de ${from}`;
  const to = unit === 'uf' ? `UF ${bracket.to.toLocaleString('es-CL')}` : formatPlanPrice(bracket.to);
  return `${from} – ${to}`;
}

export default function ProposalDecision({
  token,
  legalName,
  decision,
  captacionMonthlyClp,
  profileLabel,
  captacion,
  commercial,
}: {
  token: string;
  legalName: string;
  decision: KybProposalDecision | null;
  /** Suscripción Captación Activa del perfil, en pesos por mes. */
  captacionMonthlyClp: number;
  profileLabel: string;
  captacion: { ventas: LeadBracket[]; arriendos: LeadBracket[] };
  /** Lo que quedó aceptado, cuando la decisión ya está tomada. */
  commercial: KybCommercialTerms | null;
}) {
  const [sending, setSending] = useState<KybProposalDecision | null>(null);
  const [done, setDone] = useState<KybProposalDecision | null>(decision);
  const [saved, setSaved] = useState<KybCommercialTerms | null>(commercial);
  const [error, setError] = useState<string | null>(null);

  const [wantsCaptacion, setWantsCaptacion] = useState(commercial?.captacion ?? false);
  const [showCaptacion, setShowCaptacion] = useState(false);

  const canAccept = !sending && !done;

  async function answer(value: KybProposalDecision) {
    if (sending || done) return;
    setSending(value);
    setError(null);

    try {
      const response = await fetch('/api/kyb/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          decision: value,
          captacion: wantsCaptacion,
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No pudimos registrar tu respuesta. Intenta de nuevo.');
        return;
      }

      setDone(value);
      if (value === 'aceptada') {
        setSaved({
          captacion: wantsCaptacion,
          acceptedAt: new Date().toISOString(),
        });
      }
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
        <ul className="mt-2 space-y-1 text-sm leading-relaxed text-emerald-700">
          {saved ? (
            <li>
              Plan de captación:{' '}
              <strong>
                {saved.captacion
                  ? `${formatPlanPrice(captacionMonthlyClp)} /mes`
                  : 'no contratado'}
              </strong>
              .
            </li>
          ) : null}
        </ul>
        <p className="mt-2 text-sm leading-relaxed text-emerald-700">
          Te enviamos al correo de {legalName} el enlace para elegir el plan y habilitar el panel.
          {saved?.captacion
            ? ' También te mandamos el detalle de cómo funciona el plan de captación.'
            : ''}{' '}
          Cuando el pago quede registrado, tu cuenta pasa a operando. El CCA se determina después,
          en tu panel, con tus publicaciones ya cargadas.
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
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
        <p className="text-sm font-bold text-slate-900">Condiciones que aceptas</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Perfil de socio: <strong className="text-slate-700">{profileLabel}</strong>. Además del
          plan, puedes sumar el plan de captación de leads.
        </p>

        <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={wantsCaptacion}
            onChange={(event) => setWantsCaptacion(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Quiero contratar el <strong className="text-slate-800">plan de captación</strong> por{' '}
            {formatPlanPrice(captacionMonthlyClp)} al mes, además de mi suscripción.
          </span>
        </label>

        <button
          type="button"
          onClick={() => setShowCaptacion((value) => !value)}
          aria-expanded={showCaptacion}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
        >
          Cómo funciona el plan de captación
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showCaptacion ? 'rotate-180' : ''}`}
          />
        </button>

        {showCaptacion && (
          <div className="mt-2 space-y-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3 text-xs leading-relaxed text-slate-600">
            <p>
              <strong className="text-slate-800">1. Suscripción Captación Activa</strong> ·{' '}
              {profileLabel}: {formatPlanPrice(captacionMonthlyClp)} al mes. Te mantiene activo en el
              reparto de leads.
            </p>
            <div>
              <p className="font-semibold text-slate-800">
                2. Acceso a leads de ventas (según el valor de la propiedad, en UF)
              </p>
              <ul className="mt-1 space-y-0.5">
                {captacion.ventas.map((bracket) => (
                  <li key={`v-${bracket.from}`} className="flex justify-between gap-3">
                    <span>{bracketLabel(bracket, 'uf')}</span>
                    <span className="font-semibold text-slate-800">
                      {formatPlanPrice(bracket.priceClp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-slate-800">
                3. Acceso a leads de arriendos (según el canon mensual)
              </p>
              <ul className="mt-1 space-y-0.5">
                {captacion.arriendos.map((bracket) => (
                  <li key={`a-${bracket.from}`} className="flex justify-between gap-3">
                    <span>{bracketLabel(bracket, 'clp')}</span>
                    <span className="font-semibold text-slate-800">
                      {formatPlanPrice(bracket.priceClp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-slate-500">
              El acceso se cobra por lead que decidas tomar, no por lead que te ofrezcamos. Puedes
              pausar la captación cuando quieras.
            </p>
          </div>
        )}

        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
          El <strong className="text-slate-700">CCA</strong> no se cobra en esta propuesta: se
          determina después del alta, según las publicaciones que cargues, y se cobra junto a la
          mensualidad.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => answer('aceptada')}
          disabled={!canAccept}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending === 'aceptada' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          De acuerdo, acepto
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
      <p className="text-[11px] leading-relaxed text-slate-400">
        Al aceptar seguimos con el alta y te enviamos el acceso para confirmar el plan.
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
