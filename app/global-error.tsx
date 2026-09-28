'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Última línea de defensa: el boundary **por encima** del root layout.
 *
 * `app/error.tsx` cubre los errores de render de las páginas, pero si lo que
 * revienta es el propio layout (o un provider global), Next reemplaza todo el
 * documento con este componente — por eso trae su propio <html> y <body>.
 *
 * Importa Sentry de forma estática a propósito: este chunk solo se descarga
 * cuando ocurre un error de este nivel, y ahí conviene reportar sin esperar
 * cargas diferidas. Sin DSN, `captureException` es no-op.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
            Algo salió mal
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Tuvimos un problema inesperado. Puedes reintentar o volver al inicio.
            {error.digest && (
              <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                Código de referencia: {error.digest}
              </span>
            )}
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '0.625rem 1.25rem',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.875rem',
                border: 'none',
                borderRadius: '0.75rem',
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
            <a
              href="/"
              style={{
                padding: '0.625rem 1.25rem',
                background: '#fff',
                color: '#334155',
                fontWeight: 700,
                fontSize: '0.875rem',
                border: '1px solid #e2e8f0',
                borderRadius: '0.75rem',
                textDecoration: 'none',
              }}
            >
              Volver al inicio
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
