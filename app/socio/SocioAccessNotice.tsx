'use client';

import React from 'react';
import { KeyRound, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * El aviso de acceso del panel de socios, compartido por `/socio` y
 * `/socio/publicar`.
 *
 * Los estados no se mezclan porque cada uno se arregla distinto:
 *
 * - **401** — no hay sesión: invita a entrar (es el botón que abre el modal de
 *   cuenta del portal, el mismo de la ficha) y aclara con qué correo entrar.
 * - **403** — hay sesión pero la cuenta no es de una corredora: se muestra el
 *   motivo exacto que devolvió el guard (sin rol, o sin corredora vinculada) y
 *   quién lo resuelve.
 * - **503 / otro** — el despliegue no puede verificar la sesión: se ofrece
 *   reintentar y el enlace a `/api/health`, que dice qué falta.
 *
 * Estaba duplicado en el panel cuando este aviso existía en un solo lugar; con
 * dos pantallas que lo necesitan, la copia dejaría que la misma situación se
 * explicara distinto según por dónde se entre.
 */
export default function SocioAccessNotice({
  status,
  message,
  onRetry,
}: {
  status: number;
  message: string;
  onRetry?: () => void;
}) {
  const { openAuthModal } = useAuth();
  const isMissingSession = status === 401;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        {isMissingSession ? (
          <KeyRound className="w-6 h-6 text-slate-500" />
        ) : (
          <ShieldAlert className="w-6 h-6 text-slate-500" />
        )}
      </div>
      <p className="text-sm text-slate-700 mb-1">
        {isMissingSession ? 'Inicia sesión para ver tus publicaciones.' : message}
      </p>
      {isMissingSession && (
        <p className="text-xs text-slate-400 mb-5">
          Tus publicaciones viven en la cuenta de tu corredora: entra con el correo que usó tu
          equipo.
        </p>
      )}
      {!isMissingSession && status === 403 && (
        <p className="text-xs text-slate-400 mb-5">
          Si ya trabajás con una corredora del portal, pedile al equipo de Rix7 que vincule tu
          cuenta: se hace desde el panel de administración, en Empresas / Socios.
        </p>
      )}
      {status === 503 && (
        <p className="text-xs text-slate-400 mb-5">
          El detalle de qué falta está en{' '}
          <a href="/api/health" className="underline">
            /api/health
          </a>
          .
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
        {isMissingSession ? (
          <button
            onClick={() => openAuthModal('entrar a tu panel de publicaciones')}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Entrar
          </button>
        ) : (
          onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
          )
        )}
      </div>
    </div>
  );
}
