'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { formatKybDateTime } from '@/lib/kyb/admin';
import {
  decisionsFor,
  KYB_DECISION_LABELS,
  normalizeDecision,
  whyCannotDecide,
} from '@/lib/kyb/decisions';
import { KYB_STATUS_LABELS, type KybManualDecision } from '@/lib/kyb/status';
import type { KybApplication, KybDecision } from '@/lib/kyb/types';

/**
 * Decisión del equipo sobre una solicitud.
 *
 * Tres botones y un campo. La validación que apaga el confirmar es **la misma**
 * que aplica el servidor (`normalizeDecision`), así que el panel no deja enviar
 * algo que la API va a rechazar: si falta el motivo del rechazo o las preguntas
 * de «Pendiente_Informacion», se dice acá y no después del viaje.
 *
 * El historial se muestra debajo porque una decisión sin autor no sirve: la
 * ficha tiene que poder responder «¿quién aprobó esto y cuándo?» sin abrir la
 * base.
 */

interface DecisionPanelProps {
  application: KybApplication;
  decisions: KybDecision[];
  deciding: boolean;
  onDecide: (input: {
    decision: KybManualDecision;
    note?: string;
    questions?: string[];
  }) => void;
}

/** Tono de cada botón: aprobar no puede verse igual que rechazar. */
const DECISION_TONES: Record<KybManualDecision, string> = {
  Aceptada: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  Pendiente_Informacion: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
  Rechazada: 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
};

const DECISION_TONES_DONE: Record<KybManualDecision, string> = {
  Aceptada: 'bg-emerald-50 text-emerald-700',
  Pendiente_Informacion: 'bg-amber-50 text-amber-700',
  Rechazada: 'bg-red-50 text-red-700',
};

export default function DecisionPanel({
  application,
  decisions,
  deciding,
  onDecide,
}: DecisionPanelProps) {
  const options = decisionsFor(application.status);
  const blocked = whyCannotDecide(application.status);

  const [pending, setPending] = useState<KybManualDecision | null>(null);
  const [note, setNote] = useState('');
  const [questionsText, setQuestionsText] = useState('');

  const questions = useMemo(
    () =>
      questionsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [questionsText]
  );

  const validation = pending ? normalizeDecision({ decision: pending, note, questions }) : null;

  const choose = (decision: KybManualDecision) => {
    setPending((current) => (current === decision ? null : decision));
  };

  const confirm = () => {
    if (!pending || !validation?.ok) return;
    onDecide({
      decision: pending,
      ...(validation.data.note ? { note: validation.data.note } : {}),
      ...(validation.data.questions.length > 0
        ? { questions: validation.data.questions.map((question) => question.question) }
        : {}),
    });
    setPending(null);
    setNote('');
    setQuestionsText('');
  };

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Decisión del equipo
        </p>
        <p className="text-[10px] text-slate-400">Queda registrado quién decide.</p>
      </div>

      {blocked ? (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          {blocked}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((decision) => {
              const active = pending === decision;
              return (
                <button
                  key={decision}
                  type="button"
                  aria-pressed={active}
                  disabled={deciding}
                  onClick={() => choose(decision)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
                    active ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                  } ${DECISION_TONES[decision]}`}
                >
                  {KYB_DECISION_LABELS[decision]}
                </button>
              );
            })}
          </div>

          {pending && (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {pending === 'Rechazada' ? 'Motivo del rechazo (lo recibe la empresa)' : 'Comentario (opcional)'}
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={pending === 'Rechazada' ? 3 : 2}
                  maxLength={1000}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-800"
                  placeholder={
                    pending === 'Rechazada'
                      ? 'El RUT declarado no coincide con el registro comercial y el sitio no acredita actividad.'
                      : 'Por qué se toma esta decisión.'
                  }
                />
              </label>

              {pending === 'Pendiente_Informacion' && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Preguntas para la empresa (una por línea)
                  </span>
                  <textarea
                    value={questionsText}
                    onChange={(event) => setQuestionsText(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-800"
                    placeholder={'¿Cuál es el domicilio comercial de la empresa?\n¿Quién aparece como representante legal?'}
                  />
                </label>
              )}

              {validation && !validation.ok && (
                <p className="flex items-start gap-1.5 text-[11px] text-red-700">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  {validation.error}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={deciding || !validation?.ok}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deciding && <Loader2 className="h-3 w-3 animate-spin" />}
                  {deciding ? 'Aplicando…' : `Confirmar: ${KYB_DECISION_LABELS[pending]}`}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={deciding}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {decisions.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Historial</p>
          <ul className="mt-1.5 space-y-2">
            {decisions.map((decision) => (
              <li key={decision.id} className="text-[11px] leading-relaxed text-slate-600">
                <span
                  className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    DECISION_TONES_DONE[decision.decision]
                  }`}
                >
                  {KYB_DECISION_LABELS[decision.decision]}
                </span>
                <span className="font-semibold text-slate-700">{decision.decidedBy}</span>
                {' · '}
                {formatKybDateTime(decision.createdAt)}
                {' · '}
                <span className="text-slate-400">
                  {KYB_STATUS_LABELS[decision.statusBefore]} → {KYB_STATUS_LABELS[decision.statusAfter]}
                </span>
                {decision.note && <p className="mt-0.5 text-slate-600">«{decision.note}»</p>}
                {decision.questions.length > 0 && (
                  <p className="mt-0.5 text-slate-500">
                    {decision.questions.length} pregunta
                    {decision.questions.length === 1 ? '' : 's'} enviada
                    {decision.questions.length === 1 ? '' : 's'}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
