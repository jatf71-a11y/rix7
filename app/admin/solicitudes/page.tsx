'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  Home,
  Inbox,
  Landmark,
  Loader2,
  RefreshCw,
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
 * Reúne los tres caminos en una sola lista porque el equipo los revisa en el
 * mismo lugar, pero no los mezcla: las pestañas y el color del tipo permiten
 * distinguir una licitación de propietario de un registro de empresa. El detalle
 * sale de `solicitudDetails`, que es el mismo módulo que valida los datos, así
 * que el panel no inventa campos que el formulario no pidió.
 *
 * El estado (`nueva`, `en_revision`, `contactada`, `cerrada`) se cambia desde
 * cada tarjeta: es el flujo de revisión, y es lo único que la bandeja escribe.
 * El cambio se manda a la API y se reemplaza la fila con la que devuelve la base
 * —no se pinta el estado elegido por adelantado— para que un rechazo (sesión
 * vencida, RLS, fila borrada) se vea en la tarjeta en vez de quedar como un
 * estado que nunca se guardó.
 */

const KIND_STYLE: Record<
  SolicitudKind,
  { label: string; badge: string; icon: typeof Home }
> = {
  licitacion: {
    label: 'Licitación',
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
};

const FILTERS: Array<{ value: 'todas' | SolicitudKind; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'licitacion', label: 'Licitaciones' },
  { value: 'corredora', label: 'Corredoras' },
  { value: 'inmobiliaria', label: 'Inmobiliarias' },
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function solicitudTitle(solicitud: Solicitud): string {
  if (solicitud.kind === 'licitacion') {
    return `${solicitud.name} quiere ${
      solicitud.payload.operation === 'rent' ? 'arrendar' : 'vender'
    } una propiedad`;
  }
  return solicitud.company ?? solicitud.name;
}

export default function AdminSolicitudesPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todas' | SolicitudKind>('todas');
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
      licitacion: 0,
      corredora: 0,
      inmobiliaria: 0,
    };
    for (const solicitud of solicitudes) base[solicitud.kind] += 1;
    return base;
  }, [solicitudes]);

  const visible = useMemo(
    () => (filter === 'todas' ? solicitudes : solicitudes.filter((s) => s.kind === filter)),
    [filter, solicitudes]
  );

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Solicitudes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Licitaciones de propietarios y registros de corredoras e inmobiliarias.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
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
