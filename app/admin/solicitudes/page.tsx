'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  Columns3,
  Inbox,
  Landmark,
  List,
  Loader2,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import {
  SOLICITUD_STATUSES,
  SOLICITUD_STATUS_LABELS,
  solicitudDetails,
  type Solicitud,
  type SolicitudStatus,
} from '@/lib/data/solicitudes';
import {
  buildSocios,
  SOCIO_CATEGORY_LABELS,
  socioCounts,
  type SocioCategory,
  type SocioFilter,
  type SocioSolicitud,
} from '@/lib/data/socios';
import {
  SOLICITUD_REVIEW_KEYS,
  type SolicitudEvaluation,
} from '@/lib/data/solicitudEvaluation';
import { formatKybDateTime, scoreTone } from '@/lib/kyb/admin';
import { KYB_STATUS_TONES } from '@/lib/kyb/portal';
import type { KybEvaluation, KybManualDecision } from '@/lib/kyb/status';
import type { KybApplication, KybDecision } from '@/lib/kyb/types';
import KybEvaluationDetail from '@/components/admin/kyb/KybEvaluationDetail';

/**
 * Panel de socios: los registros de profesionales independientes y las altas
 * evaluadas, en un solo
 * lugar.
 *
 * Antes había dos pantallas para la misma pregunta —la bandeja de «Publicar» y
 * el alta de empresas— y el equipo tenía que recordar en cuál estaba cada
 * corredora. Acá se leen juntas y se separan por **categoría de socio**
 * (corredora, inmobiliaria, profesional independiente), que es como se reparte
 * el trabajo.
 *
 * Los propietarios que piden propuestas **no** están acá: entran por «Publicar»
 * con un pedido sobre una propiedad, no con un registro de socio, y viven en
 * Leads.
 *
 * Las dos fuentes no se pueden tratar igual, y la tarjeta lo dice:
 *
 * - una **alta** pasó por el motor de evaluación. Su estado lo mueven las
 *   decisiones del equipo (`Aceptada`, `Pendiente_Informacion`, `Rechazada`),
 *   que disparan correos y tokens, así que desde acá no hay un selector de
 *   estado: se abre la ficha y se decide con la evaluación a la vista.
 * - un **registro** (corredora, inmobiliaria o profesional independiente)
 *   también se evalúa solo,
 *   con las reglas de `lib/data/solicitudEvaluation.ts`: al recibirse pasa a
 *   `Aceptada` o a `Pendiente_Informacion`, se le escribe al solicitante y el
 *   enlace del correo lo deja responder. La tarjeta muestra ese puntaje y el
 *   selector queda para las excepciones que el equipo quiera mover a mano.
 *
 * La vista de tablero agrupa en columnas por etapa lo que ya está cargado, así
 * que los conteos suman el total del filtro y ninguna columna pide datos
 * nuevos. El filtro por categoría vale en las dos vistas.
 */

const CATEGORY_STYLE: Record<
  SocioCategory,
  { badge: string; icon: typeof Building2 }
> = {
  corredora: { badge: 'bg-blue-100 text-blue-800', icon: Building2 },
  inmobiliaria: { badge: 'bg-emerald-100 text-emerald-800', icon: Landmark },
  agente: { badge: 'bg-violet-100 text-violet-800', icon: UserRound },
  empresa: { badge: 'bg-slate-200 text-slate-700', icon: Building2 },
};

/**
 * Acento de cada columna del tablero.
 *
 * El color no reemplaza la etiqueta —cada columna dice su nombre—: es lo que
 * permite reconocer la etapa de un vistazo cuando el tablero está lleno. Los
 * terminales (`Operando` y `Rechazada`) se distinguen del resto porque ahí ya no
 * hay nada que hacer; `Alta` va justo antes de `Operando`, que es el paso que
 * cierra el alta cuando la empresa elige y paga su plan.
 */
