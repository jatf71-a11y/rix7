'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CirclePlus,
  Eye,
  Link2,
  Loader2,
  Pencil,
  Share2,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { PanelProperty } from '@/lib/data/propertiesStore';
import type { PartnerEngagement } from '@/lib/data/partnerEngagement';
import { leadChannelLabel, leadSourceLabel } from '@/lib/data/leads';
import { shareChannelLabel } from '@/lib/data/shareEvents';
import { formatPrice, getStatusLabel } from '@/lib/utils/formatters';
import ShareDialog from '@/components/socio/ShareDialog';
import SocioAccessNotice from './SocioAccessNotice';

/**
 * Panel del socio: la lista de SUS publicaciones con las cuatro gestiones del
 * encargo — publicar (CTA), administrar (editar) y gestionar (ver ficha,
 * eliminar) — más el resumen de stock.
 *
 * Los errores de acceso no se tragan ni se muestran genéricos: un 401 invita a
 * entrar, un 403 explica el motivo exacto que devolvió el guard (sin rol, o
 * cuenta sin corredora vinculada). Son estados distintos y la persona necesita
 * saber cuál es para poder hacer algo.
 */

const STATUS_STYLES: Record<string, string> = {
  for_sale: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  for_rent: 'bg-blue-50 text-blue-700 border-blue-200',
  sold: 'bg-slate-100 text-slate-500 border-slate-200',
  // Arriendo concretado: mismo tono "cerrado" que Vendido, pero distinguishible.
  rented: 'bg-violet-50 text-violet-700 border-violet-200',
};

const TOAST_KEY = 'rix7-socio-toast';

/** Ventanas de la actividad. El servidor acota cualquier valor que reciba. */
const ENGAGEMENT_WINDOWS = [7, 30, 90] as const;

/**
 * Formatea una conversión (contactos ÷ compartidos).
 *
 * `null` no es «0 %»: sin compartidos la tasa no se puede calcular, y mostrarla
 * como 0 % diría que el enlace fracasó cuando nunca se movió.
 */
function formatConversion(rate: number | null): string {
  if (rate === null) return '—';
  if (rate > 0 && rate < 0.01) return '< 1 %';
  return `${Math.round(rate * 100)} %`;
}

