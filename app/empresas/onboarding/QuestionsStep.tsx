'use client';

import React, { useState } from 'react';
import { AlertCircle, Loader2, Send } from 'lucide-react';
import type { KybQuestion } from '@/lib/kyb/status';
import { answersPayload, friendlyAnswersError, missingAnswers } from '@/lib/kyb/portal';

/**
 * Formulario de la ronda de preguntas abierta.
 *
 * El token llega por props desde la página: el formulario no lo lee de la URL
 * para que la consulta de estado y el envío usen siempre el mismo. Las
 * respuestas se validan acá con la misma regla que el servidor (dos caracteres
 * como mínimo) y, si algo falla, lo escrito queda en pantalla: perder cinco
 * respuestas por un corte de red es la peor forma de pedir información.
 *
 * El servidor no devuelve una confirmación para volver a consultar: al
 * responder, el token rota y el enlace que abrió esta página deja de servir.
 * Por eso el padre muestra una pantalla de cierre y el siguiente paso llega
 * por correo.
 */

const textareaClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

interface QuestionsStepProps {
  token: string;
  questions: KybQuestion[];
  /** `accepted` es true cuando las respuestas dejaron la solicitud en En_Alta. */
  onAnswered: (accepted: boolean) => void;
}

export default function QuestionsStep({ token, questions, onAnswered }: QuestionsStepProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);

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
      const response = await fetch('/api/kyb/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, answers: answersPayload(questions, values) }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(friendlyAnswersError(body?.error));
        return;
      }

      onAnswered(body.data?.status === 'En_Alta');
    } catch {
      setError('No pudimos conectarnos. Tus respuestas siguen acá; intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  const missing = showHints ? missingAnswers(questions, values) : [];

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
      <div>
        <h2 className="text-lg font-black text-slate-900">Necesitamos algunos datos</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Responde cada punto con el detalle que puedas. Cuando envíes las respuestas, la
          verificación se repite automáticamente y te escribimos con el resultado.
        </p>
      </div>

      <ol className="space-y-4">
        {questions.map((question, index) => {
          const inputId = `kyb-answer-${index}`;
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
          Tus respuestas quedan asociadas a la solicitud de tu empresa.
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
