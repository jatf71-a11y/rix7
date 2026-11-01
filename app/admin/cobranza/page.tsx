'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleDollarSign, Loader2, RefreshCw, ShieldOff } from 'lucide-react';

import {
  SITUACION_LABELS,
  SITUACION_TONES,
  currentPeriod,
  periodLabel,
  type SituacionSocio,
} from '@/lib/data/cobranza';
import type { SocioCobranza } from '@/lib/data/cobranzaStore';

/**
 * Cobranza: quién paga, quién debe y quién está moroso.
 *
 * La lista ordena lo que reclama atención primero (morosos, vencidos) y cada
 * socio se abre para registrar el pago de un período o para confirmar/levantar
 * la morosidad. Registrar un pago hace dos cosas de una: marca el período como
 * pagado y, si el socio estaba `Alta` —plan elegido, sin pagar—, lo mueve a
 * `Operando`.
 *
 * La morosidad es la única acción con efecto público: mientras esté confirmada,
 * las propiedades del socio no se muestran en el portal. Por eso el botón pide
 * confirmación y el aviso está a la vista.
 */

interface ApiResponse {
  success?: boolean;
  socios?: SocioCobranza[];
  persistent?: boolean;
  warning?: string;
  error?: string;
  data?: { situacion?: { estado: SituacionSocio; deudaClp: number } | null };
}

const money = (value: number): string =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);

const shortDate = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

function SituacionBadge({ situacion }: { situacion: SituacionSocio }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${SITUACION_TONES[situacion]}`}
    >
      {SITUACION_LABELS[situacion]}
    </span>
  );
}

export default function AdminCobranzaPage() {
  const [socios, setSocios] = useState<SocioCobranza[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Formulario del pago, por socio.
  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/cobranza', { cache: 'no-store' });
      const body: ApiResponse | null = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo cargar la cobranza.');
        setSocios([]);
        return;
      }

      setSocios(body.socios ?? []);
      setWarning(body.warning ?? null);
    } catch {
      setError('No pudimos conectarnos con el panel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, unknown>, key: string, done: string) {
    if (busy) return;
    setBusy(key);
    setError(null);

    try {
      const response = await fetch('/api/admin/cobranza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: ApiResponse | null = await response.json().catch(() => null);

      if (!response.ok || !body?.success) {
        setError(body?.error ?? 'No se pudo completar la acción.');
        return;
      }

      setToast(done);
      setNote('');
      await load();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setBusy(null);
    }
  }

  const resumen = useMemo(() => {
    const morosos = socios.filter((socio) => socio.situacion === 'moroso').length;
    const vencidos = socios.filter((socio) => socio.situacion === 'vencido').length;
    const deuda = socios.reduce((total, socio) => total + socio.deudaClp, 0);
    return { morosos, vencidos, deuda };
  }, [socios]);

  if (loading && socios.length === 0) {
    return (
      <div className="max-w-6xl">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando cobranza…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Cobranza</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Suscripción de cada socio, período por período. Registrar el pago cierra el alta —el
            socio pasa a <strong>operando</strong>— y confirmar la morosidad deja sus publicaciones
            fuera del portal hasta que regularice.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Refrescar
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Morosos confirmados', value: String(resumen.morosos) },
          { label: 'Con períodos vencidos', value: String(resumen.vencidos) },
          { label: 'Deuda total', value: money(resumen.deuda) },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-black text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      {warning && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {warning}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {toast && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {toast}
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {socios.map((socio) => {
          const open = openId === socio.partnerId;
          const key = socio.partnerId;

          return (
            <li
              key={socio.partnerId}
              className={`rounded-2xl border bg-white ${socio.situacion === 'moroso' ? 'border-red-200' : 'border-slate-200'}`}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenId(open ? null : socio.partnerId);
                  setPeriod(currentPeriod());
                  setAmount(String(socio.deudaClp || ''));
                }}
                className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm font-bold text-slate-900">{socio.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {socio.email || 'sin correo'} · {socio.partnerId}
                  </p>
                </div>
                <SituacionBadge situacion={socio.situacion} />
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Deuda</p>
                  <p className="text-sm font-bold text-slate-900">{money(socio.deudaClp)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Próximo vencimiento
                  </p>
                  <p className="text-sm font-semibold text-slate-700">
                    {socio.proximoVencimiento ?? '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Último pago
                  </p>
                  <p className="text-sm font-semibold text-slate-700">
                    {socio.ultimoPago
                      ? `${periodLabel(socio.ultimoPago.period)} · ${money(socio.ultimoPago.amountClp)}`
                      : '—'}
                  </p>
                </div>
              </button>

              {open && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Período
                      <input
                        value={period}
                        onChange={(event) => setPeriod(event.target.value)}
                        placeholder="AAAA-MM"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-800"
                      />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Monto ($)
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="19990"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-800"
                      />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:col-span-2">
                      Nota (opcional)
                      <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          {
                            action: 'pago',
                            partnerId: socio.partnerId,
                            period: period.trim(),
                            amountClp: Number(amount.replace(/\./g, '')),
                            ...(note.trim() ? { note } : {}),
                          },
                          `${key}-pago`,
                          `Pago de ${period} registrado para ${socio.name}.`
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {busy === `${key}-pago` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CircleDollarSign className="h-3.5 w-3.5" />
                      )}
                      Registrar pago
                    </button>

                    {socio.moroso ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(
                            { action: 'morosidad', partnerId: socio.partnerId, moroso: false },
                            `${key}-moroso`,
                            `Morosidad levantada: las publicaciones de ${socio.name} vuelven al portal.`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {busy === `${key}-moroso` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Levantar morosidad
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          const confirmed = window.confirm(
                            `¿Confirmar la morosidad de ${socio.name}? Sus publicaciones dejan de mostrarse en el portal hasta que regularice.`
                          );
                          if (!confirmed) return;
                          void act(
                            {
                              action: 'morosidad',
                              partnerId: socio.partnerId,
                              moroso: true,
                              ...(note.trim() ? { nota: note } : {}),
                            },
                            `${key}-moroso`,
                            `Morosidad confirmada: ${socio.name} sale de la vidriera pública.`
                          );
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                      >
                        {busy === `${key}-moroso` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldOff className="h-3.5 w-3.5" />
                        )}
                        Confirmar morosidad
                      </button>
                    )}
                  </div>

                  {socio.morosoDesde && (
                    <p className="mt-2 text-[11px] text-red-700">
                      Moroso desde {shortDate(socio.morosoDesde)}
                      {socio.morosoNota ? ` · ${socio.morosoNota}` : ''}
                    </p>
                  )}

                  {socio.periodos.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                          <tr>
                            <th className="px-3 py-2">Período</th>
                            <th className="px-3 py-2">Monto</th>
                            <th className="px-3 py-2">Vence</th>
                            <th className="px-3 py-2">Pagado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {socio.periodos.map((row) => (
                            <tr key={row.period} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-semibold text-slate-700">
                                {periodLabel(row.period)}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{money(row.amountClp)}</td>
                              <td className="px-3 py-2 text-slate-600">{row.dueDate}</td>
                              <td className="px-3 py-2 text-slate-600">
                                {row.paidAt ? shortDate(row.paidAt) : 'pendiente'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {socios.length === 0 && !error && (
          <li className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
            Todavía no hay socios con suscripción. Los que se den de alta aparecen acá.
          </li>
        )}
      </ul>
    </div>
  );
}
