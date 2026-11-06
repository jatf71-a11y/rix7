'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

import type { DebtReportView } from '@/lib/kyb/documents';
import { debtReportAgeDays, isDebtReportOutdated } from '@/lib/kyb/debtReport';

/**
 * Los informes de deudas de una ficha, ya leídos.
 *
 * El equipo decide con tres números —total adeudado, deudas impagas y número de
 * acreedores— y no abriendo el PDF, así que esos van primero; el archivo queda
 * como respaldo para cuando algo no cuadra. Si el PDF no tenía texto se dice
 * (`unreadable`) en vez de mostrar ceros: un informe que no se pudo leer no es
 * un informe sin deuda.
 *
 * Se carga aparte de la ficha para que un Storage lento no retrase el resto del
 * panel, y se calla si no hay informes: la ficha ya dice en qué etapa está.
 */
function clp(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DebtReportPanel({
  ownerKind,
  ownerId,
}: {
  ownerKind: 'alta' | 'solicitud';
  ownerId: string;
}) {
  const [documents, setDocuments] = useState<DebtReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ owner_kind: ownerKind, owner_id: ownerId });
      const response = await fetch(`/api/admin/kyb/documents?${query.toString()}`);
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo leer el informe de deudas.');
        return;
      }
      setDocuments(Array.isArray(body.data?.documents) ? body.data.documents : []);
    } catch {
      setError('Sin conexión con el servidor.');
    }
  }, [ownerKind, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
      </p>
    );
  }

  if (documents === null) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[11px] text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando el informe de deudas…
      </p>
    );
  }

  if (documents.length === 0) return null;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <FileText className="h-3.5 w-3.5" /> Informe de deudas
      </p>

      <ul className="mt-2 space-y-3">
        {documents.map((document) => {
          const analysis = document.analysis;
          return (
            <li key={document.id} className="rounded-lg bg-slate-50 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold text-slate-800">
                  {document.kind === 'juridica'
                    ? 'Informe de Deudas de Personas Jurídicas'
                    : 'Informe de Deudas de Personas Naturales'}
                  <span className="ml-1.5 font-normal text-slate-400">
                    {new Date(document.createdAt).toLocaleDateString('es-CL')}
                  </span>
                  {analysis.issuedAt && (
                    <span className="ml-1.5 font-normal text-slate-400">
                      · emitido {new Date(`${analysis.issuedAt}T00:00:00`).toLocaleDateString('es-CL')}
                    </span>
                  )}
                </p>
                {document.url ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-semibold text-blue-700 hover:underline"
                  >
                    Ver PDF
                  </a>
                ) : (
                  <span className="text-[10px] text-slate-400">sin enlace</span>
                )}
              </div>

              <p
                className={`mt-1 text-[11px] leading-relaxed ${
                  analysis.read ? 'text-slate-600' : 'text-amber-700'
                }`}
              >
                {analysis.summary}
              </p>

              {/*
                La CMF actualiza los datos semanalmente, así que un informe de
                hace más de un mes puede describir una deuda que ya no es la de
                hoy aunque se haya subido ayer. El aviso no invalida el
                documento: pide uno actualizado antes de decidir con él.
              */}
              {isDebtReportOutdated(analysis.issuedAt) && (
                <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold leading-relaxed text-amber-800">
                  El informe se emitió hace {debtReportAgeDays(analysis.issuedAt)} días. Pide uno
                  actualizado: la CMF publica los datos con desfase y este puede no reflejar la deuda
                  de hoy.
                </p>
              )}

              {analysis.read && (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-400">Total adeudado</dt>
                    <dd className="font-bold text-slate-800">{clp(analysis.totalDebtClp)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Deudas impagas</dt>
                    <dd className="font-bold text-slate-800">{clp(analysis.overdueClp)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Acreedores</dt>
                    <dd className="font-bold text-slate-800">{analysis.creditors ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Deuda vigente</dt>
                    <dd className="font-bold text-slate-800">{clp(analysis.currentClp)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Castigadas</dt>
                    <dd className="font-bold text-slate-800">{clp(analysis.writtenOffClp)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">RUT del informe</dt>
                    <dd className="font-bold text-slate-800">{analysis.rut ?? '—'}</dd>
                  </div>
                </dl>
              )}

              {analysis.notes.length > 0 && (
                <ul className="mt-1.5 list-disc pl-4 text-[10px] leading-relaxed text-slate-500">
                  {analysis.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
