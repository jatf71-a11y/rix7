'use client';

import React, { useState } from 'react';
import { CheckCircle2, Copy, Loader2, UserRoundCheck } from 'lucide-react';

import { KYB_PLANS, isKybPlanId, type KybPlanId } from '@/lib/kyb/plans';
import type { KybApplication } from '@/lib/kyb/types';

/**
 * Cierre del alta desde la ficha del equipo.
 *
 * El alta se cierra sola cuando la empresa confirma su plan y autoriza el CCA en
 * su enlace. Cuando no lo hace —se quedó a mitad de camino— el equipo necesita
 * una salida que deje lo mismo: la ficha del socio, su cuenta de acceso y su plan
 * elegido, para que el panel pueda configurar usuarios.
 *
 * Lo único que no se puede dar por hecho es el CCA: es un cobro mensual y se
 * fecha solo si alguien confirma que el socio lo autorizó. Sin esa confirmación
 * el alta se cierra igual, pero la ficha muestra que el cobro quedó sin respaldo.
 */

interface TeamActivationPanelProps {
  application: KybApplication;
  /** Se cerró el alta: la ficha y el tablero tienen que recargarse. */
  onActivated: () => void;
}

interface ActivationResult {
  accessLink: string | null;
  partnerId: string | null;
  ccaAuthorized: boolean;
}

export default function TeamActivationPanel({
  application,
  onActivated,
}: TeamActivationPanelProps) {
  const [plan, setPlan] = useState<KybPlanId>(
    isKybPlanId(application.plan) ? application.plan : 'basico'
  );
  const [confirmedCca, setConfirmedCca] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const alreadyAuthorized = !!application.ccaAuthorizedAt;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/solicitudes/${encodeURIComponent(application.id)}/activate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plan,
            ccaAuthorized: alreadyAuthorized || confirmedCca,
          }),
        }
      );
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo cerrar el alta. Intenta de nuevo.');
        return;
      }

      setResult({
        accessLink: typeof body.accessLink === 'string' ? body.accessLink : null,
        partnerId: typeof body.partnerId === 'string' ? body.partnerId : null,
        ccaAuthorized: !!body.ccaAuthorized,
      });
      onActivated();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result?.accessLink) return;
    try {
      await navigator.clipboard.writeText(result.accessLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin portapapeles queda el enlace a la vista para copiarlo a mano.
    }
  }

  if (result) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Alta cerrada
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-emerald-900">
          Quedó en <span className="font-semibold">Operando</span>
          {result.partnerId ? (
            <>
              {' '}
              como socio <span className="font-mono text-[10px]">{result.partnerId}</span>
            </>
          ) : null}
          , con su cuenta de acceso y su plan. El panel de usuarios ya puede configurarse.
        </p>
        {!result.ccaAuthorized && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-800">
            Sin autorización del CCA registrada: confirmala con el socio antes de facturarle el
            cobro mensual.
          </p>
        )}
        {result.accessLink ? (
          <div className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Enlace de acceso, de un solo uso
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={result.accessLink}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-2 py-1.5 font-mono text-[10px] text-slate-700"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-emerald-800/80">
              Entra directo a su panel y deja la sesión abierta. No se envió por correo: se lo
              pasás vos.
            </p>
          </div>
        ) : (
          <p className="mt-1.5 text-[10px] text-emerald-800/80">
            No se pudo generar el enlace de un solo uso. La cuenta quedó creada: el socio puede
            entrar con el enlace de acceso por correo.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <UserRoundCheck className="h-3.5 w-3.5" /> Cerrar el alta
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
        Pasa la solicitud a <span className="font-semibold">Operando</span>: crea la ficha del
        socio, su cuenta de acceso y habilita su panel. Recién ahí se pueden configurar los
        usuarios del plan.
      </p>

      <label
        htmlFor={`plan-alta-${application.id}`}
        className="mt-2.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400"
      >
        Plan que queda en el alta
      </label>
      <select
        id={`plan-alta-${application.id}`}
        value={plan}
        onChange={(event) => {
          const next = event.target.value;
          if (isKybPlanId(next)) setPlan(next);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
      >
        {KYB_PLANS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.users} {item.users === 1 ? 'usuario' : 'usuarios'}
          </option>
        ))}
      </select>

      {alreadyAuthorized ? (
        <p className="mt-2 text-[11px] text-emerald-700">
          El CCA ya está autorizado en esta solicitud: se conserva esa fecha.
        </p>
      ) : (
        <label className="mt-2.5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
          <input
            type="checkbox"
            checked={confirmedCca}
            onChange={(event) => setConfirmedCca(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
          />
          <span>
            El socio autorizó el cobro mensual del CCA. Sin esta confirmación el alta se cierra
            igual, pero el cobro queda sin respaldo registrado.
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {busy ? 'Cerrando el alta…' : 'Pasar a Operando'}
      </button>
    </div>
  );
}
