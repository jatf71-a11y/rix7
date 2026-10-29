'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle, Loader2, Send } from 'lucide-react';
import type { SolicitudQuestion } from '@/lib/data/solicitudEvaluation';
import { answersPayload, friendlyAnswersError, missingAnswers } from '@/lib/kyb/portal';

/**
 * Formulario de la ronda de preguntas de un registro de socio.
 *
 * El token llega por props desde la página: el formulario no lo lee de la URL,
 * así que la consulta y el envío usan siempre el mismo. Las respuestas se
 * validan acá con la misma regla que el servidor y, si algo falla, lo escrito
 * queda en pantalla: perder cinco respuestas por un corte de red es la peor
 * forma de pedir información.
 *
 * Al responder, el token rota y esta página deja de servir: por eso el cierre
 * dice el resultado y el siguiente paso llega por correo.
 */

const textareaClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function ResponderForm({
  token,
  questions,
  name,
}: {
  token: string;
  questions: SolicitudQuestion[];
  name: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [done, setDone] = useState<{ status: string | null; decision: string | null } | null>(null);

  function update(id: string, value: string) {
    setValues((current) => ({ ...current, [id]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (missingAnswers(questions, values).length > 0) {
      setShowHints(true);
      setError('Responde todas las preguntas para continuar.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch('/api/solicitudes/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, answers: answersPayload(questions, values) }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(friendlyAnswersError(body?.error));
        return;
      }

      setDone({
        status: typeof body.data?.status === 'string' ? body.data.status : null,
        decision: typeof body.data?.decision === 'string' ? body.data.decision : null,
      });
    } catch {
      setError('No pudimos conectarnos. Tus respuestas siguen acá; intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    const accepted = done.decision === 'Aceptada' || done.status === 'Aceptada' || done.status === 'En_Alta';
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle className="h-6 w-6 text-emerald-600" />
        </div>
        <h2 className="text-lg font-black text-slate-900">
          {accepted ? 'Tu registro quedó aceptado' : 'Recibimos tus respuestas'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          {accepted
            ? 'La evaluación automática volvió a correr con lo que aclaraste y el registro pasó. Te escribimos por correo con el siguiente paso.'
            : 'La evaluación automática volvió a correr. Si todavía falta algo, te mandamos un correo nuevo con las preguntas que quedan.'}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volver al portal
        </Link>
      </div>
    );
  }

  const missing = showHints ? missingAnswers(questions, values) : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-black text-slate-900">Necesitamos algunos datos</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Para continuar con el registro de <strong>{name}</strong> en Rix7, aclara estos puntos.
          Cuando envíes las respuestas, la evaluación se repite automáticamente y te contamos el
          resultado por correo.
        </p>
      </div>

      <ol className="space-y-4">
        {questions.map((question, index) => {
          const inputId = `respuesta-${index}`;
          const hintId = `${inputId}-hint`;
          const isMissing = missing.includes(question.id);

          return (
            <li key={question.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <label htmlFor={inputId} className="block text-sm font-semibold text-slate-800">
                <span className="mr-1.5 text-slate-400">{index + 1}.</span>
                {question.question}
              </label>
              <textarea
                id={inputId}
                name={question.id}
                value={values[question.id] ?? ''}
                onChange={(event) => update(question.id, event.target.value)}
                rows={3}
                maxLength={2000}
                autoComplete="off"
                aria-invalid={isMissing || undefined}
                aria-describedby={hintId}
                className={`mt-2 ${textareaClass} ${
                  isMissing ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : ''
                }`}
              />
              <p id={hintId} className="mt-1.5 text-[11px] text-slate-400">
                {isMissing ? 'Escribe al menos dos caracteres.' : 'Máximo 2.000 caracteres.'}
              </p>
            </li>
          );
        })}
      </ol>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Tus respuestas quedan asociadas a tu registro en Rix7.
        </p>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? 'Enviando…' : 'Enviar respuestas'}
        </button>
      </div>
    </form>
  );
}
