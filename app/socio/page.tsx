'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CirclePlus,
  Eye,
  Loader2,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import type { PanelProperty } from '@/lib/data/propertiesStore';
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
        </>
      )}

      {sharing && <ShareDialog property={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
