/**
 * Las siete etapas que ve el solicitante y su marcador.
 *
 * El trámite tiene siete etapas y quien lo recorre no ve el panel: lo que tiene
 * es el correo y la pantalla pública del enlace. Los dos muestran el mismo
 * marcador —«Etapa 2 de 7 · Evaluando» con una barra de siete casillas— para que
 * la bandeja y la web cuenten el mismo recorrido.
 *
 * Vive en `lib/kyb` y no en `lib/email` porque no es del correo: lo usan las
 * plantillas y la barra de las pantallas (`components/kyb/StageProgress.tsx`).
 *
 * La versión de texto usa `■` y `□` (bloques geométricos, U+25A0 y U+25A1) y no
 * emojis: se ven igual en todos los clientes de correo, también en el texto
 * plano, y no dependen de la fuente de emoji del sistema.
 *
 * `Operando` y `Rechazada` quedan fuera: uno es el después del alta y el otro es
 * una salida del trámite. Sin paso no hay marcador, en vez de inventar un
 * octavo.
 */

import type { KybStatus } from './status';

/** Cuántas etapas ve el solicitante, de «Recibida» a «Alta». */
export const APPLICANT_STAGE_TOTAL = 7;

/** Las siete etapas, en el orden en que las recorre el trámite. */
export const APPLICANT_STAGES: readonly { status: KybStatus; label: string; tone: StageTone }[] = [
  { status: 'Recibida', label: 'Recibida', tone: 'waiting' },
  { status: 'En_Evaluacion', label: 'Evaluando', tone: 'waiting' },
  { status: 'Pendiente_Informacion', label: 'Pendiente de información', tone: 'blocked' },
  { status: 'Aceptada', label: 'Aceptada', tone: 'ok' },
  { status: 'Calificado', label: 'Calificado', tone: 'ok' },
  { status: 'Propuesta_Comercial', label: 'Propuesta comercial', tone: 'ok' },
  { status: 'Alta', label: 'Alta', tone: 'ok' },
];

export interface ApplicantStageMark {
  /** 1 a 7. */
  step: number;
  total: number;
  label: string;
  /** Luz del semáforo para esa etapa. */
  tone: StageTone;
  /** `true` en la última etapa: el trámite llegó al final. */
  complete: boolean;
  /** Línea para el texto plano: «Etapa 2 de 7 · Evaluando  ■■□□□□□». */
  text: string;
  /** Mismo marcador como bloque HTML, para el encabezado del cuerpo del correo. */
  html: string;
}

const DONE = '■';
const PENDING = '□';

/**
 * Semáforo del trámite, como el de una calle: verde cuando la etapa está
 * resuelta, ámbar mientras se espera algo (la evaluación o la respuesta del
 * solicitante) y rojo cuando falta un dato para aprobar.
 *
 * Es el color de la parte recorrida del marcador: quien mira la bandeja sabe si
 * tiene que hacer algo sin leer la etiqueta.
 */
export type StageTone = 'ok' | 'waiting' | 'blocked';

export const STAGE_TONE_COLORS: Record<StageTone, string> = {
  ok: '#15803d',
  waiting: '#b45309',
  blocked: '#b91c1c',
};

/**
 * Marcador de una etapa, o `null` si el estado no es una de las siete.
 *
 * Es puro y sin red: las plantillas de correo y la barra de las pantallas lo
 * usan para no repetir en cada una el número, la etiqueta y la barra.
 */
export function applicantStage(status: KybStatus): ApplicantStageMark | null {
  const index = APPLICANT_STAGES.findIndex((stage) => stage.status === status);
  if (index < 0) return null;

  const step = index + 1;
  const total = APPLICANT_STAGE_TOTAL;
  const { label, tone } = APPLICANT_STAGES[index];
  const bar = DONE.repeat(step) + PENDING.repeat(total - step);
  const complete = step === total;
  const doneColor = STAGE_TONE_COLORS[tone];

  return {
    step,
    total,
    label,
    tone,
    complete,
    text: `Etapa ${step} de ${total} · ${label}  ${bar}`,
    html: `<div style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:.08em;color:#64748b">
          <span style="color:${doneColor}">${DONE.repeat(step)}</span><span style="color:#cbd5e1">${PENDING.repeat(total - step)}</span>
          &nbsp; Etapa ${step} de ${total} · ${label}
        </div>`,
  };
}
