import React from 'react';

import { APPLICANT_STAGES, applicantStage, type StageTone } from '@/lib/kyb/stages';
import type { KybStatus } from '@/lib/kyb/status';

/** Semáforo de la barra: el mismo criterio que el marcador de los correos. */
const TONE_BAR: Record<StageTone, string> = {
  ok: 'bg-green-600',
  waiting: 'bg-amber-500',
  blocked: 'bg-red-600',
};

const TONE_TEXT: Record<StageTone, string> = {
  ok: 'text-green-700',
  waiting: 'text-amber-700',
  blocked: 'text-red-700',
};

/**
 * La misma barra de siete etapas que encabeza los correos, en la web.
 *
 * El solicitante ve el proceso por dos canales: el correo y la pantalla del
 * enlace. Si el correo dice «Etapa 3 de 7 · Pendiente de información» y la
 * pantalla no dice nada, el trámite parece empezar de cero cada vez. Acá se
 * dibuja la misma escalera con el semáforo del correo: verde cuando la etapa
 * está resuelta, ámbar mientras se espera algo y rojo cuando falta un dato. Las
 * etapas ya pasadas llevan la misma luz, atenuada, y las que faltan quedan en
 * gris.
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
              : `${TONE_BAR[mark.tone]}${step === mark.step ? '' : ' opacity-40'}`;

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
