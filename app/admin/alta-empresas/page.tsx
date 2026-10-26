'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronUp,
  Inbox,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  KYB_STATUSES,
  KYB_STATUS_LABELS,
  type KybEvaluation,
  type KybManualDecision,
} from '@/lib/kyb/status';
import type { KybStatus } from '@/lib/kyb/status';
import { KYB_STATUS_TONES } from '@/lib/kyb/portal';
import { formatKybDateTime, scoreTone } from '@/lib/kyb/admin';
import type { KybApplication, KybDecision } from '@/lib/kyb/types';
import KybEvaluationDetail from './KybEvaluationDetail';

/**
 * Alta de empresas en el panel.
 *
 * Es la pantalla donde se **ve la evaluación**: el estado de cada solicitud, su
 * puntaje y, al abrirla, cada verificación con su peso, el detalle de lo que
 * encontró el motor y las preguntas que quedaron abiertas con la empresa.
 *
 * La lista sale de `GET /api/kyb`; el detalle, de `GET /api/kyb/[id]`, y se pide
 * recién al abrir la ficha —son datos de empresa y no hace falta traer todas las
 * verificaciones de todas las solicitudes para pintar la lista—. Desde acá se
 * puede pedir otra corrida del motor; `En_Alta` es terminal y no se re-evalúa.
 *
 * El registro de corredoras e inmobiliarias crea estas solicitudes. Un agente
 * independiente sigue entrando por `/admin/solicitudes`: es una persona, no una
 * empresa que haya que verificar.
 */

type Filter = 'todas' | KybStatus;

interface ListBody {
  success?: boolean;
  data?: KybApplication[];
  persistent?: boolean;
  source?: string;
  error?: string;
}

interface DetailBody {
  success?: boolean;
  data?: {
    application: KybApplication;
    evaluation: KybEvaluation | null;
    decisions?: KybDecision[];
  };
  error?: string;
}

