'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  Columns3,
  Home,
  Inbox,
  Landmark,
  List,
  Loader2,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import {
  SOLICITUD_KIND_LABELS,
  SOLICITUD_STATUSES,
  SOLICITUD_STATUS_LABELS,
  solicitudDetails,
  type Solicitud,
  type SolicitudKind,
  type SolicitudStatus,
} from '@/lib/data/solicitudes';

/**
 * Bandeja de solicitudes de «Publicar».
 *
 * Reúne los cuatro caminos en una sola lista porque el equipo los revisa en el
 * mismo lugar, pero no los mezcla: las pestañas y el color del tipo permiten
 * distinguir una solicitud de propietario de un registro de empresa. El detalle
 * sale de `solicitudDetails`, que es el mismo módulo que valida los datos, así
 * que el panel no inventa campos que el formulario no pidió.
 *
 * El estado se cambia desde cada tarjeta y ofrece **los mismos seis valores del
 * alta de empresas** —desde `Recibida` hasta `En_Alta`, con `Rechazada`—, porque
 * el equipo pregunta lo mismo en las dos pantallas y dos vocabularios obligaban
 * a traducir de cabeza. Se mueve a mano y sin reglas de transición: acá nadie
 * dispara correos ni tokens, que es lo que el alta sí tiene que cuidar.
 * El cambio se manda a la API y se reemplaza la fila con la que devuelve la base
 * —no se pinta el estado elegido por adelantado— para que un rechazo (sesión
 * vencida, RLS, fila borrada) se vea en la tarjeta en vez de quedar como un
 * estado que nunca se guardó.
 *
 * La bandeja se puede mirar de dos maneras: **lista** (el detalle completo, una
 * tarjeta por solicitud) y **tablero** (una columna por etapa). El tablero no es
 * otra fuente de datos ni otra ruta: agrupa las filas ya cargadas, así que los
 * conteos de las columnas suman el total del filtro y mover una tarjeta no pide
 * nada de nuevo. El filtro por tipo sigue valiendo en las dos vistas.
 *
 * Ojo con la diferencia: acá la etapa la **mueve una persona** desde el selector,
 * mientras que en `/admin/alta-empresas` la escribe el motor de evaluación. Los
 * dos tableros usan los mismos seis nombres, pero uno es una decisión y el otro
 * un resultado; el de esta pantalla no dice que alguien evaluó nada.
 */

const KIND_STYLE: Record<
  SolicitudKind,
  { label: string; badge: string; icon: typeof Home }
> = {
  propuestas: {
    label: 'Propietario',
    badge: 'bg-amber-100 text-amber-800',
    icon: Home,
  },
  corredora: {
    label: 'Corredora',
    badge: 'bg-blue-100 text-blue-800',
    icon: Building2,
  },
  inmobiliaria: {
    label: 'Inmobiliaria',
    badge: 'bg-emerald-100 text-emerald-800',
    icon: Landmark,
  },
  agente: {
    label: 'Agente',
    badge: 'bg-violet-100 text-violet-800',
    icon: UserRound,
  },
};

const FILTERS: Array<{ value: 'todas' | SolicitudKind; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'propuestas', label: 'Propietarios' },
  { value: 'corredora', label: 'Corredoras' },
  { value: 'inmobiliaria', label: 'Inmobiliarias' },
  { value: 'agente', label: 'Agentes' },
];

/**
 * Acento de cada columna del tablero.
 *
 * El color no reemplaza la etiqueta —cada columna dice su nombre—: es lo que
 * permite reconocer la etapa de un vistazo cuando el tablero está lleno. Los dos
 * terminales (`En_Alta` y `Rechazada`) se distinguen del resto porque ahí ya no
 * hay nada que hacer.
 */
