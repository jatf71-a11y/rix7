'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Home, Inbox, Loader2, RefreshCw } from 'lucide-react';
import {
  SOLICITUD_STATUSES,
  SOLICITUD_STATUS_LABELS,
  solicitudDetails,
  type Solicitud,
  type SolicitudStatus,
} from '@/lib/data/solicitudes';
import { formatKybDateTime } from '@/lib/kyb/admin';
import LeadsTabs from '../LeadsTabs';

/**
 * Propietarios que piden propuestas.
 *
 * Vive en Leads y no en Solicitudes porque no es el registro de un socio: un
 * propietario sin corredora pide que varias agencias compitan por publicar su
 * propiedad. Se revisa en el mismo lugar que los contactos que llegan desde una
 * ficha, con la diferencia de que acá hay un inmueble concreto —operación,
 * tipo, comuna, precio esperado y ROL— que hay que leer antes de responder.
 *
 * El estado se mueve a mano, como en toda la bandeja: acá nadie dispara correos
 * ni tokens. La fila se reemplaza con lo que devuelve la API, así que un rechazo
 * del guard se ve en la tarjeta en vez de quedar como un estado que nunca se
 * guardó.
 */
export default function AdminPropietariosPage() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/solicitudes?kind=propuestas', { cache: 'no-store' });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudieron cargar los propietarios.');
        return;
      }

      setSolicitudes(Array.isArray(body.data) ? body.data : []);
      setPersistent(body.persistent !== false);
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      window.dispatchEvent(new Event('rix7:solicitudes-actualizadas'));
    } catch {
      setActionError({ id, message: 'Sin conexión con el servidor.' });
    } finally {
      setSavingId(null);
    }
  }, []);

  /** Cuántos hay en cada etapa, para el resumen del encabezado. */
  const porEtapa = useMemo(() => {
    const counts: Record<SolicitudStatus, number> = {
      Recibida: 0,
      En_Evaluacion: 0,
      Pendiente_Informacion: 0,
      Aceptada: 0,
      En_Alta: 0,
      Operando: 0,
      Rechazada: 0,
    };
    for (const solicitud of solicitudes) counts[solicitud.status] += 1;
    return counts;
  }, [solicitudes]);

  return (
    <div className="max-w-6xl">
      <LeadsTabs />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Propietarios</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? 'Cargando…'
              : error
                ? 'No se pudo leer la lista'
                : `${solicitudes.length} pedido${solicitudes.length === 1 ? '' : 's'} de propuestas · ${porEtapa.Recibida} sin revisar`}
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

      {persistent === false && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Los pedidos se están leyendo desde memoria del servidor, no desde Supabase. En desarrollo
          se pierden al reiniciar; en producción, revisá la configuración de la base antes de dar
          por guardados los pedidos.
        </p>
      )}

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando propietarios…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="mt-8 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">No se pudieron cargar los propietarios.</p>
            <p className="mt-0.5 text-xs">{error}</p>
            {error.toLowerCase().includes('sesión') && (
              <Link href="/socio" className="mt-2 inline-block text-xs font-semibold underline">
                Ir al acceso de socios
              </Link>
            )}
          </div>
        </div>
      ) : solicitudes.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            No hay propietarios pidiendo propuestas todavía
          </p>
          <p className="mt-1 text-xs text-slate-500">
            El formulario de{' '}
            <Link href="/publicar/propietario" className="font-semibold text-blue-700 hover:underline">
              propietarios
            </Link>{' '}
            deja acá el pedido de cada inmueble.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {solicitudes.map((solicitud) => {
            const details = solicitudDetails(solicitud);
            const saving = savingId === solicitud.id;

            return (
              <li
                key={solicitud.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                      <Home className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                          Propietario
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {SOLICITUD_STATUS_LABELS[solicitud.status]}
                        </span>
                      </div>
                      <h2 className="mt-1.5 text-sm font-bold text-slate-900">
                        {solicitud.name} quiere{' '}
                        {solicitud.payload?.operation === 'rent' ? 'arrendar' : 'vender'} una
                        propiedad
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        {formatKybDateTime(solicitud.createdAt)} · ref.{' '}
                        <span className="font-mono">{solicitud.id}</span>
                      </p>
                    </div>
                  </div>

                  <div className="text-xs sm:text-right">
                    <a href={`mailto:${solicitud.email}`} className="block text-blue-700 hover:underline">
                      {solicitud.email}
                    </a>
                    <a href={`tel:${solicitud.phone}`} className="block text-slate-500 hover:underline">
                      {solicitud.phone}
                    </a>

                    <div className="mt-2 flex items-center gap-2 sm:justify-end">
                      <label
                        htmlFor={`estado-${solicitud.id}`}
                        className="text-[10px] font-bold uppercase tracking-wide text-slate-400"
                      >
                        Estado
                      </label>
                      <select
                        id={`estado-${solicitud.id}`}
                        value={solicitud.status}
                        disabled={saving}
                        onChange={(event) =>
                          void changeStatus(solicitud.id, event.target.value as SolicitudStatus)
                        }
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

                    {actionError?.id === solicitud.id && (
                      <p role="alert" className="mt-1.5 max-w-[16rem] text-[11px] text-red-600 sm:text-right">
                        {actionError.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                  {details.map((detail) => (
                    <div key={detail.label}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {detail.label}
                      </p>
                      <p className="text-xs text-slate-700">{detail.value}</p>
                    </div>
                  ))}

                  {solicitud.message && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 sm:col-span-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Mensaje
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                        {solicitud.message}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
