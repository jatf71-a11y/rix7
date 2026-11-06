'use client';

import React, { useState } from 'react';
import { Check, Loader2, Send } from 'lucide-react';

import { KYB_PLANS, type KybPlanId } from '@/lib/kyb/plans';
import type { KybApplication } from '@/lib/kyb/types';

/**
 * Envío de la propuesta comercial.
 *
 * Aparece solo cuando la solicitud está `Calificado`: es el paso que sigue al
 * «aprobada». El plan sale del catálogo; los montos son opcionales y, si se
 * dejan vacíos, el servidor usa los del perfil que definió la sección Planes —
 * así el panel no obliga a copiar precios a mano y, cuando se cambian en Planes,
 * la próxima propuesta sale con los nuevos—.
 *
 * El estado de la solicitud lo mueve el servidor: acá solo se muestra el
 * resultado, y la ficha se recarga con lo que devolvió el backend.
 */
export default function ProposalPanel({
  application,
  onSent,
}: {
  application: KybApplication;
  onSent?: () => void;
}) {
  const [plan, setPlan] = useState<KybPlanId>('profesional');
  const [altaClp, setAltaClp] = useState('');
  const [monthlyClp, setMonthlyClp] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const pending = application.proposal.find((item) => !item.decision) ?? null;

  if (application.status !== 'Calificado') {
    return null;
  }

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/kyb/${encodeURIComponent(application.id)}/proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          ...(altaClp.trim() ? { altaClp: Number(altaClp.replace(/\./g, '')) } : {}),
          ...(monthlyClp.trim() ? { monthlyClp: Number(monthlyClp.replace(/\./g, '')) } : {}),
          ...(note.trim() ? { note } : {}),
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo enviar la propuesta.');
        return;
      }

      setSent(true);
      onSent?.();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3.5">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
        <Send className="h-3.5 w-3.5" /> Propuesta comercial
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-indigo-900/80">
        La solicitud está calificada. Envía el plan y los precios: el candidato recibe un enlace
        para aceptarla y recién ahí sigue el alta. Los planes no traen cupo de publicaciones: se
        factura la mensualidad y, sobre la cartera del socio, el CCA.
      </p>

      {sent ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Propuesta enviada por correo.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Plan
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value as KybPlanId)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
            >
              {KYB_PLANS.map((item) => (
                <option key={item.id} value={item.id}>
                  {/* El precio no está en el catálogo: lo define Planes por
                      perfil, y los montos de esta propuesta se editan abajo. No
                      se ofrece un cupo de publicaciones porque no se cobra por
                      publicación: los usuarios sí son parte del plan. */}
                  {item.name} · {item.users} usuario(s)
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Alta inicial ($)
            <input
              value={altaClp}
              onChange={(event) => setAltaClp(event.target.value)}
              placeholder="según el perfil"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Mensualidad ($)
            <input
              value={monthlyClp}
              onChange={(event) => setMonthlyClp(event.target.value)}
              placeholder="según el perfil"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">
            Nota para el candidato (opcional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
            />
          </label>
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? 'Enviando…' : 'Enviar propuesta'}
            </button>
            <p className="mt-1.5 text-[10px] text-slate-500">
              Si dejas los montos vacíos se usan los del perfil en Planes.
            </p>
          </div>
        </div>
      )}

      {pending && (
        <p className="mt-2 text-[10px] text-slate-500">
          Propuesta vigente enviada el {new Date(pending.sentAt).toLocaleDateString('es-CL')}.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] font-semibold text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