/** Fecha y hora cortas, en el formato del resto de los paneles. */
function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SocioPanelPage() {
  const [properties, setProperties] = useState<PanelProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<{ status: number; message: string } | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<PanelProperty | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [engagement, setEngagement] = useState<PartnerEngagement | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(true);
  const [engagementError, setEngagementError] = useState<string | null>(null);
  const [engagementPersistent, setEngagementPersistent] = useState(true);
  const [engagementDays, setEngagementDays] = useState<number>(30);

  const load = useCallback(async () => {
    setLoading(true);
    setAccess(null);
    try {
      const res = await fetch('/api/partner/properties', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setAccess({ status: res.status, message: body?.error ?? 'No se pudo cargar.' });
        setProperties([]);
        return;
      }
      setProperties(Array.isArray(body.data) ? body.data : []);
      setPersistent(body.persistent !== false);
    } catch {
      setAccess({ status: 0, message: 'Sin conexión con el servidor.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // Actividad de los enlaces: se pide aparte del stock para que un fallo en el
  // informe no deje el panel de publicaciones sin cargar (y al revés).
  useEffect(() => {
    let cancelled = false;
    setEngagementLoading(true);

    fetch(`/api/partner/engagement?days=${engagementDays}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setEngagement(null);
          setEngagementError(body?.error ?? 'No se pudo cargar la actividad.');
          return;
        }
        setEngagement(body?.data ?? null);
        setEngagementPersistent(body?.persistent !== false);
        setEngagementError(null);
      })
      .catch(() => {
        if (!cancelled) setEngagementError('Sin conexión con el servidor.');
      })
      .finally(() => {
        if (!cancelled) setEngagementLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [engagementDays, reloadKey]);

  // Aviso dejado por la página de crear/editar antes de volver acá.
  useEffect(() => {
    try {
      const message = sessionStorage.getItem(TOAST_KEY);
      if (message) {
        setToast(message);
        sessionStorage.removeItem(TOAST_KEY);
        const timer = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(timer);
      }
    } catch {
      // sessionStorage puede no estar disponible: el aviso es prescindible.
    }
  }, []);

  async function handleDelete(property: PanelProperty) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/partner/properties?id=${encodeURIComponent(property.id)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setToast(null);
        setAccess({ status: res.status, message: body?.error ?? 'No se pudo eliminar.' });
        return;
      }
      setProperties((prev) => prev.filter((p) => p.id !== property.id));
      setToast(
        body?.persisted === false
          ? 'Publicación eliminada (solo en memoria: desarrollo sin Supabase).'
          : 'Publicación eliminada.'
      );
    } finally {
      setBusy(false);
      setDeletingId(null);
    }
  }

  const count = (status: string) => properties.filter((p) => p.status === status).length;

  /** Título de la publicación del enlace; si ya no existe, el id es lo que hay. */
  const propertyTitle = (id: string) =>
    properties.find((property) => property.id === id)?.title ?? id;

  const noActivity =
    !!engagement &&
    engagement.totals.shares === 0 &&
    engagement.totals.views === 0 &&
    engagement.totals.contacts === 0;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Mis publicaciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Todo lo que publicaste desde tu corredora, en un solo lugar.
          </p>
        </div>
        <Link
          href="/socio/publicar"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <CirclePlus className="w-4 h-4" />
          Publicar propiedad
        </Link>
      </div>

      {!persistent && !loading && !access && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Estás en desarrollo sin Supabase: lo que guardes se pierde al reiniciar
          el servidor. Con un proyecto configurado las publicaciones quedan en la
          base.
        </div>
      )}

      {toast && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      {/* Estado de acceso — el mismo aviso que usa /socio/publicar, para que la
          situación se explique igual desde cualquiera de las dos pantallas. */}
      {access && (
        <div className="mb-6">
          <SocioAccessNotice
            status={access.status}
            message={access.message}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      )}

      {!access && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {[
              { label: 'Publicaciones', value: properties.length, tone: 'text-slate-900' },
              { label: 'En venta', value: count('for_sale'), tone: 'text-emerald-600' },
              { label: 'En arriendo', value: count('for_rent'), tone: 'text-blue-600' },
              { label: 'Arrendadas', value: count('rented'), tone: 'text-violet-600' },
              { label: 'Vendidas', value: count('sold'), tone: 'text-slate-400' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className={`text-2xl font-black ${stat.tone}`}>
                  {loading ? '…' : stat.value}
                </p>
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Lista */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando publicaciones…
            </div>
          ) : properties.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h2 className="text-sm font-bold text-slate-700 mb-1">
                Aún no tienes publicaciones
              </h2>
              <p className="text-xs text-slate-500 mb-5 max-w-md mx-auto">
                Publica tu primera propiedad y aparecerá en el portal, en la página
                de tu corredora y en su feed.
              </p>
              <Link
                href="/socio/publicar"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <CirclePlus className="w-4 h-4" />
                Publicar mi primera propiedad
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {properties.map((property) => (
                <li
                  key={property.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-4"
                >
                  {/* Miniatura */}
                  <div className="w-full sm:w-32 h-24 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                    {property.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={property.images[0]}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-slate-300" />
                      </div>
                    )}
                  </div>

                  {/* Datos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Link
                        href={`/properties/${property.id}`}
                        className="text-sm font-bold text-slate-900 hover:text-blue-700 truncate"
                      >
                        {property.title}
                      </Link>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          STATUS_STYLES[property.status] ?? STATUS_STYLES.sold
                        }`}
                      >
                        {getStatusLabel(property.status)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {property.address} · {property.city}
                    </p>
                    {property.rol && (
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        ROL {property.rol}
                      </p>
                    )}
                    <p className="text-sm font-black text-slate-900 mt-1.5">
                      {formatPrice(property.price, 'CLP', 'es-CL', property.status === 'for_rent')}
                    </p>
                  </div>

                  {/* Acciones */}
                  <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
                    <div className="flex gap-2">
                      <Link
                        href={`/properties/${property.id}`}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        title="Ver la ficha pública"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver
                      </Link>
                      <Link
                        href={`/socio/publicaciones/${property.id}`}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Editar
                      </Link>
                      <button
                        onClick={() => setSharing(property)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        title="Compartir en redes"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        Compartir
                      </button>
                    </div>

                    {deletingId === property.id ? (
                      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
                        <span className="text-xs text-red-700 font-semibold">¿Eliminar?</span>
                        <button
                          onClick={() => handleDelete(property)}
                          disabled={busy}
                          className="text-xs font-bold text-red-700 hover:text-red-900 disabled:opacity-50"
                        >
                          Sí
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="text-xs font-medium text-red-500 hover:text-red-700"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(property.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:border-red-300 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Eliminar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Actividad de los enlaces: qué se compartió, qué se abrió y qué
              contactos trajo. Vive acá y no en el panel de admin porque esta
              es la corredora dueña de los enlaces. */}
          <section className="mt-10 border-t border-slate-200 pt-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900">Compartidos y contactos</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Qué enlaces moviste, cuánto se abrieron y qué interesados trajeron.
                </p>
              </div>
              <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                {ENGAGEMENT_WINDOWS.map((value) => (
                  <button
                    key={value}
                    onClick={() => setEngagementDays(value)}
                    aria-pressed={engagementDays === value}
                    className={`px-3 py-2 text-xs font-semibold transition-colors ${
                      engagementDays === value
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {value} d
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2 mb-5 max-w-2xl">
              La conversión es contactos ÷ compartidos. Cada contacto se atribuye al último
              compartido del mismo enlace anterior a su alta; los que no tienen un compartido
              previo se informan aparte, no se reparten a la fuerza entre canales.
            </p>

            {!engagementLoading && !engagementPersistent && (
              <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Modo de prueba: la actividad se cuenta en memoria y se pierde al reiniciar el
                servidor. Con Supabase configurado queda en las tablas de contactos y compartidos.
              </div>
            )}

            {engagementLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando actividad…
              </div>
            ) : engagementError ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                <p className="text-sm font-semibold text-slate-700">{engagementError}</p>
                <button
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Reintentar
                </button>
              </div>
            ) : engagement && noActivity ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-700 mb-1">
                  Todavía no hay movimiento en tus enlaces
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Cuando compartas una publicación y alguien abra su landing o deje sus datos,
                  aparecerá acá con el enlace y el canal que lo movió.
                </p>
              </div>
            ) : engagement ? (
              <>
                {/* Resumen de la ventana */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Compartidos', value: String(engagement.totals.shares), icon: Share2 },
                    { label: 'Aperturas', value: String(engagement.totals.views), icon: Eye },
                    { label: 'Contactos', value: String(engagement.totals.contacts), icon: Users },
                    {
                      label: 'Conversión',
                      value: formatConversion(engagement.totals.conversion),
                      icon: TrendingUp,
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                        <stat.icon className="w-4 h-4 text-slate-300" />
                      </div>
                      <p className="text-2xl font-black text-slate-900 mt-1">{stat.value}</p>
                    </div>
                  ))}
                </div>

                {/* De dónde salieron los contactos y por dónde escribieron */}
                <div className="grid sm:grid-cols-2 gap-3 mb-6">
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-bold text-slate-700 mb-2">
                      Dónde dejaron el contacto
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {engagement.contactSources.filter((item) => item.count > 0).length === 0 ? (
                        <span className="text-xs text-slate-400">Sin contactos en la ventana.</span>
                      ) : (
                        engagement.contactSources
                          .filter((item) => item.count > 0)
                          .map((item) => (
                            <span
                              key={item.source}
                              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                            >
                              {leadSourceLabel(item.source)} · {item.count}
                            </span>
                          ))
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Desde la landing compartida o directo en la ficha.
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <p className="text-xs font-bold text-slate-700 mb-2">Canal de contacto</p>
                    <div className="flex flex-wrap gap-1.5">
                      {engagement.contactChannels.filter((item) => item.count > 0).length === 0 ? (
                        <span className="text-xs text-slate-400">Sin contactos en la ventana.</span>
                      ) : (
                        engagement.contactChannels
                          .filter((item) => item.count > 0)
                          .map((item) => (
                            <span
                              key={item.channel}
                              className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700"
                            >
                              {leadChannelLabel(item.channel)} · {item.count}
                            </span>
                          ))
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Formulario, WhatsApp, llamada o correo.
                    </p>
                  </div>
                </div>

                {/* Por enlace */}
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-2">Por enlace</h3>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                            <th className="px-4 py-3 font-bold">Enlace</th>
                            <th className="px-4 py-3 font-bold text-right">Compartidos</th>
                            <th className="px-4 py-3 font-bold text-right">Aperturas</th>
                            <th className="px-4 py-3 font-bold text-right">Contactos</th>
                            <th className="px-4 py-3 font-bold text-right">Conversión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {engagement.byLink.map((row) => (
                            <tr
                              key={row.propertyId}
                              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                            >
                              <td className="px-4 py-3">
                                <Link
                                  href={`/properties/${row.propertyId}`}
                                  className="font-semibold text-slate-900 hover:text-blue-700"
                                >
                                  {propertyTitle(row.propertyId)}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">
                                {row.shares}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600">{row.views}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">
                                {row.contacts}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                    row.conversion === null
                                      ? 'bg-slate-100 text-slate-400'
                                      : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {formatConversion(row.conversion)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Por canal */}
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-2">Por canal</h3>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                            <th className="px-4 py-3 font-bold">Canal</th>
                            <th className="px-4 py-3 font-bold text-right">Compartidos</th>
                            <th className="px-4 py-3 font-bold text-right">Contactos atribuidos</th>
                            <th className="px-4 py-3 font-bold text-right">Conversión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {engagement.byChannel.map((row) => (
                            <tr
                              key={row.channel}
                              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                            >
                              <td className="px-4 py-3 font-semibold text-slate-900">
                                {shareChannelLabel(row.channel)}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">
                                {row.shares}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600">
                                {row.contacts}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                    row.conversion === null
                                      ? 'bg-slate-100 text-slate-400'
                                      : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {formatConversion(row.conversion)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {engagement.totals.unattributedContacts > 0 && (
                    <p className="text-xs text-slate-400 mt-2">
                      {engagement.totals.unattributedContacts}{' '}
                      {engagement.totals.unattributedContacts === 1
                        ? 'contacto no tiene un compartido previo'
                        : 'contactos no tienen un compartido previo'}{' '}
                      del mismo enlace, así que no se atribuyen a ningún canal.
                    </p>
                  )}
                </div>

                {/* Últimos movimientos con identidad */}
                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">Últimos compartidos</h3>
                    <p className="text-[11px] text-slate-400 mb-2">
                      Quién movió cada enlace y por dónde.
                    </p>
                    {engagement.recentShares.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4">Sin compartidos en la ventana.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {engagement.recentShares.slice(0, 8).map((event) => (
                          <li key={event.id} className="py-2.5 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {event.name}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {propertyTitle(event.propertyId)}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {shareChannelLabel(event.channel)} · {formatMoment(event.createdAt)}
                              </p>
                            </div>
                            <a
                              href={`mailto:${event.email}`}
                              className="text-[11px] text-blue-600 hover:underline shrink-0 max-w-[45%] truncate"
                              title={event.email}
                            >
                              {event.email}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">Últimos contactos</h3>
                    <p className="text-[11px] text-slate-400 mb-2">
                      Interesados que dejaron sus datos en tus enlaces.
                    </p>
                    {engagement.recentContacts.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4">Sin contactos en la ventana.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {engagement.recentContacts.slice(0, 8).map((lead) => (
                          <li key={lead.id} className="py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {lead.name}
                              </p>
                              <span className="text-[11px] text-slate-400 shrink-0">
                                {formatMoment(lead.createdAt)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">
                              {lead.propertyId ? propertyTitle(lead.propertyId) : 'Sin propiedad'}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {leadChannelLabel(lead.channel)} · {leadSourceLabel(lead.source)}
                            </p>
                            <p className="text-[11px] mt-0.5 flex flex-wrap gap-x-2">
                              <a
                                href={`mailto:${lead.email}`}
                                className="text-blue-600 hover:underline truncate max-w-full"
                              >
                                {lead.email}
                              </a>
                              <a
                                href={`tel:${lead.phone}`}
                                className="text-slate-600 hover:text-slate-900"
                              >
                                {lead.phone}
                              </a>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 mt-4">
                  Solo ves los compartidos y contactos de tu corredora.
                </p>
              </>
            ) : null}
          </section>
        </>
      )}

      {sharing && <ShareDialog property={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
