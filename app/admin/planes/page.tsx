'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Check, Info, Loader2, Save } from 'lucide-react';

import {
  CCA_DEFINITION,
  CCA_FORMULA,
  MAX_PRICE_CLP,
  MAX_USERS,
  MIN_USERS,
  PRICING_PROFILES,
  ccaAmountClp,
  formatCcaAmount,
  formatDecimalInput,
  normalizePlanPricing,
  parseDecimalInput,
  profileLabel,
  profilePlan,
  type PlanPricingConfig,
  type ProfilePlan,
} from '@/lib/kyb/planPricing';
import { formatPlanPrice } from '@/lib/kyb/plans';
import type { PartnerKind } from '@/lib/data/partners';

/**
 * Planes: precio de cada perfil de socio y el CCA.
 *
 * La tabla es la definición comercial: para cada perfil, cuánto se cobra una
 * vez (alta inicial), cuánto por mes (mensualidad base) y cuántos usuarios
 * entran en esa mensualidad.
 *
 * Abajo, el CCA —la suma de las publicaciones del socio en UF— con la fórmula
 * para pasarlo a pesos. No se guarda como si fuera un precio: depende del stock
 * publicado de cada socio y cambia con el valor de la UF, así que la pantalla lo
 * calcula con el valor del día que devuelve `/api/indicators`.
 *
 * Mientras no se guarde, nada de lo escrito cambia lo que cobra el portal. El
 * aviso de «sin guardar» está para que nadie se vaya creyendo lo contrario.
 */

interface ApiResponse {
  success?: boolean;
  data?: PlanPricingConfig;
  source?: 'supabase' | 'memory' | 'default';
  persistent?: boolean;
  /** El PUT lo devuelve con ese nombre: si sobrevivió al proceso. */
  persisted?: boolean;
  warning?: string;
  error?: string;
}

const SOURCE_LABEL: Record<'supabase' | 'memory' | 'default', string> = {
  supabase: 'Guardado en la base',
  memory: 'Guardado en memoria del proceso',
  default: 'Precios de partida',
};

/** UF de reserva si `/api/indicators` no responde: el mismo que usa el portal. */
const UF_FALLBACK = 39500;