const STATUS_STYLE: Record<SolicitudStatus, { column: string; dot: string }> = {
  Recibida: { column: 'border-slate-200', dot: 'bg-slate-400' },
  En_Evaluacion: { column: 'border-blue-200', dot: 'bg-blue-500' },
  Pendiente_Informacion: { column: 'border-amber-200', dot: 'bg-amber-500' },
  Aceptada: { column: 'border-emerald-200', dot: 'bg-emerald-500' },
  En_Alta: { column: 'border-violet-200', dot: 'bg-violet-500' },
  Rechazada: { column: 'border-rose-200', dot: 'bg-rose-400' },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function solicitudTitle(solicitud: Solicitud): string {
  if (solicitud.kind === 'propuestas') {
    return `${solicitud.name} quiere ${
      solicitud.payload.operation === 'rent' ? 'arrendar' : 'vender'
    } una propiedad`;
  }
  // Un agente es una persona: sin empresa no hay «Catedral Propiedades» que
  // poner en el título, y el badge de tipo ya dice «Agente».
  if (solicitud.kind === 'agente') return solicitud.name;
  return solicitud.company ?? solicitud.name;
}

export default function AdminSolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todas' | SolicitudKind>('todas');
  // Arranca en el tablero: es la pregunta con la que se entra («¿en qué etapa
  // está cada pedido?»). La lista, con el detalle completo, queda a un clic.
  const [view, setView] = useState<'lista' | 'tablero'>('tablero');
  const [storage, setStorage] = useState<{ persistent: boolean; source: string } | null>(null);
  /** Id de la solicitud que está guardando su estado, para deshabilitar sólo esa. */
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Error del último cambio, atado a su tarjeta: el resto sigue operativo. */
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/solicitudes', { cache: 'no-store' });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? 'No se pudieron cargar las solicitudes.');
        return;
      }

      setSolicitudes(Array.isArray(body?.data) ? body.data : []);
      setStorage({
        persistent: body?.persistent !== false,
        source: body?.source ?? 'memory',
      });
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Mueve una solicitud de estado y reemplaza la fila con la que devuelve la API.
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

      // El badge de la navegación cuenta las «nuevas»: este es el aviso para
      // que se actualice sin recargar el panel.
      window.dispatchEvent(new Event('rix7:solicitudes-actualizadas'));
    } catch {
      setActionError({ id, message: 'Sin conexión con el servidor.' });
    } finally {
      setSavingId(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<'todas' | SolicitudKind, number> = {
      todas: solicitudes.length,
      propuestas: 0,
      corredora: 0,
      inmobiliaria: 0,
      agente: 0,
    };
    for (const solicitud of solicitudes) base[solicitud.kind] += 1;
    return base;
  }, [solicitudes]);

  const visible = useMemo(
    () => (filter === 'todas' ? solicitudes : solicitudes.filter((s) => s.kind === filter)),
    [filter, solicitudes]
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
        items: visible.filter((solicitud) => solicitud.status === status),
      })),
    [visible]
  );

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Solicitudes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Propietarios que buscan propuestas y registros de corredoras, inmobiliarias y agentes.
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
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo de solicitud">
        {FILTERS.map((option) => {
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

      {storage && !storage.persistent && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Las solicitudes se están leyendo desde memoria del servidor, no desde Supabase.
          En desarrollo se pierden al reiniciar; en producción, revisá la configuración de
          la base antes de dar por guardados los pedidos.
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
          <p className="mt-3 text-sm font-semibold text-slate-700">No hay solicitudes todavía</p>
          <p className="mt-1 text-xs text-slate-500">
            {filter === 'todas'
              ? 'Cuando alguien use Publicar, su pedido va a aparecer acá.'
              : 'No hay pedidos de este tipo por ahora.'}
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
                  items.map((solicitud) => {
                    const kind = KIND_STYLE[solicitud.kind];
                    return (
                      <article
                        key={solicitud.id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${kind.badge}`}
                          >
                            {kind.label}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatDate(solicitud.createdAt)}
                          </span>
                        </div>

                        <h3 className="mt-1.5 text-xs font-bold leading-snug text-slate-900">
                          {solicitudTitle(solicitud)}
                        </h3>
                        <p className="mt-1 truncate text-[11px] text-slate-500">{solicitud.name}</p>
                        <a
                          href={`mailto:${solicitud.email}`}
                          className="block truncate text-[11px] text-blue-700 hover:underline"
                        >
                          {solicitud.email}
                        </a>

                        <div className="mt-2 flex items-center gap-1.5">
                          <label htmlFor={`estado-tablero-${solicitud.id}`} className="sr-only">
                            Estado
                          </label>
                          <select
                            id={`estado-tablero-${solicitud.id}`}
                            value={solicitud.status}
                            disabled={savingId === solicitud.id}
                            onChange={(event) =>
                              changeStatus(solicitud.id, event.target.value as SolicitudStatus)
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                          >
                            {SOLICITUD_STATUSES.map((option) => (
                              <option key={option} value={option}>
                                {SOLICITUD_STATUS_LABELS[option]}
                              </option>
                            ))}
                          </select>
                          {savingId === solicitud.id && (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                          )}
                        </div>

                        {actionError?.id === solicitud.id && (
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
          {visible.map((solicitud) => {
            const kind = KIND_STYLE[solicitud.kind];
            const details = solicitudDetails(solicitud);

            return (
              <li
                key={solicitud.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind.badge}`}>
                      <kind.icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${kind.badge}`}>
                          {kind.label}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {SOLICITUD_STATUS_LABELS[solicitud.status]}
                        </span>
                      </div>
                      <h2 className="mt-1.5 text-sm font-bold text-slate-900">
                        {solicitudTitle(solicitud)}
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        {formatDate(solicitud.createdAt)} · ref. {solicitud.id}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs sm:text-right">
                    <p className="font-semibold text-slate-700">{solicitud.name}</p>
                    <a
                      href={`mailto:${solicitud.email}`}
                      className="block text-blue-700 hover:underline"
                    >
                      {solicitud.email}
                    </a>
                    <a href={`tel:${solicitud.phone}`} className="block text-slate-500 hover:underline">
                      {solicitud.phone}
                    </a>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      {details.map((detail) => (
                        <div key={detail.label}>
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {detail.label}
                          </dt>
                          <dd className="text-xs text-slate-700">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>

                    {solicitud.message && (
                      <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Mensaje
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                          {solicitud.message}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 self-start sm:items-end">
                    <p className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {SOLICITUD_KIND_LABELS[solicitud.kind]}
                    </p>

                    <div className="flex items-center gap-2">
                      <label
                        htmlFor={`estado-${solicitud.id}`}
                        className="text-[10px] font-bold uppercase tracking-wide text-slate-400"
                      >
                        Estado
                      </label>
                      <select
                        id={`estado-${solicitud.id}`}
                        value={solicitud.status}
                        disabled={savingId === solicitud.id}
                        onChange={(event) =>
                          changeStatus(solicitud.id, event.target.value as SolicitudStatus)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                      >
                        {SOLICITUD_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {SOLICITUD_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                      {savingId === solicitud.id && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                      )}
                    </div>

                    {actionError?.id === solicitud.id && (
                      <p role="alert" className="max-w-[16rem] text-[11px] text-red-600 sm:text-right">
                        {actionError.message}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
