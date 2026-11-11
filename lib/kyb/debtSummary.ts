/**
 * Resumen del informe de deudas de la CMF para la ficha del panel.
 *
 * El detalle completo ya vive en `DebtReportPanel`, pero está al final de la
 * ficha: para saber si la empresa debe algo había que bajar hasta ahí. Lo que el
 * equipo necesita al decidir son tres números y una fecha, y van junto al
 * puntaje, que es donde mira primero.
 *
 * Es puro y sin Intl dependiente del entorno: los montos y la fecha se formatean
 * acá para que el componente solo elija el color. La fecha se arma cortando el
 * `YYYY-MM-DD` y no con `Date`, porque el texto se renderiza después del fetch y
 * no queremos que una zona horaria corra el día.
 */

import {
  isDebtReportOutdated,
  type DebtReportAnalysis,
} from './debtReport';

export type DebtSummaryTone = 'clean' | 'warning' | 'unknown';

export interface DebtSummary {
  tone: DebtSummaryTone;
  /** `$1.234.567` o `sin dato` si el PDF no trajo el monto. */
  total: string;
  overdue: string;
  writtenOff: string;
  /** `dd-mm-aaaa`, o `sin fecha` si el informe no la trae legible. */
  issuedOn: string;
  /** El informe supera los 30 días: la CMF publica con desfase. */
  outdated: boolean;
  /** `false` cuando el PDF no tenía capa de texto. */
  read: boolean;
}

function clp(value: number | null): string {
  if (value === null) return 'sin dato';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

function shortDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'sin fecha';
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

/**
 * Resumen de un informe, o `null` si no hay ninguno.
 *
 * El tono no decide nada: `warning` es deuda impaga o castigada, o un informe
 * viejo; `unknown` es un PDF que no se pudo leer o sin montos reconocidos. Un
 * informe limpio queda en `clean`. Tener deuda vigente no advierte —un crédito
 * hipotecario es normal—; lo que advierte es la mora.
 */
export function debtSummary(
  analysis: DebtReportAnalysis | null,
  now: Date = new Date()
): DebtSummary | null {
  if (!analysis) return null;

  // De un PDF sin capa de texto no se muestran cifras aunque el análisis traiga
  // alguna: no se pudieron verificar y leerlas como deuda real es peor que
  // decir «sin dato».
  const total = analysis.read ? analysis.totalDebtClp : null;
  const overdue = analysis.read ? (analysis.overdueClp ?? null) : null;
  const writtenOff = analysis.read ? (analysis.writtenOffClp ?? null) : null;
  const outdated = isDebtReportOutdated(analysis.issuedAt, now);

  const hasMora = (overdue !== null && overdue > 0) || (writtenOff !== null && writtenOff > 0);
  const tone: DebtSummaryTone = !analysis.read
    ? 'unknown'
    : hasMora || outdated
      ? 'warning'
      : total === null
        ? 'unknown'
        : 'clean';

  return {
    tone,
    total: clp(total),
    overdue: clp(overdue),
    writtenOff: clp(writtenOff),
    issuedOn: shortDate(analysis.issuedAt),
    outdated,
    read: analysis.read,
  };
}