/** Entero a partir de lo que se escribe; `null` es «vacío», no cero. */
function parseInteger(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameConfig(a: PlanPricingConfig, b: PlanPricingConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function AdminPlanesPage() {
  const [saved, setSaved] = useState<PlanPricingConfig | null>(null);
  const [config, setConfig] = useState<PlanPricingConfig | null>(null);
  const [source, setSource] = useState<'supabase' | 'memory' | 'default'>('default');
  const [persistent, setPersistent] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Calculadora del CCA: no se guarda, es una consulta rápida.
  const [ccaUf, setCcaUf] = useState(formatDecimalInput(100_000));
  const [ufValue, setUfValue] = useState(formatDecimalInput(UF_FALLBACK));
  const [ufSource, setUfSource] = useState<'indicador' | 'manual'>('indicador');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/admin/planes', { cache: 'no-store' });
        const body: ApiResponse | null = await response.json().catch(() => null);

        if (!response.ok || !body?.data) {
          if (!cancelled) setError(body?.error ?? 'No se pudo cargar la configuración de precios.');
          return;
        }

        if (cancelled) return;
        setConfig(body.data);
        setSaved(body.data);
        setSource(body.source ?? 'default');
        setPersistent(body.persistent !== false);
        setWarning(body.warning ?? null);
      } catch {
        if (!cancelled) setError('No pudimos conectarnos con el panel. Recarga la página.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Valor de la UF del día, para la calculadora. Si falla, queda el de reserva
  // y la pantalla dice que se puede escribir a mano.
  useEffect(() => {
    let cancelled = false;

    async function loadUf() {
      try {
        const response = await fetch('/api/indicators', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        const value = Number(body?.uf?.value);
        // Formateada como se lee acá: el número crudo de la API trae punto
        // decimal (41242.32) y en el campo el punto es de miles.
        if (!cancelled && Number.isFinite(value) && value > 0) {
          setUfValue(formatDecimalInput(value));
        }
      } catch {
        // Se queda el valor de reserva; abajo se avisa.
      }
    }

    loadUf();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => !!config && !!saved && !sameConfig(config, saved), [config, saved]);

  const ccaValue = useMemo(() => {
    const uf = parseDecimalInput(ccaUf);
    const rate = parseDecimalInput(ufValue);
    if (uf === null || rate === null) return null;
    return { uf, rate, amount: ccaAmountClp(uf, rate) };
  }, [ccaUf, ufValue]);

  function updateProfile(profile: PartnerKind, patch: Partial<ProfilePlan>) {
    setConfig((current) =>
      current
        ? {
            ...current,
            profiles: current.profiles.map((item) =>
              item.profile === profile ? { ...item, ...patch } : item
            ),
          }
        : current
    );
    setToast(null);
  }

  async function handleSave() {
    if (!config || saving) return;

    // El servidor valida igual; acá se atrapa antes para no mandar un precio de
    // cero o un usuario inexistente y recibir un 400 genérico.
    const check = normalizePlanPricing(config);
    if (!check.ok) {
      setError(check.error ?? 'Hay un valor fuera de rango.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/planes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: check.config }),
      });
      const body: ApiResponse | null = await response.json().catch(() => null);

      if (!response.ok || !body?.success || !body.data) {
        setError(body?.error ?? 'No se pudo guardar la configuración.');
        return;
      }

      setConfig(body.data);
      setSaved(body.data);
      setPersistent(body.persisted !== false);
      setSource(body.persisted === false ? 'memory' : 'supabase');
      setWarning(body.warning ?? null);
      setToast('Precios guardados');
    } catch {
      setError('No pudimos conectarnos. Los cambios siguen acá; vuelve a guardar.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <p className="text-sm font-semibold text-slate-400">Cargando precios…</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-5xl">
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error ?? 'No se pudo cargar la configuración de precios.'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Planes</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Precio de alta, mensualidad y usuarios incluidos para cada perfil de socio. Abajo, el
            CCA con la fórmula para pasarlo a pesos.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Guardando…' : 'Guardar precios'}
          </button>
          <p className="text-[11px] font-medium text-slate-400">
            {dirty ? 'Hay cambios sin guardar' : SOURCE_LABEL[source]}
          </p>
        </div>
      </div>

      {!persistent && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {warning ??
              'Este entorno no guarda en la base: lo que se guarde acá se pierde al reiniciar el proceso.'}
          </span>
        </div>
      )}

      {persistent && warning && (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {toast && !dirty && !error && (
        <div
          role="status"
          className="mt-5 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
        >
          <Check className="h-4 w-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* ── Perfiles ────────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-900">Perfiles</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Montos en pesos chilenos. La mensualidad es la base, sin IVA.
          </p>
        </div>

        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="w-40 pb-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Perfil
                </th>
                <th className="pb-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Alta inicial
                </th>
                <th className="pb-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Mensual base
                </th>
                <th className="pb-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Usuarios incluidos
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICING_PROFILES.map((profile) => {
                const plan = profilePlan(config, profile);
                if (!plan) return null;
                return (
                  <tr key={profile} className="border-t border-slate-100">
                    <th scope="row" className="py-3 text-left font-semibold text-slate-800">
                      {profileLabel(profile)}
                    </th>
                    <td className="py-3 pl-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-medium text-slate-400">$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_PRICE_CLP}
                          step={10}
                          value={plan.altaInicialClp}
                          onChange={(event) => {
                            const parsed = parseInteger(event.target.value);
                            if (parsed === null || parsed > MAX_PRICE_CLP) return;
                            updateProfile(profile, { altaInicialClp: parsed });
                          }}
                          aria-label={`Alta inicial de ${profileLabel(profile)}`}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-medium text-slate-400">$</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_PRICE_CLP}
                          step={10}
                          value={plan.mensualBaseClp}
                          onChange={(event) => {
                            const parsed = parseInteger(event.target.value);
                            if (parsed === null || parsed > MAX_PRICE_CLP) return;
                            updateProfile(profile, { mensualBaseClp: parsed });
                          }}
                          aria-label={`Mensualidad base de ${profileLabel(profile)}`}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_USERS}
                        max={MAX_USERS}
                        step={1}
                        value={plan.usuariosIncluidos}
                        onChange={(event) => {
                          const parsed = parseInteger(event.target.value);
                          if (parsed === null || parsed < MIN_USERS || parsed > MAX_USERS) return;
                          updateProfile(profile, { usuariosIncluidos: parsed });
                        }}
                        aria-label={`Usuarios incluidos en ${profileLabel(profile)}`}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
          Así queda hoy: {PRICING_PROFILES.map((profile) => {
            const plan = profilePlan(config, profile);
            if (!plan) return null;
            return `${profileLabel(profile)} ${formatPlanPrice(plan.altaInicialClp)} de alta y ${formatPlanPrice(
              plan.mensualBaseClp
            )} al mes`;
          })
            .filter(Boolean)
            .join(' · ')}
          .
        </p>
      </section>

      {/* ── CCA ─────────────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-start gap-2.5 border-b border-slate-100 px-5 py-4">
          <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">CCA</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{CCA_DEFINITION}</p>
          </div>
        </div>

        <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="cca-valor"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-400"
              >
                CCA del socio (UF)
              </label>
              <input
                id="cca-valor"
                type="text"
                inputMode="decimal"
                value={ccaUf}
                onChange={(event) => setCcaUf(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Suma de todas sus publicaciones, en UF. Ejemplo: un CCA de 100.000 con una UF de
                $40.000 da $4.000.
              </p>
            </div>

            <div>
              <label
                htmlFor="cca-uf"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-400"
              >
                Valor de la UF ($)
              </label>
              <input
                id="cca-uf"
                type="text"
                inputMode="decimal"
                value={ufValue}
                onChange={(event) => {
                  setUfValue(event.target.value);
                  setUfSource('manual');
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                {ufSource === 'indicador'
                  ? 'Valor del día traído de /api/indicators; se puede corregir a mano.'
                  : 'Valor escrito a mano para esta consulta.'}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                Formato chileno: el punto separa miles y la coma, decimales (41.242,32).
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Fórmula</p>
            <p className="mt-1 font-mono text-xs text-slate-600">{CCA_FORMULA}</p>

            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                $CCA a cobrar
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                {ccaValue === null ? '—' : formatCcaAmount(ccaValue.amount)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                {ccaValue === null
                  ? 'Escribe el CCA y el valor de la UF.'
                  : `${formatDecimalInput(ccaValue.uf)} × $${formatDecimalInput(ccaValue.rate)} ÷ 1.000.000`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 border-t border-slate-100 px-5 py-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Esta cuenta no se guarda: el CCA depende del stock publicado de cada socio y de la UF
            del día. La fórmula vive en el código para que la pantalla y cualquier cálculo futuro
            usen la misma.
          </p>
        </div>
      </section>
    </div>
  );
}
