'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';

import {
  validateDebtReportFile,
  type DebtReportAnalysis,
} from '@/lib/kyb/debtReport';

/**
 * Campo del informe de deudas en la ronda de preguntas.
 *
 * Sube el PDF en el momento —no al enviar el formulario— para que la persona vea
 * si se leyó bien antes de responder el resto. El id del documento queda como
 * valor de la pregunta, así el envío de respuestas sigue siendo el mismo JSON de
 * siempre y el servidor puede comprobar que el archivo es de esta solicitud.
 *
 * La lectura automática se muestra tal cual: si el PDF no tenía texto, se dice
 * en vez de dar por bueno un archivo que nadie va a poder revisar.
 */
export default function DebtReportField({
  token,
  value,
  onUploaded,
  disabled,
}: {
  token: string;
  /** Id del documento ya subido, si lo hay. */
  value: string;
  onUploaded: (documentId: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(value || null);
  const [analysis, setAnalysis] = useState<DebtReportAnalysis | null>(null);

  async function handleFile(file: File | undefined | null) {
    if (!file || uploading) return;
    setError(null);

    const valid = validateDebtReportFile({ name: file.name, type: file.type, size: file.size });
    if (!valid.ok) {
      setError(valid.error);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('token', token);
      form.append('file', file);

      const response = await fetch('/api/kyb/documents', { method: 'POST', body: form });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo subir el informe.');
        return;
      }

      const document = body.data?.document;
      if (!document?.id) {
        setError('No se pudo registrar el informe. Intenta de nuevo.');
        return;
      }

      setUploaded(document.fileName ?? file.name);
      setAnalysis(document.analysis ?? null);
      onUploaded(String(document.id));
    } catch {
      setError('No pudimos conectarnos. El informe no se subió; intenta de nuevo.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
      <p className="text-[11px] leading-relaxed text-slate-500">
        PDF · máximo 10 MB. Se lee automáticamente al subirlo.
      </p>

      <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-3 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-400 hover:text-blue-700">
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : uploaded ? (
          <FileText className="h-4 w-4" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {uploading ? 'Subiendo y leyendo el informe…' : uploaded ? 'Reemplazar el informe' : 'Subir el informe en PDF'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={uploading || disabled}
          className="sr-only"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>

      {uploaded && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> {uploaded}
        </p>
      )}

      {analysis && (
        <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          <p className={analysis.read ? 'text-slate-700' : 'text-amber-700'}>{analysis.summary}</p>
          {analysis.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-500">
              {analysis.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
