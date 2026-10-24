'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { KYB_STATUS_LABELS, type KybStatus } from '@/lib/kyb/status';
import {
  evaluatingCopy,
  KYB_STATUS_TONES,
  planName,
  portalStage,
  type KybAccessView,
} from '@/lib/kyb/portal';
import QuestionsStep from './QuestionsStep';
import PlanStep from './PlanStep';

/**
 * Pantalla del alta de empresas, la que abre el enlace del correo.
 *
 * No pide sesión: el token de la URL identifica la solicitud. Todo lo que
 * muestra sale de `POST /api/kyb/access`, que devuelve solo el estado, las
 * preguntas abiertas y si ya toca elegir plan — nunca el puntaje ni las
 * verificaciones internas.
 *
 * Después de responder o activar **no se vuelve a consultar** con el token
 * actual: cada cambio de estado emite un token nuevo y el anterior deja de
 * servir. La pantalla cierra el paso con lo que devolvió la API y el enlace
 * siguiente viaja por correo.
 */

type Screen =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; view: KybAccessView }
  | { kind: 'answered'; accepted: boolean }
  | { kind: 'activated'; plan: string | null; emailed: boolean };

interface AccessBody {
  success?: boolean;
  data?: KybAccessView;
  error?: string;
}

function StatusPill({ status }: { status: KybStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[11px] font-bold ${KYB_STATUS_TONES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {KYB_STATUS_LABELS[status]}
    </span>
  );
}

function PanelAccess({ plan, title }: { plan: string | null; title: string }) {
  const name = planName(plan);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-black text-slate-900">{title}</h2>
          {name && <p className="text-xs font-semibold text-slate-500">Plan {name}</p>}
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        Desde el panel puedes publicar propiedades, editar tus fichas y ver los contactos que
        recibes.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/socio"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          Ir a mi panel
        </Link>
        <Link
          href="/socio/publicar"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Publicar una propiedad
        </Link>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        Entra con el correo corporativo de la empresa. Si pediste un enlace de acceso, vale un
        solo uso.
      </p>
    </div>
  );
}

export default function KybOnboarding() {
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();

  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (value: string) => {
    requestRef.current?.abort();

    if (!value) {
      setScreen({
        kind: 'invalid',
        message: 'El enlace no trae la identificación de la solicitud.',
      });
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setScreen({ kind: 'loading' });

    try {
      const response = await fetch('/api/kyb/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: value }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as AccessBody | null;

      if (!response.ok || !body?.success || !body.data) {
        const message = body?.error ?? 'No pudimos leer el estado de tu solicitud.';
        // Un 403 es «este enlace no vale»; el resto es un fallo pasajero que
        // tiene sentido reintentar sin pedirle a la empresa otro correo.
        setScreen(
          response.status === 403
            ? { kind: 'invalid', message }
            : { kind: 'error', message }
        );
        return;
      }

      setScreen({ kind: 'ready', view: body.data });
    } catch {
      if (controller.signal.aborted) return;
      setScreen({
        kind: 'error',
        message: 'No pudimos conectarnos con Rix7. Revisa tu conexión e intenta de nuevo.',
      });
    }
  }, []);

  useEffect(() => {
    void load(token);
    return () => requestRef.current?.abort();
  }, [load, token]);

  const view = screen.kind === 'ready' ? screen.view : null;
  const stage = view ? portalStage(view) : null;

  let content: React.ReactNode;

  if (screen.kind === 'loading') {
    content = (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-500">Leyendo el estado de tu solicitud…</p>
      </div>
    );
  } else if (screen.kind === 'invalid') {
    content = (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-black text-slate-900">Este enlace ya no sirve</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{screen.message}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Los enlaces valen 7 días y se renuevan cada vez que la solicitud avanza. Abre el
          último correo que te enviamos; si tampoco funciona, respóndelo y lo revisamos.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al portal
        </Link>
      </div>
    );
  } else if (screen.kind === 'error') {
    content = (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-black text-slate-900">No pudimos cargar tu solicitud</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{screen.message}</p>
        <button
          type="button"
          onClick={() => void load(token)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </button>
      </div>
    );
  } else if (screen.kind === 'answered') {
    content = screen.accepted ? (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-black text-slate-900">Tu empresa quedó aceptada</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          Te enviamos al correo de la empresa el enlace para elegir el plan y habilitar el panel
          de publicaciones. Vale 7 días.
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Si no llega en unos minutos, revisa el correo no deseado.
        </p>
      </div>
    ) : (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-black text-slate-900">Recibimos tus respuestas</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          La verificación se está repitiendo con lo que enviaste. Si necesitamos un dato más, te
          escribimos con las preguntas y un enlace nuevo.
        </p>
      </div>
    );
  } else if (screen.kind === 'activated') {
    content = (
      <div>
        <PanelAccess plan={screen.plan} title="Tu panel está habilitado" />
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          {screen.emailed
            ? 'Te enviamos un enlace de acceso de un solo uso al correo de la empresa.'
            : 'El correo de acceso no salió en este intento: entra al panel con el correo corporativo de la empresa.'}
        </p>
      </div>
    );
  } else if (view && stage === 'questions') {
    content = (
      <QuestionsStep
        token={token}
        questions={view.questions}
        onAnswered={(accepted) => setScreen({ kind: 'answered', accepted })}
      />
    );
  } else if (view && stage === 'plans') {
    content = (
      <PlanStep
        token={token}
        onActivated={({ plan, emailed }) => setScreen({ kind: 'activated', plan, emailed })}
      />
    );
  } else if (view && stage === 'active') {
    content = <PanelAccess plan={view.plan} title="Tu panel está habilitado" />;
  } else if (view) {
    const copy = evaluatingCopy(view.status);
    content = (
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-black text-slate-900">{copy.title}</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{copy.body}</p>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Puedes cerrar esta página: el aviso llega al correo de la empresa.
        </p>
      </div>
    );
  } else {
    content = null;
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Volver al portal
        </Link>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-800">
              Alta de empresas
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Tu alta en Rix7
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {view ? (
                <>
                  Solicitud de{' '}
                  <strong className="font-semibold text-slate-800">{view.legalName}</strong>
                </>
              ) : (
                'Verificación automática de empresas que quieren publicar en el portal.'
              )}
            </p>
          </div>

          {view && <StatusPill status={view.status} />}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {content}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
          Este enlace es personal e identifica el trámite de tu empresa. Si lo reenvías, otra
          persona puede ver el estado de la solicitud.
        </p>
      </div>
    </div>
  );
}
