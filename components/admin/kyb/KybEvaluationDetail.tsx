'use client';

import React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import {
  canReevaluate,
  checkSummary,
  coverageLabel,
  evidenceHref,
  evidenceLabel,
  formatKybDateTime,
  KYB_CHECK_TONES,
  nonPassingChecks,
  scoreTone,
} from '@/lib/kyb/admin';
import type { KybEvaluation, KybManualDecision } from '@/lib/kyb/status';
import type { KybApplication, KybDecision } from '@/lib/kyb/types';
import DecisionPanel from './DecisionPanel';

/**
 * Ficha de evaluación de una solicitud.
 *
 * Es presentacional a propósito: recibe la solicitud y su última corrida ya
 * resueltas, para que la página se ocupe de la red y acá se vea el porqué de
 * cada estado. El puntaje y las verificaciones no se muestran a la empresa
 * (son información del equipo); esta es su pantalla.
 */

/**
 * Una mención pública de la búsqueda de reputación.
 *
 * El enlace solo se arma si la URL es `http(s)`: lo que devuelve el proveedor
 * es dato externo y va a terminar en un `href`.
 */
function MentionItem({ title, url }: { title: string; url: string }) {
  const href = evidenceHref(url);
  const text = title.trim() || url;

  return (
    <li className="text-[11px] leading-relaxed">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-blue-700 hover:underline"
        >
          {text}
        </a>
      ) : (
        <span className="text-slate-600">{text}</span>
      )}
    </li>
  );
}

interface KybEvaluationDetailProps {
  application: KybApplication;
  evaluation: KybEvaluation | null;
  decisions: KybDecision[];
  reevaluating: boolean;
  deciding: boolean;
  error: string | null;
  onReevaluate: () => void;
  onDecide: (input: {
    decision: KybManualDecision;
    note?: string;
    questions?: string[];
  }) => void;
}

export default function KybEvaluationDetail({
  application,
  evaluation,
  decisions,
  reevaluating,
  deciding,
  error,
  onReevaluate,
  onDecide,
}: KybEvaluationDetailProps) {
  const summary = evaluation ? checkSummary(evaluation.checks) : null;
  const outstanding = evaluation ? nonPassingChecks(evaluation.checks) : null;
  const blocked = !canReevaluate(application.status);

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">Evaluación automática</h3>
          <p className="text-[11px] text-slate-500">
            {evaluation
              ? `Última corrida: ${formatKybDateTime(evaluation.createdAt)}`
              : 'Esta solicitud no tiene una corrida del motor guardada.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {evaluation && (
            <span
              className={`rounded-lg px-3 py-1 text-sm font-black ${scoreTone(evaluation.score)}`}
              aria-label={`Puntaje ${evaluation.score} de 100`}
            >
              {evaluation.score}
              <span className="text-[10px] font-semibold">/100</span>
            </span>
          )}
          <button
            type="button"
            onClick={onReevaluate}
            disabled={blocked || reevaluating}
            title={blocked ? 'La solicitud ya está en alta: el motor no vuelve a correr.' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reevaluating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {reevaluating ? 'Evaluando…' : 'Re-evaluar'}
          </button>
        </div>
      </div>

      {blocked && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          La solicitud está en alta: el flujo terminó y no se vuelve a evaluar.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {evaluation ? (
        <>
          {summary && (
            <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                {summary.pass} ok
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                {summary.warn} advierte
                {outstanding && outstanding.warn.length > 0
                  ? `: ${outstanding.warn.map((check) => check.label).join(', ')}`
                  : ''}
              </span>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">
                {summary.fail} falla
                {outstanding && outstanding.fail.length > 0
                  ? `: ${outstanding.fail.map((check) => check.label).join(', ')}`
                  : ''}
              </span>
            </div>
          )}

          <ol className="mt-4 space-y-2">
            {evaluation.checks.map((check, index) => {
              const tone = KYB_CHECK_TONES[check.status];
              return (
                <li
                  key={check.id}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-bold text-slate-800">
                      <span className="mr-1 text-slate-400">{index + 1}.</span>
                      {check.label}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${tone.className}`}
                    >
                      {tone.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{check.detail}</p>
                  {check.facts && check.facts.length > 0 && (
                    <dl className="mt-2 space-y-1">
                      {check.facts.map((fact) => (
                        <div
                          key={fact.label}
                          className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-1.5"
                        >
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {fact.label}
                          </dt>
                          <dd className="text-right text-[11px] font-semibold text-slate-700">
                            {fact.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {check.evidence && (
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      <span className="font-semibold uppercase tracking-wide text-slate-400">
                        Origen
                      </span>{' '}
                      {evidenceLabel(check.evidence)}
                    </p>
                  )}
                  {check.evidence?.mentions && check.evidence.mentions.length > 0 && (
                    <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Menciones encontradas
                      </p>
                      <ul className="mt-1 space-y-1">
                        {check.evidence.mentions.map((mention) => (
                          <MentionItem
                            key={mention.url}
                            title={mention.title}
                            url={mention.url}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Peso {check.weight} pts
                  </p>
                </li>
              );
            })}
          </ol>

          {evaluation.reasons.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Por qué quedó así
              </p>
              <ul className="mt-1.5 space-y-1">
                {evaluation.reasons.map((reason) => (
                  <li key={reason} className="text-[11px] leading-relaxed text-slate-600">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.questions.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                Preguntas abiertas con la empresa
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {evaluation.questions.map((question) => (
                  <li key={question.id} className="text-[11px] leading-relaxed text-amber-900">
                    {question.question}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-3 text-xs text-slate-500">
          Re-evalúa para correr el motor y dejar registrado el resultado.
        </p>
      )}

      <DecisionPanel
        application={application}
        decisions={decisions}
        deciding={deciding}
        onDecide={onDecide}
      />

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">RUT</dt>
          <dd className="text-xs text-slate-700">{application.rut}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Sitio web</dt>
          <dd className="text-xs text-slate-700">
            {application.website ? (
              <a
                href={application.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline"
              >
                {application.website}
              </a>
            ) : (
              'Sin sitio'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Cobertura
          </dt>
          <dd className="text-xs text-slate-700">
            {coverageLabel(application.coverage, application.regions)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Contacto
          </dt>
          <dd className="text-xs text-slate-700">
            {application.contactName} · {application.phone}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Registro
          </dt>
          <dd className="text-xs text-slate-700">
            {application.registrationKind === 'corredora'
              ? 'Corredora'
              : application.registrationKind === 'inmobiliaria'
                ? 'Inmobiliaria'
                : 'Alta directa'}
            {application.contactRole ? ` · ${application.contactRole}` : ''}
          </dd>
        </div>
        {application.message && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Mensaje del registro
            </dt>
            <dd className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
              {application.message}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
