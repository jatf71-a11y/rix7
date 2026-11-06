'use client';

import React, { useEffect, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';

import { ccaMonthlyClp, ccaStockUf } from '@/lib/kyb/cca';
import { formatPlanPrice } from '@/lib/kyb/plans';

/**
 * El CCA del socio, en su panel.
 *
 * No es un producto ni una casilla para activar: es la **determinación** que se
 * resuelve después del alta, a partir del volumen de cartera que el socio maneja.
 * La tarjeta muestra la cuenta completa —cuánto suma su cartera en pesos, cuánto
 * es eso en UF, qué `%CCA` está vigente y cuánto representa en pesos— para que el
 * cobro no sea una sorpresa.
 *
 * No es un cobro por publicación: por eso no se muestran «publicaciones activas»
 * ni un contador de fichas. Lo que se cobra es el tamaño del CCA, no cada aviso.
 *
 * Debajo va la **cuenta corriente**: cada movimiento que cambió el monto mensual,
 * con la cartera, la UF y el `%CCA` que se usaron. Es lo que permite entender una
 * factura de hace tres meses sin recalcularla con los datos de hoy, y lo que el
 * socio recibe por correo cada vez que el número se mueve.
 *
 * Se pide aparte del listado para que un fallo acá no deje las publicaciones sin
 * cargar. La UF sale de `/api/indicators`, la misma fuente que el resto del sitio.
 */

interface Movement {
  id: string;
  amountClp: number;
  previousAmountClp: number | null;
  stockClp: number;
  ccaUf: number;
  ccaPct: number;
  reason: 'alta' | 'cartera' | 'planes';
  createdAt: string;
}

interface Determination {
  stockClp: number;
  ccaPct: number;
  persistent: boolean;
  movements: Movement[];
  authorizedAt: string | null;
  warning?: string;
}

const REASON_LABELS: Record<Movement['reason'], string> = {
  alta: 'Alta',
  cartera: 'Cambio de cartera',
  planes: 'Cambio de %CCA',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CcaCard() {
  const [data, setData] = useState<Determination | null>(null);
  const [uf, setUf] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/partner/cca', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !body?.success) {
          // 401/403 los explica el aviso de acceso del panel; acá solo se oculta.
          if (response.status >= 500) {
            setError(body?.error ?? 'No pudimos calcular tu CCA.');
          }
          return;
        }
        setData(body.data as Determination);
      })
      .catch(() => {
        if (!cancelled) setError('Sin conexión con el servidor.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/indicators', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return;
        const value = Number(body?.uf?.value);
        if (Number.isFinite(value) && value > 0) setUf(value);
      })
      .catch(() => {
        // Sin UF se muestran los pesos publicados y el CCA, pero no el monto.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando tu CCA…
      </div>
    );
  }

  if (!data) {
    return error ? (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
        {error}
      </div>
    ) : null;
  }

  const stockUf = uf !== null ? ccaStockUf([data.stockClp], uf) : null;
  const monthly = stockUf !== null && uf !== null ? ccaMonthlyClp(stockUf, uf, data.ccaPct) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Calculator className="h-4 w-4 text-slate-400" />
        CCA
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        La suma de tu cartera, en UF. Se determina después del alta y se recalcula sola: cada
        propiedad que sumes mueve el número. No se cobra por publicación; se cobra el CCA, junto a
        tu mensualidad.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-medium text-slate-500">Tu cartera</dt>
          <dd className="text-sm font-black text-slate-900">{formatPlanPrice(data.stockClp)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-medium text-slate-500">Tu CCA</dt>
          <dd className="text-sm font-black text-slate-900">
            {stockUf !== null ? `UF ${formatNumber(stockUf)}` : '—'}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-medium text-slate-500">
            $CCA · {formatNumber(data.ccaPct)}%
          </dt>
          <dd className="text-sm font-black text-slate-900">
            {monthly !== null ? formatPlanPrice(monthly) : '—'}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        $CCA = CCA × valor de la UF ÷ 1.000.000 × {formatNumber(data.ccaPct)}%. El %CCA lo define
        Rix7 y el monto se factura junto a la suscripción.
        {uf === null ? ' No pudimos leer la UF del día, así que no mostramos el monto en pesos.' : ''}
      </p>

      {data.stockClp === 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          Todavía no tienes propiedades en tu cartera: el CCA es 0 hasta que cargues la primera.
        </p>
      )}

      {data.warning && <p className="mt-2 text-[11px] text-slate-400">{data.warning}</p>}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-700">Cuenta corriente</h4>
          <span className="text-[11px] text-slate-400">
            {data.authorizedAt
              ? `Cobro autorizado el ${formatDate(data.authorizedAt)}`
              : 'Autorización del cobro registrada en el alta'}
          </span>
        </div>

        {data.movements.length === 0 ? (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Sin movimientos todavía. La primera línea aparece cuando cargues una propiedad y el CCA
            deje de ser 0.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {data.movements.map((movement) => {
              const delta =
                movement.previousAmountClp === null
                  ? null
                  : movement.amountClp - movement.previousAmountClp;
              return (
                <li key={movement.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">
                      {REASON_LABELS[movement.reason]}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatDate(movement.createdAt)} · cartera {formatPlanPrice(movement.stockClp)}{' '}
                      · {formatNumber(movement.ccaUf)} UF · {formatNumber(movement.ccaPct)}%
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-black text-slate-900">{formatPlanPrice(movement.amountClp)}</p>
                    {delta !== null && delta !== 0 && (
                      <p
                        className={
                          delta > 0 ? 'text-[11px] text-amber-600' : 'text-[11px] text-emerald-600'
                        }
                      >
                        {delta > 0 ? '+' : '−'}
                        {formatPlanPrice(Math.abs(delta))}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Cada movimiento que cambia el monto se te avisa por correo. El CCA se factura junto a tu
          mensualidad; acá no se cobra nada.
        </p>
      </div>
    </div>
  );
}

/** Número con separador de miles y hasta dos decimales. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);
}
