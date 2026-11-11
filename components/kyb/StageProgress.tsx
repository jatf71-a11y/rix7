import React from 'react';

import { APPLICANT_STAGES, applicantStage, type StageTone } from '@/lib/kyb/stages';
import type { KybStatus } from '@/lib/kyb/status';

/** Azul de marca mientras avanza; rojo solo si hay algo que aclarar. */
const TONE_BAR: Record<StageTone, string> = {
  brand: 'bg-blue-600',
  attention: 'bg-red-600',
};

const TONE_PAST: Record<StageTone, string> = {
  brand: 'bg-blue-300',
  attention: 'bg-red-300',
};

const TONE_TEXT: Record<StageTone, string> = {
  brand: 'text-blue-700',
  attention: 'text-red-700',
};

/**
 * La misma barra de siete etapas que encabeza los correos, en la web.
 *
 * El solicitante ve el proceso por dos canales: el correo y la pantalla del
 * enlace. Si el correo dice «Etapa 3 de 7 · Pendiente de información» y la
 * pantalla no dice nada, el trámite parece empezar de cero cada vez. Acá se
 * dibuja la misma escalera con el criterio del correo: azul de marca, con la
 * etapa actual más marcada que las pasadas y lo pendiente en gris, y en rojo
 * cuando la etapa pide una aclaración.
 *
 * No es interactiva ni conoce el flujo: recibe el estado y lo traduce con
 * `applicantStage`, igual que las plantillas. `Operando` y `Rechazada` no se
 * dibujan.
 */
export default function StageProgress({
  status,
  className = '',
}: {
  status: KybStatus;
  className?: string;
}) {
  const mark = applicantStage(status);
  if (!mark) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          Etapa {mark.step} de {mark.total}
        </p>
        <p className={`text-[11px] font-bold ${TONE_TEXT[mark.tone]}`}>{mark.label}</p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={mark.total}
        aria-valuenow={mark.step}
        aria-label={`Etapa ${mark.step} de ${mark.total}: ${mark.label}`}
        className="mt-2 flex gap-1.5"
      >
        {APPLICANT_STAGES.map((stage, index) => {
          const step = index + 1;
          const tone =
            step > mark.step
              ? 'bg-slate-200'
              : step === mark.step
                ? TONE_BAR[mark.tone]
                : TONE_PAST[mark.tone];

          return (
            <span
              key={stage.status}
              title={`${step}. ${stage.label}`}
              className={`h-1.5 flex-1 rounded-full ${tone}`}
            />
          );
        })}
      </div>
    </div>
  );
}