const STATUS_STYLE: Record<SolicitudStatus, { column: string; dot: string }> = {
  Recibida: { column: 'border-slate-200', dot: 'bg-slate-400' },
  En_Evaluacion: { column: 'border-blue-200', dot: 'bg-blue-500' },
  Pendiente_Informacion: { column: 'border-amber-200', dot: 'bg-amber-500' },
  Aceptada: { column: 'border-emerald-200', dot: 'bg-emerald-500' },
  En_Alta: { column: 'border-violet-200', dot: 'bg-violet-500' },
  Operando: { column: 'border-teal-200', dot: 'bg-teal-500' },
  Rechazada: { column: 'border-rose-200', dot: 'bg-rose-400' },
};

interface DetailState {
  application: KybApplication;
  evaluation: KybEvaluation | null;
  decisions: KybDecision[];
}

interface ListBody {
  success?: boolean;
  data?: KybApplication[];
  persistent?: boolean;
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

interface SolicitudesBody {
  success?: boolean;
  data?: Solicitud[];
  persistent?: boolean;
  error?: string;
}

export default function AdminSolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [applications, setApplications] = useState<KybApplication[]>([]);
  const [loading, setLoading] = useState(true);
  /** Falla de las dos fuentes: sin datos no hay panel que mostrar. */
  const [error, setError] = useState<string | null>(null);
  /** Falla de una sola fuente: se dice cuál, y el resto sigue usable. */
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ registros: boolean | null; altas: boolean | null }>({
    registros: null,
    altas: null,
  });

  const [filter, setFilter] = useState<SocioFilter>('todas');
  // Arranca en el tablero: es la pregunta con la que se entra («¿en qué etapa
  // está cada socio?»). La lista, con la ficha y las decisiones, queda a un clic.
  const [view, setView] = useState<'lista' | 'tablero'>('tablero');

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reevaluating, setReevaluating] = useState(false);
  const [deciding, setDeciding] = useState(false);

  /** Id del registro independiente que está guardando su estado. */
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Id del registro que se está volviendo a evaluar con el motor. */
  const [reEvaluatingId, setReEvaluatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadWarning(null);

    try {
      const [registrosResponse, altasResponse] = await Promise.all([
        fetch('/api/solicitudes', { cache: 'no-store' }),
        fetch('/api/kyb', { cache: 'no-store' }),
      ]);

      const registrosBody = (await registrosResponse.json().catch(() => null)) as
        | SolicitudesBody
        | null;
      const altasBody = (await altasResponse.json().catch(() => null)) as ListBody | null;

      const failures: string[] = [];
      let okRegistros: boolean | null = null;
      let okAltas: boolean | null = null;

      if (registrosResponse.ok && registrosBody?.success) {
        setSolicitudes(Array.isArray(registrosBody.data) ? registrosBody.data : []);
        okRegistros = registrosBody.persistent !== false;
      } else {
        failures.push(
          registrosBody?.error ?? 'No se pudieron cargar los registros de profesionales independientes.'
        );
      }

      if (altasResponse.ok && altasBody?.success) {
        setApplications(Array.isArray(altasBody.data) ? altasBody.data : []);
        okAltas = altasBody.persistent !== false;
      } else {
        failures.push(altasBody?.error ?? 'No se pudieron cargar las altas evaluadas.');
      }

      setStorage({ registros: okRegistros, altas: okAltas });

      // Con una fuente arriba el panel sigue sirviendo: se avisa qué falta en
      // vez de tapar todo con un error. Con las dos caídas no hay nada que ver.
      if (failures.length === 2) setError(failures.join(' '));
      else if (failures.length === 1) setLoadWarning(failures[0]);
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
    (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
        setDetailError(null);
        return;
      }
      setOpenId(id);
      void loadDetail(id);
    },
    [loadDetail, openId]
  );

  /**
   * Abre la ficha desde el tablero.
   *
   * El tablero sirve para ubicarse; decidir exige ver la evaluación, que no
   * entra en una tarjeta. Así que la acción cambia a la lista con esa fila
   * abierta, en vez de duplicar la ficha dentro de la columna.
   */
  const openInList = useCallback(
    (id: string) => {
      setView('lista');
      setOpenId(id);
      void loadDetail(id);
    },
    [loadDetail]
  );

  /**
   * Mueve el estado de un registro de agente y reemplaza la fila con la que
   * devuelve la API.
   *
   * No hay actualización optimista a propósito: si el guard rechaza (sesión
   * vencida) o la fila ya no existe, el `<select>` tiene que volver a mostrar el
   * estado real, y eso sólo pasa si el valor sale del estado del servidor.
   */
  const changeStatus = useCallback(async (id: string, status: SolicitudStatus) => {
    setSavingId(id);
    setActionError(null);

    try {
      const response = await fetch('/api/solicitudes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.solicitud) {
        setActionError({
          id,
          message: body?.error ?? 'No se pudo cambiar el estado. Intenta de nuevo.',
        });
        return;
      }

      setSolicitudes((prev) =>
        prev.map((solicitud) => (solicitud.id === id ? (body.solicitud as Solicitud) : solicitud))
      );

      // El badge de la navegación cuenta las nuevas: este es el aviso para que
      // se actualice sin recargar el panel.
      window.dispatchEvent(new Event('rix7:solicitudes-actualizadas'));
    } catch {
      setActionError({ id, message: 'Sin conexión con el servidor.' });
    } finally {
      setSavingId(null);
    }
  }, []);

  /**
   * Vuelve a pasar el motor sobre un registro.
   *
   * Es la salida del equipo cuando el dato ya se corrigió por otra vía (una
   * llamada, un correo): la misma evaluación del alta, con su correo. Se recarga
   * la bandeja porque el resultado y las preguntas viven en `payload`.
   */
  const reevaluateRegistro = useCallback(
    async (id: string) => {
      setReEvaluatingId(id);
      setActionError(null);

      try {
        const response = await fetch(
          `/api/admin/solicitudes/${encodeURIComponent(id)}/evaluate`,
          { method: 'POST' }
        );
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.success) {
          setActionError({
            id,
            message: body?.error ?? 'No se pudo re-evaluar. Intenta de nuevo.',
          });
          return;
        }

        await load();
        window.dispatchEvent(new Event('rix7:solicitudes-actualizadas'));
      } catch {
        setActionError({ id, message: 'Sin conexión con el servidor.' });
      } finally {
        setReEvaluatingId(null);
      }
    },
    [load]
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
                  status: body.data.status as SolicitudStatus,
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
   * La fila de la lista se actualiza con lo que devolvió el servidor y no con lo
   * que el panel creía: después de decidir, el estado y el historial son del
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
              ? { ...application, status: body.data.status as SolicitudStatus }
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

  const socios = useMemo(() => buildSocios(applications, solicitudes), [applications, solicitudes]);

  const counts = useMemo(() => socioCounts(socios), [socios]);

  /**
   * Los chips de categoría.
   *
   * «Empresa sin tipo» solo aparece si hay alguna: es una categoría de excepción
   * (altas que llegaron sin decir cómo se registraron) y un chip en cero
   * permanente solo agrega ruido a la fila.
   */
  const filters = useMemo<Array<{ value: SocioFilter; label: string }>>(() => {
    const base: Array<{ value: SocioFilter; label: string }> = [
      { value: 'todas', label: 'Todas' },
      { value: 'corredora', label: SOCIO_CATEGORY_LABELS.corredora },
      { value: 'inmobiliaria', label: SOCIO_CATEGORY_LABELS.inmobiliaria },
      { value: 'agente', label: SOCIO_CATEGORY_LABELS.agente },
    ];
    if (counts.empresa > 0) {
      base.push({ value: 'empresa', label: SOCIO_CATEGORY_LABELS.empresa });
    }
    return base;
  }, [counts.empresa]);

  const visible = useMemo(
    () => (filter === 'todas' ? socios : socios.filter((socio) => socio.category === filter)),
    [filter, socios]
  );

  /**
   * Las columnas del tablero, en el orden del alta.
   *
   * Sale de `SOLICITUD_STATUSES`, así que si el alta suma una etapa aparece acá
   * sin tocar esta página. Las filas de una columna conservan el orden del
   * listado (la más reciente arriba).
   */
  const board = useMemo(
    () =>
      SOLICITUD_STATUSES.map((status) => ({
        status,
        items: visible.filter((socio) => socio.status === status),
      })),
    [visible]
  );

  const memoria = [
    storage.registros === false ? 'los registros de profesionales independientes' : null,
    storage.altas === false ? 'las altas evaluadas' : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Solicitudes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Corredoras, inmobiliarias y profesionales independientes, con la evaluación de su alta.
            Los propietarios que
            buscan propuestas están en{' '}
            <Link
              href="/admin/leads/propietarios"
              className="font-semibold text-blue-700 hover:underline"
            >
              Leads
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div
            className="inline-flex rounded-lg border border-slate-300 p-0.5"
            role="group"
            aria-label="Cómo ver las solicitudes"
          >
            {([
              { value: 'tablero' as const, label: 'Pipeline', icon: Columns3 },
              { value: 'lista' as const, label: 'Lista', icon: List },
            ]).map((option) => {
              const active = view === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setView(option.value)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      <div
        className="mt-6 flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrar por categoría de socio"
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

      {memoria.length > 0 && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Se están leyendo desde memoria del servidor, no desde Supabase: {memoria.join(' y ')}. En
          desarrollo se pierden al reiniciar; en producción, revisá la configuración de la base
          antes de dar por guardadas las solicitudes.
        </p>
      )}

      {loadWarning && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{loadWarning} El resto del panel sigue mostrando lo que sí se pudo leer.</span>
        </p>
      )}

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando solicitudes…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="mt-8 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">No se pudieron cargar las solicitudes.</p>
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
            {filter === 'todas' ? 'No hay solicitudes de socios todavía' : 'No hay socios en esta categoría'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            El registro de{' '}
            <Link href="/registro/corredora" className="font-semibold text-blue-700 hover:underline">
              corredoras
            </Link>{' '}
            e{' '}
            <Link
              href="/registro/inmobiliaria"
              className="font-semibold text-blue-700 hover:underline"
            >
              inmobiliarias
            </Link>{' '}
            crea una solicitud que se evalúa sola y avisa por correo.
          </p>
        </div>
      ) : view === 'tablero' ? (
        <div
          className="mt-6 grid grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-4 overflow-x-auto pb-3"
          role="group"
          aria-label="Solicitudes por etapa"
        >
          {board.map(({ status, items }) => (
            <section
              key={status}
              aria-label={`${SOLICITUD_STATUS_LABELS[status]}: ${items.length} solicitud(es)`}
              className={`flex min-h-[13rem] flex-col rounded-2xl border bg-slate-50/70 ${STATUS_STYLE[status].column}`}
            >
              <header className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[status].dot}`} aria-hidden="true" />
                  {SOLICITUD_STATUS_LABELS[status]}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                  {items.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2 p-2.5">
                {items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 px-2 py-4 text-center text-[11px] text-slate-400">
                    Sin solicitudes
                  </p>
                ) : (
                  items.map((socio) => {
                    const kind = CATEGORY_STYLE[socio.category];
                    return (
                      <article
                        key={`${socio.source}-${socio.id}`}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${kind.badge}`}
                          >
                            {SOCIO_CATEGORY_LABELS[socio.category]}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatKybDateTime(socio.createdAt)}
                          </span>
                        </div>

                        <h3 className="mt-1.5 text-xs font-bold leading-snug text-slate-900">
                          {socio.name}
                        </h3>
                        <p className="mt-1 truncate text-[11px] text-slate-500">
                          {socio.contactName}
                        </p>
                        <a
                          href={`mailto:${socio.email}`}
                          className="block truncate text-[11px] text-blue-700 hover:underline"
                        >
                          {socio.email}
                        </a>

                        {socio.source === 'alta' ? (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${scoreTone(socio.score)}`}
                            >
                              {socio.score === null ? 'Sin puntaje' : `${socio.score}/100`}
                            </span>
                            <button
                              type="button"
                              onClick={() => openInList(socio.id)}
                              className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              Abrir ficha
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 flex items-center gap-1.5">
                            <label htmlFor={`estado-tablero-${socio.id}`} className="sr-only">
                              Estado
                            </label>
                            <select
                              id={`estado-tablero-${socio.id}`}
                              value={socio.status}
                              disabled={savingId === socio.id}
                              onChange={(event) =>
                                changeStatus(socio.id, event.target.value as SolicitudStatus)
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                            >
                              {SOLICITUD_STATUSES.map((option) => (
                                <option key={option} value={option}>
                                  {SOLICITUD_STATUS_LABELS[option]}
                                </option>
                              ))}
                            </select>
                            {savingId === socio.id && (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                            )}
                          </div>
                        )}

                        {actionError?.id === socio.id && (
                          <p role="alert" className="mt-1.5 text-[10px] text-red-600">
                            {actionError.message}
                          </p>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {visible.map((socio) => (
            <SocioRow
              key={`${socio.source}-${socio.id}`}
              socio={socio}
              solicitud={
                socio.source === 'registro'
                  ? solicitudes.find((item) => item.id === socio.id) ?? null
                  : null
              }
              open={openId === socio.id}
              detail={detail?.application.id === socio.id ? detail : null}
              detailLoading={detailLoading && openId === socio.id}
              detailError={openId === socio.id ? detailError : null}
              reevaluating={reevaluating}
              deciding={deciding}
              saving={savingId === socio.id}
              actionError={actionError?.id === socio.id ? actionError.message : null}
              onToggle={() => toggle(socio.id)}
              onRetryDetail={() => void loadDetail(socio.id)}
              onStatusChange={(status) => void changeStatus(socio.id, status)}
              onReevaluate={() => void reevaluate(socio.id)}
              onDecide={(input) => void decide(socio.id, input)}
              reevaluatingRegistro={reEvaluatingId === socio.id}
              onReevaluateRegistro={() => void reevaluateRegistro(socio.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SocioRowProps {
  socio: SocioSolicitud;
  /** La fila original de «Publicar», para el detalle de un registro independiente. */
  solicitud: Solicitud | null;
  open: boolean;
  detail: DetailState | null;
  detailLoading: boolean;
  detailError: string | null;
  reevaluating: boolean;
  deciding: boolean;
  saving: boolean;
  actionError: string | null;
  onToggle: () => void;
  onRetryDetail: () => void;
  onStatusChange: (status: SolicitudStatus) => void;
  onReevaluate: () => void;
  onDecide: (input: { decision: KybManualDecision; note?: string; questions?: string[] }) => void;
  /** Registro: volver a pasar el motor con los datos que haya hoy. */
  reevaluatingRegistro: boolean;
  onReevaluateRegistro: () => void;
}

/**
 * Una fila de la lista.
 *
 * Vive aparte para que el `map` del panel no cargue con el detalle de una
 * tarjeta: las de alta tienen ficha plegable y decisión; las independientes, los
 * campos del formulario y un selector. Comparten encabezado porque el equipo
 * las lee en la misma lista.
 */
function SocioRow({
  socio,
  solicitud,
  open,
  detail,
  detailLoading,
  detailError,
  reevaluating,
  deciding,
  saving,
  actionError,
  onToggle,
  onRetryDetail,
  onStatusChange,
  onReevaluate,
  onDecide,
  reevaluatingRegistro,
  onReevaluateRegistro,
}: SocioRowProps) {
  const kind = CATEGORY_STYLE[socio.category];
  const isAlta = socio.source === 'alta';
  const details = solicitud ? solicitudDetails(solicitud) : [];
  const evaluation =
    (solicitud?.payload[SOLICITUD_REVIEW_KEYS.evaluation] as SolicitudEvaluation | undefined) ?? null;

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind.badge}`}
          >
            <kind.icon className="h-4 w-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kind.badge}`}
              >
                {SOCIO_CATEGORY_LABELS[socio.category]}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${KYB_STATUS_TONES[socio.status]}`}
              >
                {SOLICITUD_STATUS_LABELS[socio.status]}
              </span>
              {isAlta && (
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${scoreTone(socio.score)}`}>
                  {socio.score === null ? 'Sin puntaje' : `${socio.score}/100`}
                </span>
              )}
              {socio.panelEnabled && (
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  Panel habilitado
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-sm font-bold text-slate-900">{socio.name}</h2>
            <p className="text-[11px] text-slate-400">
              {socio.rut ? `RUT ${socio.rut} · ` : ''}
              {formatKybDateTime(socio.createdAt)} · ref.{' '}
              <span className="font-mono">{socio.id}</span>
            </p>
          </div>
        </div>

        <div className="text-xs sm:text-right">
          <p className="font-semibold text-slate-700">{socio.contactName}</p>
          <a href={`mailto:${socio.email}`} className="block text-blue-700 hover:underline">
            {socio.email}
          </a>
          <a href={`tel:${socio.phone}`} className="block text-slate-500 hover:underline">
            {socio.phone}
          </a>

          {isAlta ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={`detalle-${socio.id}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {open ? 'Ocultar evaluación' : 'Ver evaluación'}
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2 sm:justify-end">
              <label
                htmlFor={`estado-${socio.id}`}
                className="text-[10px] font-bold uppercase tracking-wide text-slate-400"
              >
                Estado
              </label>
              <select
                id={`estado-${socio.id}`}
                value={socio.status}
                disabled={saving}
                onChange={(event) => onStatusChange(event.target.value as SolicitudStatus)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {SOLICITUD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SOLICITUD_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
          )}

          {!isAlta && (
            <button
              type="button"
              onClick={onReevaluateRegistro}
              disabled={reevaluatingRegistro}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              title="Volver a pasar la evaluación automática y avisar el resultado"
            >
              {reevaluatingRegistro ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {reevaluatingRegistro ? 'Evaluando…' : 'Re-evaluar'}
            </button>
          )}

          {actionError && (
            <p role="alert" className="mt-1.5 max-w-[16rem] text-[11px] text-red-600 sm:text-right">
              {actionError}
            </p>
          )}
        </div>
      </div>

      {isAlta ? (
        open && (
          <div id={`detalle-${socio.id}`}>
            {detailLoading ? (
              <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-6 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando evaluación…
              </div>
            ) : detail ? (
              <KybEvaluationDetail
                application={detail.application}
                evaluation={detail.evaluation}
                decisions={detail.decisions}
                reevaluating={reevaluating}
                deciding={deciding}
                error={detailError}
                onReevaluate={onReevaluate}
                onDecide={onDecide}
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
                    <button type="button" onClick={onRetryDetail} className="mt-1 font-semibold underline">
                      Reintentar
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )
      ) : (
        <div className="border-t border-slate-100">
          {evaluation && <SolicitudEvaluationSummary evaluation={evaluation} />}
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          {details.map((item) => (
            <div key={item.label}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {item.label}
              </p>
              <p className="text-xs text-slate-700">{item.value}</p>
            </div>
          ))}

          {socio.message && (
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Mensaje</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                {socio.message}
              </p>
            </div>
          )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Cómo quedó la evaluación automática de un registro.
 *
 * El equipo no ve un número suelto: ve qué se miró, qué advirtió y qué se le
 * preguntó a la persona. Sin ese sustento, «62/100 · Pendiente de información»
 * no dice nada y la única salida sería confiar en el motor a ciegas.
 */
function SolicitudEvaluationSummary({ evaluation }: { evaluation: SolicitudEvaluation }) {
  const tone =
    evaluation.decision === 'Aceptada'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-amber-50 text-amber-800 border-amber-200';

  return (
    <div className="bg-slate-50/70 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${scoreTone(evaluation.score)}`}>
          {evaluation.score}/100
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone}`}>
          {evaluation.decision === 'Aceptada' ? 'Aceptada por el motor' : 'Pidió información'}
        </span>
        <span className="text-[10px] text-slate-400">
          Evaluación automática · {formatKybDateTime(evaluation.createdAt)}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {evaluation.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span
              aria-hidden="true"
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                check.status === 'pass'
                  ? 'bg-emerald-500'
                  : check.status === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
            />
            <span className="text-slate-600">
              <strong className="font-semibold text-slate-800">{check.label}:</strong> {check.detail}
            </span>
          </li>
        ))}
      </ul>

      {evaluation.questions.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Se le preguntó al solicitante
          </p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-900">
            {evaluation.questions.map((question) => (
              <li key={question.id}>{question.question}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
