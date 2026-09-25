'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import type { ShareReport } from '@/lib/data/shareViews';
import type { Partner } from '@/lib/data/partners';

/** Ventanas que ofrece el panel. El servidor valida el valor que reciba. */
const WINDOWS = [7, 30, 90] as const;

/**
 * Formatea la tasa de contactos por apertura.
 *
 * `null` no es «0 %»: significa que **no hubo ninguna apertura** y la tasa no se
 * puede calcular. Mostrarlo como 0 % haría pensar que el enlace fracasó, cuando
 * en realidad nunca se abrió.
 */
function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  // Con menos de 1 % la tasa redondea a 0 %: se marca "< 1 %" para que no
  // parezca que hubo cero contactos.
  if (rate > 0 && rate < 0.01) return '< 1 %';
  return `${Math.round(rate * 100)} %`;
}

/** Tasa como badge, con el color según qué tan bien convierte el enlace. */
function RateBadge({ rate }: { rate: number | null }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${
        rate === null
          ? 'bg-slate-100 text-slate-400'
          : rate >= 0.1
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-600'
      }`}
    >
      {formatRate(rate)}
    </span>
  );
}

function formatDay(day: string | null): string {
  if (!day) return '—';
  const [year, month, date] = day.split('-');
  if (!year || !month || !date) return '—';
  return `${date}/${month}/${year.slice(2)}`;
}

export default function AdminLandingsPage() {
  const [report, setReport] = useState<ShareReport | null>(null);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [persistent, setPersistent] = useState(true);
  const [days, setDays] = useState<number>(30);

  const load = (windowDays: number) => {
    setLoading(true);
    fetch(`/api/admin/share-report?days=${windowDays}`)
      .then((r) => r.json())
      .then((result) => {
        if (result?.success) {
          setReport(result.data);
          setPersistent(result.persistent !== false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(days);

    // Nombres de corredoras, para no mostrar solo el id en el informe.
    fetch('/api/partners')
      .then((r) => r.json())
      .then((result) => {
        if (!result?.success) return;
        const map: Record<string, string> = {};
        for (const partner of result.data as Partner[]) map[partner.id] = partner.name;
        setPartners(map);
      })
      .catch(() => {});
    // El informe solo se recarga cuando cambia la ventana (el botón llama a load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partnerName = (id: string | null) => (id ? partners[id] || id : 'Sin corredora');

  const totals = report?.totals;
  const sinActividad = !!report && report.partners.length === 0;

  return (
    <div className="max-w-6xl">
      {/* Aviso: sin Supabase las aperturas viven en memoria */}
      {!loading && !persistent && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Modo de prueba: las aperturas no se guardan</p>
            <p className="mt-0.5 text-amber-700">
              No hay un proyecto Supabase configurado, así que este conteo se pierde al reiniciar el
              servidor. En producción queda en <code className="font-mono">public.share_views</code>.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Enlaces compartidos</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading || !totals
              ? 'Cargando...'
              : `${totals.views} ${totals.views === 1 ? 'apertura' : 'aperturas'} y ${totals.contacts} ${
                  totals.contacts === 1 ? 'contacto' : 'contactos'
                } en los últimos ${report.windowDays} días · ${formatRate(totals.contactRate)} de contacto`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Ventana de tiempo */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
            {WINDOWS.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setDays(value);
                  load(value);
                }}
                className={`px-3 py-2 text-xs font-semibold transition-colors ${
                  days === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {value} d
              </button>
            ))}
          </div>

          <button
            onClick={() => load(days)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-sm font-semibold text-slate-700 rounded-lg transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-6 max-w-2xl">
        Cada apertura es un enlace abierto, no una persona: se cuentan por día y sin guardar ningún
        dato del visitante. Los contactos son los de “Contactos”, agrupados por la corredora de la
        propiedad.
      </p>

      {/* Contenido */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : sinActividad ? (
        <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
          <Link2 className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 font-semibold">Todavía no hay enlaces abiertos</p>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Cuando alguien abra una landing compartida —desde la ficha, el botón “Compartir” o un
            enlace reenviado por WhatsApp— aparecerá acá con su corredora.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Por corredora */}
          <section>
            <h2 className="text-sm font-bold text-slate-900 mb-3">Por corredora</h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-3 font-bold">Corredora</th>
                      <th className="px-4 py-3 font-bold text-right">Aperturas</th>
                      <th className="px-4 py-3 font-bold text-right">Contactos</th>
                      <th className="px-4 py-3 font-bold text-right">Contactos / apertura</th>
                      <th className="px-4 py-3 font-bold text-right">Enlaces</th>
                      <th className="px-4 py-3 font-bold text-right">Último día con aperturas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report!.partners.map((row) => (
                      <tr
                        key={row.partnerId ?? 'sin-corredora'}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      >
                        <td className="px-4 py-3">
                          <span className={`font-semibold ${row.partnerId ? 'text-slate-900' : 'text-slate-500 italic'}`}>
                            {partnerName(row.partnerId)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {row.views}
                          {row.viewsTotal > row.views && (
                            <span className="block text-[10px] font-medium text-slate-400">
                              {row.viewsTotal} en total
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {row.contacts}
                          {row.contactsTotal > row.contacts && (
                            <span className="block text-[10px] font-medium text-slate-400">
                              {row.contactsTotal} en total
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RateBadge rate={row.contactRate} />
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{row.properties}</td>
                        <td className="px-4 py-3 text-right text-slate-500 text-xs">{formatDay(row.lastViewDay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Por propiedad: qué enlace concreto conviene seguir moviendo */}
          <section>
            <h2 className="text-sm font-bold text-slate-900 mb-1">Por propiedad</h2>
            <p className="text-xs text-slate-500 mb-3">
              Los enlaces que más se abren y los que sí generan contactos, para saber cuál conviene volver
              a mandar.
            </p>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-3 font-bold">Propiedad</th>
                      <th className="px-4 py-3 font-bold">Corredora</th>
                      <th className="px-4 py-3 font-bold text-right">Aperturas</th>
                      <th className="px-4 py-3 font-bold text-right">Contactos</th>
                      <th className="px-4 py-3 font-bold text-right">Contactos / apertura</th>
                      <th className="px-4 py-3 font-bold text-right">Ficha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report!.properties.slice(0, 25).map((row) => (
                      <tr key={row.propertyId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.propertyId}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{partnerName(row.partnerId)}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {row.views}
                          {row.viewsTotal > row.views && (
                            <span className="block text-[10px] font-medium text-slate-400">
                              {row.viewsTotal} en total
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{row.contacts}</td>
                        <td className="px-4 py-3 text-right">
                          <RateBadge rate={row.contactRate} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/compartir/${row.propertyId}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            <span>Abrir</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {report!.properties.length > 25 && (
              <p className="text-xs text-slate-400 mt-2">
                Se muestran los 25 enlaces con más actividad de {report!.properties.length}.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
