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
 * Se pide aparte del listado para que un fallo acá no deje las publicaciones sin
 * cargar. La UF sale de `/api/indicators`, la misma fuente que el resto del sitio.
 */

interface Determination {
  stockClp: number;
  ccaPct: number;
  persistent: boolean;
  warning?: string;
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
    </div>
  );
}

/** Número con separador de miles y hasta dos decimales. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);
}
