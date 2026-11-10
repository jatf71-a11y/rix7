'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Check, Info, Loader2, Save } from 'lucide-react';

import {
  CCA_DEFINITION,
  CCA_FORMULA,
  CCA_DIVISOR,
  DEFAULT_CCA_PCT,
  MAX_CCA_PCT,
  MAX_PRICE_CLP,
  MAX_USERS,
  MIN_CCA_PCT,
  MIN_USERS,
  PRICING_PROFILES,
  captacionMonthlyFor,
  ccaAmountClp,
  ccaFactor,
  formatCcaAmount,
  formatDecimalInput,
  normalizePlanPricing,
  parseDecimalInput,
  planPrice,
  profileLabel,
  type LeadBracket,
  type PlanPrice,
  type PlanPricingConfig,
} from '@/lib/kyb/planPricing';
import { KYB_PLAN_IDS, formatPlanPrice, getKybPlan } from '@/lib/kyb/plans';
import type { PartnerKind } from '@/lib/data/partners';

/**
 * Planes: dos productos en paralelo y el CCA.
 *
 * **Planes de Suscripción** es el producto de siempre: para cada plan —básico,
 * profesional, premium— cuánto se cobra una vez (alta inicial), cuánto por mes
 * (mensualidad base) y cuántos usuarios entran en esa mensualidad. Es lo que la
 * empresa elige desde el correo de calificación y con lo que se arma su
 * propuesta; el perfil del socio define la captación, no el precio.
 *
 * **Planes de Captación** es el otro: la suscripción mensual para estar activo
 * en el reparto de leads, y lo que cuesta acceder a un lead según su valor (en
 * UF si es una venta, en pesos si es un arriendo). Son precios distintos de los
 * de suscripción y se cobran por separado.
 *
 * Abajo, el CCA —la suma de las publicaciones del socio en UF— con la fórmula
 * para pasarlo a pesos. No se guarda como si fuera un precio: depende del stock
 * publicado de cada socio y cambia con el valor de la UF, así que la pantalla lo
 * calcula con el valor del día que devuelve `/api/indicators`.
 *
 * Lo que sí se guarda es el **%CCA**, el ajuste del factor: el `÷ 1.000.000` de
 * la fórmula deja de ser una constante intocable y pasa a ser un porcentaje que
 * el equipo mueve a discreción. Con 100 % el factor es 1.000.000 y el monto es
 * el de siempre; con 50 % se cobra la mitad y con 200 %, el doble. Por eso el
 * %CCA viaja con los precios y el botón de guardar lo incluye: es una decisión
 * comercial, no una consulta rápida.
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

/** Cómo se lee un tramo de acceso: «Hasta UF 5.000», «Más de $1.500.000». */
function bracketLabel(bracket: LeadBracket, unit: 'uf' | 'clp'): string {
  const money = (value: number) => `$${formatDecimalInput(value)}`;
  const amount = (value: number) =>
    unit === 'uf' ? `UF ${formatDecimalInput(value)}` : money(value);

  if (bracket.from === 0 && bracket.to !== null) return `Hasta ${amount(bracket.to)}`;
  if (bracket.to === null) {
    return bracket.from === 0 ? 'Cualquier valor' : `Más de ${amount(bracket.from - 1)}`;
  }
  return `${amount(bracket.from)} – ${amount(bracket.to)}`;
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

  // Calculadora del CCA: el CCA y la UF son una consulta rápida; el %CCA, en
  // cambio, es parte de la configuración y se guarda con los precios.
  const [ccaUf, setCcaUf] = useState(formatDecimalInput(100_000));
  const [ufValue, setUfValue] = useState(formatDecimalInput(UF_FALLBACK));
  const [ufSource, setUfSource] = useState<'indicador' | 'manual'>('indicador');
  const [ccaPctInput, setCcaPctInput] = useState(formatDecimalInput(DEFAULT_CCA_PCT));

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
        setCcaPctInput(formatDecimalInput(body.data.ccaPct));
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

  const ccaPct = useMemo(() => parseDecimalInput(ccaPctInput), [ccaPctInput]);

  const dirty = useMemo(() => {
    if (!config || !saved) return false;
    // Un %CCA vacío o ilegible no puede considerarse guardado: hay algo que
    // acomodar antes de mandar el formulario.
    if (ccaPct === null) return true;
    return !sameConfig({ ...config, ccaPct }, saved);
  }, [config, saved, ccaPct]);

  const ccaValue = useMemo(() => {
    const uf = parseDecimalInput(ccaUf);
    const rate = parseDecimalInput(ufValue);
    if (uf === null || rate === null || ccaPct === null) return null;
    return {
      uf,
      rate,
      pct: ccaPct,
      amount: ccaAmountClp(uf, rate, ccaPct),
      factor: ccaFactor(ccaPct),
    };
  }, [ccaUf, ufValue, ccaPct]);

  function updatePlan(plan: PlanPrice['plan'], patch: Partial<PlanPrice>) {
    setConfig((current) =>
      current
        ? {
            ...current,
            plans: current.plans.map((item) =>
              item.plan === plan ? { ...item, ...patch } : item
            ),
          }
        : current
    );
    setToast(null);
  }

  function updateCaptacionMonthly(profile: PartnerKind, monthlyClp: number) {
    setConfig((current) =>
      current
        ? {
            ...current,
            captacion: {
              ...current.captacion,
              monthly: current.captacion.monthly.map((item) =>
                item.profile === profile ? { ...item, monthlyClp } : item
              ),
            },
          }
        : current
    );
    setToast(null);
  }

  /**
   * Cambia el precio de un tramo.
   *
   * Se identifica por su `from`, que es lo que define el corte: los cortes son
   * parte del producto y no se editan acá, solo lo que se cobra dentro de ellos.
   */
  function updateLeadPrice(kind: 'ventas' | 'arriendos', from: number, priceClp: number) {
    setConfig((current) =>
      current
        ? {
            ...current,
            captacion: {
              ...current.captacion,
              [kind]: current.captacion[kind].map((bracket) =>
                bracket.from === from ? { ...bracket, priceClp } : bracket
              ),
            },
          }
        : current
    );
    setToast(null);
  }

  async function handleSave() {
    if (!config || saving) return;

    // El servidor valida igual; acá se atrapa antes para no mandar un precio de
    // cero o un usuario inexistente y recibir un 400 genérico.
    const check = normalizePlanPricing({ ...config, ccaPct: ccaPct ?? Number.NaN });
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
      setCcaPctInput(formatDecimalInput(body.data.ccaPct));
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
      <div className="w-full">
        <p className="text-sm font-semibold text-slate-400">Cargando precios…</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="w-full">
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
    <div className="w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Planes</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Dos productos: <strong className="font-semibold text-slate-700">Planes de Suscripción</strong>{' '}
            (alta, mensualidad y usuarios por plan, con el CCA) y{' '}
            <strong className="font-semibold text-slate-700">Planes de Captación</strong> (suscripción
            de captación y precio de acceso a cada lead).
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

      {/* ── Planes de Suscripción ───────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-900">Planes de Suscripción</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Montos en pesos chilenos, sin IVA. Son los que ve la empresa en el correo de
            calificación y con los que se arma la propuesta al elegir plan; el perfil del socio
            define la captación, no el precio de la suscripción.
          </p>
        </div>

        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="w-40 pb-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Plan
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
              {KYB_PLAN_IDS.map((planId) => {
                const plan = planPrice(config, planId);
                if (!plan) return null;
                const catalog = getKybPlan(planId);
                return (
                  <tr key={planId} className="border-t border-slate-100">
                    <th scope="row" className="py-3 text-left font-semibold text-slate-800">
                      {catalog.name}
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
                            updatePlan(planId, { altaInicialClp: parsed });
                          }}
                          aria-label={`Alta inicial del plan ${catalog.name}`}
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
                            updatePlan(planId, { mensualBaseClp: parsed });
                          }}
                          aria-label={`Mensualidad base del plan ${catalog.name}`}
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
                          updatePlan(planId, { usuariosIncluidos: parsed });
                        }}
                        aria-label={`Usuarios incluidos en el plan ${catalog.name}`}
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
          Así queda hoy: {KYB_PLAN_IDS.map((planId) => {
            const plan = planPrice(config, planId);
            if (!plan) return null;
            return `${getKybPlan(planId).name} ${formatPlanPrice(plan.altaInicialClp)} de alta y ${formatPlanPrice(
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
                Suma de la cartera del socio, en UF. No se cobra por publicación. Ejemplo: un CCA de
                100.000 con una UF de $40.000 da $4.000.
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

            <div>
              <label
                htmlFor="cca-pct"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-400"
              >
                %CCA
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cca-pct"
                  type="text"
                  inputMode="decimal"
                  value={ccaPctInput}
                  onChange={(event) => {
                    setCcaPctInput(event.target.value);
                    setToast(null);
                  }}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <span className="text-sm font-bold text-slate-500">%</span>
                <span className="text-[11px] text-slate-400">
                  Factor: ÷{' '}
                  <strong className="font-mono font-bold text-slate-600">
                    {formatDecimalInput(Math.round(ccaFactor(ccaPct ?? DEFAULT_CCA_PCT)))}
                  </strong>
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                Cuánto del valor base del CCA se cobra. El de partida,{' '}
                {formatDecimalInput(DEFAULT_CCA_PCT)} %, deja el factor en{' '}
                {formatDecimalInput(Math.round(ccaFactor(DEFAULT_CCA_PCT)))} —el divisor base,{' '}
                {formatDecimalInput(CCA_DIVISOR)}—: el monto es CCA × UF ÷ 1.000.000. Se guarda con
                los precios, entre {MIN_CCA_PCT} y {MAX_CCA_PCT}.
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
                  ? 'Escribe el CCA, el valor de la UF y el %CCA.'
                  : `${formatDecimalInput(ccaValue.uf)} × $${formatDecimalInput(
                      ccaValue.rate
                    )} ÷ 1.000.000 × ${formatDecimalInput(ccaValue.pct)} %`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 border-t border-slate-100 px-5 py-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            El monto no se guarda: depende del stock publicado de cada socio y de la UF del día. Lo
            que sí queda guardado es el %CCA, que es el ajuste del factor y se aplica a todos los
            cálculos.
          </p>
        </div>
      </section>

      {/* ── Planes de Captación ─────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-900">Planes de Captación</h2>
          <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-slate-400">
            Producto paralelo a la suscripción: se paga por recibir leads. La suscripción mensual
            mantiene la cuenta activa en el reparto y, aparte, cada lead que se abre se cobra según
            su valor.
          </p>
        </div>

        <div className="px-5 py-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Suscripción Captación Activa
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Mensualidad por perfil para estar activo. Montos en pesos chilenos, sin IVA.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="w-40 pb-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Perfil
                  </th>
                  <th className="pb-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Captación activa / mes
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRICING_PROFILES.map((profile) => (
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
                          value={captacionMonthlyFor(config, profile)}
                          onChange={(event) => {
                            const parsed = parseInteger(event.target.value);
                            if (parsed === null || parsed > MAX_PRICE_CLP) return;
                            updateCaptacionMonthly(profile, parsed);
                          }}
                          aria-label={`Suscripción de captación de ${profileLabel(profile)}`}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {(
          [
            {
              kind: 'ventas' as const,
              title: 'Acceso a leads de ventas',
              unit: 'uf' as const,
              column: 'Valor de la propiedad',
              help: 'Se cobra al socio cada vez que accede a un lead, según el valor de la propiedad en UF.',
              brackets: config.captacion.ventas,
            },
            {
              kind: 'arriendos' as const,
              title: 'Acceso a leads de arriendo',
              unit: 'clp' as const,
              column: 'Canon mensual',
              help: 'Se cobra al socio cada vez que accede a un lead, según el canon mensual en pesos.',
              brackets: config.captacion.arriendos,
            },
          ]
        ).map((table) => (
          <div key={table.kind} className="border-t border-slate-100 px-5 py-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
              {table.title}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">{table.help}</p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="w-56 pb-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      {table.column}
                    </th>
                    <th className="pb-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Acceso
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.brackets.map((bracket) => (
                    <tr key={bracket.from} className="border-t border-slate-100">
                      <th scope="row" className="py-3 text-left font-medium text-slate-700">
                        {bracketLabel(bracket, table.unit)}
                      </th>
                      <td className="py-3 pl-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[11px] font-medium text-slate-400">$</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={MAX_PRICE_CLP}
                            step={500}
                            value={bracket.priceClp}
                            onChange={(event) => {
                              const parsed = parseInteger(event.target.value);
                              if (parsed === null || parsed > MAX_PRICE_CLP) return;
                              updateLeadPrice(table.kind, bracket.from, parsed);
                            }}
                            aria-label={`Acceso a lead de ${table.kind} ${bracketLabel(
                              bracket,
                              table.unit
                            )}`}
                            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="flex items-start gap-2.5 border-t border-slate-100 px-5 py-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Los cortes de cada tramo son parte de la definición del producto; acá se ajusta lo que
            se cobra dentro de ellos. La suscripción de captación es independiente de los planes de
            suscripción: un socio puede tener las dos, una sola o ninguna.
          </p>
        </div>
      </section>
    </div>
  );
}
