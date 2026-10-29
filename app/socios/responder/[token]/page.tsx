import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { hashKybToken, isKybTokenShape } from '@/lib/kyb/tokens';
import { findSolicitudByAnswerToken } from '@/lib/data/solicitudesStore';
import {
  SOLICITUD_REVIEW_KEYS,
  type SolicitudEvaluation,
} from '@/lib/data/solicitudEvaluation';
import ResponderForm from './ResponderForm';

/**
 * Página pública de respuestas de un registro de socio.
 *
 * Es el otro extremo del correo «falta un dato»: el token de la URL se hashea y
 * se busca en el `payload` de la solicitud. Si no existe, no es de esta ronda o
 * la solicitud ya no espera respuestas, se dice con el mismo mensaje —no se
 * distingue «no existe» de «venció»— porque en los tres casos lo que hace falta
 * es un enlace nuevo.
 *
 * `noindex`: es una pantalla de trámite con un token en la URL; no tiene nada
 * que hacer en un buscador.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Responder el registro | Rix7',
  robots: { index: false, follow: false },
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <AlertCircle className="h-6 w-6 text-slate-500" />
      </div>
      <h1 className="text-lg font-black text-slate-900">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        Volver al portal
      </Link>
    </div>
  );
}

export default async function ResponderPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;

  const solicitud = isKybTokenShape(token)
    ? await findSolicitudByAnswerToken(hashKybToken(token))
    : null;

  if (!solicitud) {
    return (
      <div className="bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Notice
            title="Este enlace no es válido"
            body="El enlace que abriste no existe o ya se usó. Responde el último correo de Rix7 para que te enviemos uno nuevo."
          />
        </div>
      </div>
    );
  }

  if (solicitud.status !== 'Pendiente_Informacion') {
    return (
      <div className="bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Notice
            title="Este registro ya no espera respuestas"
            body="La solicitud avanzó y el enlace dejó de servir. Si necesitas corregir algo, responde el último correo de Rix7."
          />
        </div>
      </div>
    );
  }

  const evaluation = solicitud.payload[SOLICITUD_REVIEW_KEYS.evaluation] as
    | SolicitudEvaluation
    | undefined;
  const questions = Array.isArray(evaluation?.questions) ? evaluation.questions : [];

  if (questions.length === 0) {
    return (
      <div className="bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Notice
            title="No hay preguntas pendientes"
            body="Tu registro está en revisión y no necesitamos nada más por ahora. Te escribimos con el resultado."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 py-12">
      <div className="mx-auto max-w-2xl px-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
            Registro de socios · Rix7
          </p>
          <div className="mt-3">
            <ResponderForm token={token} questions={questions} name={solicitud.company || solicitud.name} />
          </div>
        </div>
      </div>
    </div>
  );
}
