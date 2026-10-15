'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PublicationForm, { type PublicationPayload } from '@/components/socio/PublicationForm';

/**
 * El aviso de acceso se carga **solo cuando hace falta**.
 *
 * Trae el modal de cuenta del portal (el cliente de Supabase del navegador
 * pesa ~52 kB gzip) y esa pieza únicamente se usa cuando la comprobación de
 * acceso falla. El caso normal de esta pantalla es una corredora con sesión
 * abierta escribiendo una propiedad: hacerle descargar la pantalla de entrada
 * antes de ver el formulario era pagar por algo que no iba a ver.
 *
 * Con la carga bajo demanda, quien entra derecho al formulario no la descarga,
 * y quien se topa con el aviso la recibe al instante (viene del mismo origen,
 * cacheada tras la primera vez).
 */
const SocioAccessNotice = dynamic(() => import('../SocioAccessNotice'), { ssr: false });

const TOAST_KEY = 'rix7-socio-toast';

/**
 * Alta de publicación. Al guardar vuelve al listado con un aviso en
 * `sessionStorage` (el mismo mecanismo que usa el listado para leerlo): no hace
 * falta `useSearchParams` ni un Suspense extra solo por un mensaje.
 *
 * Antes de mostrar el formulario se comprueba el acceso (`/api/partner/access`,
 * el mismo guard que protege la escritura). Sin esa comprobación, alguien sin
 * sesión —o con una cuenta que todavía no está vinculada a su corredora— podía
 * cargar la propiedad entera, con fotos y todo, y descubrir el problema recién
 * al guardar. El aviso dice el motivo exacto y qué hacer, en vez de un error
 * genérico al final del camino.
 */
export default function SocioPublicarPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<{ status: number; message: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const checkAccess = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/partner/access', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      setAccess(
        res.ok
          ? null
          : { status: res.status, message: body?.error ?? 'No se pudo verificar tu acceso.' }
      );
    } catch {
      setAccess({ status: 0, message: 'Sin conexión con el servidor.' });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAccess();
  }, [checkAccess, reloadKey]);

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

      {checking ? (
        <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verificando tu acceso…
        </div>
      ) : access ? (
        <SocioAccessNotice
          status={access.status}
          message={access.message}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <PublicationForm saving={saving} error={error} onSubmit={handleSubmit} />
      )}
    </div>
  );
}
