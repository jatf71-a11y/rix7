'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import type { PanelProperty } from '@/lib/data/propertiesStore';
import PublicationForm, { type PublicationPayload } from '@/components/socio/PublicationForm';

const TOAST_KEY = 'rix7-socio-toast';

/**
 * Edición de una publicación propia.
 *
 * No hay `GET /api/partner/properties/[id]`: el listado ya trae todas las de
 * la corredora y acá se busca por id dentro de él — una consulta menos y, de
 * regalo, el caso «esta ficha no es de mi corredora» cae solo (no se encuentra,
 * se informa, no se edita).
 */
export default function SocioEditarPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [property, setProperty] = useState<PanelProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<{ status: number; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAccess(null);
    try {
      const res = await fetch('/api/partner/properties', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setAccess({ status: res.status, message: body?.error ?? 'No se pudo cargar.' });
        return;
      }
      const found = (Array.isArray(body.data) ? body.data : []).find(
        (item: PanelProperty) => item.id === id
      );
      if (!found) {
        setAccess({
          status: 404,
          message: 'No encontramos esta publicación en tu corredora.',
        });
        return;
      }
      setProperty(found);
    } catch {
      setAccess({ status: 0, message: 'Sin conexión con el servidor.' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(payload: PublicationPayload) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/properties', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? 'No se pudieron guardar los cambios.');
        return;
      }
      try {
        sessionStorage.setItem(
          TOAST_KEY,
          body?.persisted === false
            ? 'Cambios guardados (solo en memoria: desarrollo sin Supabase).'
            : 'Cambios guardados.'
        );
      } catch {
        // El aviso es prescindible; los cambios ya están.
      }
      router.push('/socio');
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/socio"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Volver a mis publicaciones
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Editar publicación</h1>
        {property && (
          <p className="text-sm text-slate-500 mt-1">{property.title}</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando publicación…
        </div>
      ) : access ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm text-slate-700 mb-4">{access.message}</p>
          <Link
            href="/socio"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Volver al listado
          </Link>
        </div>
      ) : property ? (
        <PublicationForm
          initial={property}
          saving={saving}
          error={error}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  );
}
