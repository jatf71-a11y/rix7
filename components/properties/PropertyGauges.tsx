'use client';

import React, { useEffect, useState } from 'react';
import { Gauge as GaugeIcon } from 'lucide-react';
import { Gauge, type GaugeTone } from '@/components/properties/Gauge';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { claimPropertyViewMarker } from '@/lib/utils/propertyViewPing';
import {
  DEMAND_LABELS,
  MARKET_LABELS,
  demandMeter,
  formatDeviation,
  marketGaugeValue,
  type MarketComparison,
} from '@/lib/utils/propertyInsights';

interface PropertyGaugesProps {
  propertyId: string;
  /** Comparación con el mercado, resuelta en el servidor. */
  market: MarketComparison;
  /** Visitas acumuladas al momento del render (ISR). */
  initialViews: number;
  /** `false` = el conteo viene del respaldo en memoria (sin Supabase). */
  initialViewsPersisted: boolean;
}

const MARKET_TONES: Record<MarketComparison['position'], GaugeTone> = {
  below: 'emerald',
  at: 'blue',
  above: 'amber',
  unknown: 'slate',
};

const DEMAND_TONES = {
  low: 'slate',
  medium: 'blue',
  high: 'emerald',
} as const;

/**
 * Dos velocímetros de la ficha en arriendo:
 *
 * 1. **Precio frente al mercado** — dónde queda el $/m² de la propiedad respecto
 *    de la mediana de arriendos comparables.
 * 2. **Interés** — cuántas veces se abrió la ficha.
 *
 * El primero llega calculado del servidor (necesita el catálogo). El segundo se
 * refresca con un ping: al montar, si la sesión aún no contaba esta visita, se
 * avisa al servidor y se adopta el total que devuelve.
 */
export function PropertyGauges({
  propertyId,
  market,
  initialViews,
  initialViewsPersisted,
}: PropertyGaugesProps) {
  const { format } = useCurrency();
  const [views, setViews] = useState(initialViews);
  const [persisted, setPersisted] = useState(initialViewsPersisted);

  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // Navegador que bloquea el acceso a `sessionStorage`.
    }

    const counted = claimPropertyViewMarker(storage, propertyId);

    try {
      void fetch(`/api/properties/${encodeURIComponent(propertyId)}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counted }),
        keepalive: true,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          if (typeof data.views === 'number') setViews(data.views);
          // El ping es más fresco que el render cacheado: si dice que el conteo
          // no persiste, hay que reflejarlo (y viceversa).
          if (typeof data.persisted === 'boolean') setPersisted(data.persisted);
        })
        .catch(() => {});
    } catch {
      // Sin red o sin `fetch`: se muestra el número que trajo el servidor.
    }
  }, [propertyId]);

  const demand = demandMeter(views);
  const marketKnown = market.position !== 'unknown';

  return (
    <div
      id="mercado"
      className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm"
    >
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <GaugeIcon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">Precio y demanda</h3>
          <p className="text-xs text-slate-500">
            Cómo se compara este arriendo con el mercado y cuánto interés despierta
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {/* ① Precio frente al mercado */}
        <Gauge
          value={marketKnown ? marketGaugeValue(market.deviationPct) : 0}
          valueText={marketKnown ? formatDeviation(market.deviationPct) : '—'}
          label={MARKET_LABELS[market.position]}
          tone={MARKET_TONES[market.position]}
          muted={!marketKnown}
          caption={
            marketKnown
              ? `Mediana ${format(market.medianPerSqm)}/m² · ${market.sampleSize} comparables`
              : 'Aún no hay arriendos comparables suficientes en la zona'
          }
        />

        {/* ② Interés / demanda */}
        <Gauge
          value={demand.gauge}
          valueText={demand.views.toLocaleString('es-CL')}
          label={DEMAND_LABELS[demand.level]}
          tone={DEMAND_TONES[demand.level]}
          caption={
            persisted
              ? `Visitas a esta ficha${demand.views === 1 ? '' : 's'}`
              : 'Conteo de prueba · se pierde al reiniciar'
          }
        />
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed mt-6 pt-4 border-t border-slate-100">
        {marketKnown
          ? 'El precio de mercado se estima con la mediana de precio por m² de arriendos comparables. '
          : 'Cuando existan suficientes arriendos comparables, aquí aparecerá la comparación de precio. '}
        Las visitas se cuentan de forma agregada, sin guardar datos de los visitantes.
      </p>
    </div>
  );
}