export default function AdminAltaEmpresasPage() {
  const [applications, setApplications] = useState<KybApplication[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('todas');

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    application: KybApplication;
    evaluation: KybEvaluation | null;
    decisions: KybDecision[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reevaluating, setReevaluating] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/kyb', { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as ListBody | null;

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudieron cargar las solicitudes.');
        return;
      }

      setApplications(Array.isArray(body.data) ? body.data : []);
      setPersistent(body.persistent !== false);
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    try {
      const response = await fetch(`/api/kyb/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as DetailBody | null;

      if (!response.ok || !body?.success || !body.data) {
        setDetailError(body?.error ?? 'No se pudo cargar la evaluación.');
        return;
      }

      setDetail({
        application: body.data.application,
        evaluation: body.data.evaluation,
        decisions: Array.isArray(body.data.decisions) ? body.data.decisions : [],
      });
    } catch {
      setDetailError('Sin conexión con el servidor.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    (application: KybApplication) => {
      if (openId === application.id) {
        setOpenId(null);
        setDetail(null);
        setDetailError(null);
        return;
      }
      setOpenId(application.id);
      void loadDetail(application.id);
    },
    [loadDetail, openId]
  );

  const reevaluate = useCallback(
    async (id: string) => {
      setReevaluating(true);
      setDetailError(null);

      try {
        const response = await fetch(`/api/kyb/${encodeURIComponent(id)}/evaluate`, {
          method: 'POST',
        });
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success) {
          setDetailError(body?.error ?? 'No se pudo re-evaluar. Intenta de nuevo.');
          return;
        }

        // La fila se actualiza con lo que devolvió el servidor, no con lo que
        // creemos que pasó: el estado y el puntaje son del motor.
        setApplications((current) =>
          current.map((application) =>
            application.id === id
              ? {
                  ...application,
                  status: body.data.status as KybStatus,
                  score: typeof body.data.score === 'number' ? body.data.score : application.score,
                }
              : application
          )
        );
        await loadDetail(id);
      } catch {
        setDetailError('Sin conexión con el servidor.');
      } finally {
        setReevaluating(false);
      }
    },
    [loadDetail]
  );

  /**
   * Aplica la decisión del equipo y recarga la ficha.
   *
   * La fila de la lista se actualiza con lo que devolvió el servidor y no con
   * lo que el panel creía: después de decidir, el estado y el historial son del
   * backend. `loadDetail` trae también la decisión recién registrada, con su
   * autor.
   */
  const decide = useCallback(
    async (
      id: string,
      input: { decision: KybManualDecision; note?: string; questions?: string[] }
    ) => {
      setDeciding(true);
      setDetailError(null);

      try {
        const response = await fetch(`/api/kyb/${encodeURIComponent(id)}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success) {
          setDetailError(body?.error ?? 'No se pudo aplicar la decisión.');
          return;
        }

        setApplications((current) =>
          current.map((application) =>
            application.id === id
              ? { ...application, status: body.data.status as KybStatus }
              : application
          )
        );
        await loadDetail(id);
      } catch {
        setDetailError('Sin conexión con el servidor.');
      } finally {
        setDeciding(false);
      }
    },
    [loadDetail]
  );

  const counts = useMemo(() => {
    const base: Record<Filter, number> = {
      todas: applications.length,
      Recibida: 0,
      En_Evaluacion: 0,
      Pendiente_Informacion: 0,
      Aceptada: 0,
      En_Alta: 0,
      Rechazada: 0,
    };
    for (const application of applications) base[application.status] += 1;
    return base;
  }, [applications]);

  const visible = useMemo(
    () =>
      filter === 'todas'
        ? applications
        : applications.filter((application) => application.status === filter),
    [applications, filter]
  );

  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'todas', label: 'Todas' },
    ...KYB_STATUSES.map((status) => ({ value: status as Filter, label: KYB_STATUS_LABELS[status] })),
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Alta de empresas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Verificación automática de RUT, registro comercial, reputación, sitio y correo.
            Abre una solicitud para ver por qué quedó en cada estado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div
        className="mt-6 flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrar altas por estado"
      >
        {filters.map((option) => {
          const active = filter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(option.value)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {option.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {counts[option.value]}
              </span>
            </button>
          );
        })}
      </div>

      {!persistent && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Las solicitudes se están leyendo desde memoria del servidor, no desde Supabase. En
          desarrollo se pierden al reiniciar; en producción, revisá la configuración de la base
          antes de dar por guardadas las altas.
        </p>
      )}

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando altas…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="mt-8 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">No se pudieron cargar las altas.</p>
            <p className="mt-0.5 text-xs">{error}</p>
            {error.toLowerCase().includes('sesión') && (
              <Link href="/socio" className="mt-2 inline-block text-xs font-semibold underline">
                Ir al acceso de socios
              </Link>
            )}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {filter === 'todas' ? 'No hay altas de empresas todavía' : 'No hay altas en este estado'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            El registro de{' '}
            <Link href="/registro/corredora" className="font-semibold text-blue-700 hover:underline">
              corredoras
            </Link>{' '}
            e{' '}
            <Link href="/registro/inmobiliaria" className="font-semibold text-blue-700 hover:underline">
              inmobiliarias
            </Link>{' '}
            crea una solicitud evaluada.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {visible.map((application) => {
            const open = openId === application.id;
            const hasDetail = detail?.application.id === application.id;
            const score = application.score;

            return (
              <li
                key={application.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${KYB_STATUS_TONES[application.status]}`}
                        >
                          {KYB_STATUS_LABELS[application.status]}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${scoreTone(score)}`}
                        >
                          {score === null ? 'Sin puntaje' : `${score}/100`}
                        </span>
                        {application.panelEnabled && (
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                            Panel habilitado
                          </span>
                        )}
                      </div>
                      <h2 className="mt-1.5 text-sm font-bold text-slate-900">
                        {application.legalName}
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        RUT {application.rut} · {formatKybDateTime(application.createdAt)} · ref.{' '}
                        <span className="font-mono">{application.id}</span>
                      </p>
                    </div>
                  </div>

                  <div className="text-xs sm:text-right">
                    <a
                      href={`mailto:${application.email}`}
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      {application.email}
                    </a>
                    <p className="text-slate-500">
                      {application.contactName} · {application.phone}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggle(application)}
                      aria-expanded={open}
                      aria-controls={`kyb-detalle-${application.id}`}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {open ? 'Ocultar evaluación' : 'Ver evaluación'}
                      {open ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {open && (
                  <div id={`kyb-detalle-${application.id}`}>
                    {detailLoading ? (
                      <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-6 text-xs text-slate-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cargando evaluación…
                      </div>
                    ) : hasDetail && detail ? (
                      <KybEvaluationDetail
                        application={detail.application}
                        evaluation={detail.evaluation}
                        decisions={detail.decisions}
                        reevaluating={reevaluating}
                        deciding={deciding}
                        error={detailError}
                        onReevaluate={() => void reevaluate(application.id)}
                        onDecide={(input) => void decide(application.id, input)}
                      />
                    ) : (
                      detailError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2 border-t border-slate-100 bg-red-50 px-5 py-4 text-xs text-red-700"
                        >
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div>
                            <p>{detailError}</p>
                            <button
                              type="button"
                              onClick={() => void loadDetail(application.id)}
                              className="mt-1 font-semibold underline"
                            >
                              Reintentar
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
