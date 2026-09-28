'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, RefreshCw, TriangleAlert } from 'lucide-react';
import { reportError } from '@/lib/monitoring/reportError';

/**
 * Error boundary raíz de la aplicación.
 *
 * Sin este archivo, cualquier excepción de render en una página (ficha caída,
 * Supabase offline, bug de cliente) entregaba el crash-page genérico de Next en
 * producción: sin marca, sin salida y con el stack a la vista en desarrollo.
 * Este componente atrapa el error, lo reporta a consola (Sentry en el futuro,
 * ver hallazgo #13) y ofrece dos salidas reales: reintentar y volver al inicio.
 *
 * `reset()` re-renderiza los Server Components de la ruta: si la causa fue una
 * respuesta fallida de Supabase, el reintento la vuelve a pedir.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // reportError siempre registra en consola y, si Sentry está inicializado
    // (DSN en el entorno), envía además el evento — sin tocar este código.
    reportError(error, { extra: { from: 'root-error-boundary' } });
  }, [error]);

  return (
    <div className="bg-slate-50 min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <TriangleAlert className="w-16 h-16 text-amber-300 mx-auto mb-4" />
        <h1 className="text-xl font-black text-slate-900">Algo salió mal</h1>
        <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
          Tuvimos un problema al mostrar esta página. Puedes reintentar o volver
          al inicio.
          {error.digest && (
            <span className="block mt-1 text-xs text-slate-400">
              Código de referencia: {error.digest}
            </span>
        )}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 text-sm font-bold rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors"
          >
            <Home className="w-4 h-4" />
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
