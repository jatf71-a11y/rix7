'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import PublicationForm, { type PublicationPayload } from '@/components/socio/PublicationForm';

const TOAST_KEY = 'rix7-socio-toast';

/**
 * Alta de publicación. Al guardar vuelve al listado con un aviso en
 * `sessionStorage` (el mismo mecanismo que usa el listado para leerlo): no hace
 * falta `useSearchParams` ni un Suspense extra solo por un mensaje.
 */
export default function SocioPublicarPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(payload: PublicationPayload) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? 'No se pudo publicar. Revisa los datos e intenta de nuevo.');
        return;
      }
      try {
        sessionStorage.setItem(
          TOAST_KEY,
          body?.persisted === false
            ? 'Publicación creada (solo en memoria: desarrollo sin Supabase).'
            : '¡Publicación creada! Ya aparece en el portal.'
        );
      } catch {
        // Sin sessionStorage el aviso se pierde, pero la publicación existe.
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
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Publicar propiedad</h1>
        <p className="text-sm text-slate-500 mt-1">
          Se publicará bajo tu corredora y quedará visible en el portal y en la
          página de tu empresa.
        </p>
      </div>

      <PublicationForm saving={saving} error={error} onSubmit={handleSubmit} />
    </div>
  );
}
