import React from 'react';

import type { DebtReportView } from '@/lib/kyb/documents';
import { debtSummary } from '@/lib/kyb/debtSummary';

/**
 * La deuda del último informe CMF, en una línea junto al puntaje.
 *
 * El detalle del informe está al final de la ficha; esto es lo que se mira
 * antes de decidir: cuánto debe, cuánto está impago y de cuándo es el documento.
 * Si el informe no se pudo leer dice «sin dato» en vez de mostrar ceros, y la
 * fecha se tiñe cuando supera los 30 días —la CMF publica con desfase—.
 *
 * No muestra nada si la ficha no tiene informes: el detalle de abajo ya explica
 * en qué etapa se pide.
 */
export default function DebtSummary({ documents }: { documents: DebtReportView[] | null }) {
  const summary = debtSummary(documents?.[0]?.analysis ?? null);
  if (!summary) return null;

  const tone =
    summary.tone === 'clean'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : summary.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-100 text-slate-600';

  const title = summary.read
    ? `Informe CMF emitido el ${summary.issuedOn}. Total ${summary.total}, impaga ${summary.overdue}, castigada ${summary.writtenOff}.`
    : 'El último informe CMF no tiene texto legible: no hay montos para mostrar.';

  return (
    <span
      title={title}
      className={`inline-flex flex-wrap items-center gap-x-2 rounded-lg border px-2.5 py-1 text-[10px] font-semibold ${tone}`}
    >
      <span className="uppercase tracking-wide">Deuda CMF</span>
      <span>{summary.total} total</span>
      <span>{summary.overdue} impaga</span>
      {summary.writtenOff !== 'sin dato' && summary.writtenOff !== '$0' && (
        <span>{summary.writtenOff} castigada</span>
      )}
      <span className={summary.outdated ? 'font-black underline' : 'font-normal opacity-80'}>
        emitido {summary.issuedOn}
      </span>
    </span>
  );
}
