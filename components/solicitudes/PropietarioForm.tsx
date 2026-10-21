'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Home,
  Loader2,
  MapPin,
  Send,
} from 'lucide-react';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import {
  SOLICITUD_PROPERTY_TYPES,
  SOLICITUD_PROPERTY_TYPE_LABELS,
} from '@/lib/data/solicitudes';
import { isValidRol, ROL_MAX_LENGTH } from '@/lib/utils/rol';

/**
 * Licitación de una propiedad de un propietario sin corredora.
 *
 * No publica una ficha: deja la propiedad y sus datos para que el equipo la
 * revise e invite a corredoras verificadas a competir por representarla. Por eso
 * el formulario pide lo mínimo para asignarla (operación, tipo, ubicación y
 * precio esperado) y no fotos ni características: eso lo completará después la
 * corredora que gane.
 *
 * La solicitud se guarda en `public.solicitudes`; el folio que se muestra al
 * final es el id, para que la persona pueda referenciarla al escribir.
 */

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const labelClass = 'mb-1.5 block text-xs font-bold text-slate-700';

interface FormState {
  operation: 'sale' | 'rent';
  property_type: string;
  region: string;
  commune: string;
  address: string;
  /** ROL de propiedad (SII): identificación obligatoria del inmueble. */
  rol: string;
  expected_price: string;
  message: string;
  name: string;
  email: string;
  phone: string;
  consent: boolean;
}

const INITIAL: FormState = {
  operation: 'sale',
  property_type: 'apartment',
  region: '',
  commune: '',
  address: '',
  rol: '',
  expected_price: '',
  message: '',
  name: '',
  email: '',
  phone: '',
  consent: false,
};

interface Success {
  id: string | null;
  persisted: boolean;
}

export default function PropietarioForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);

  const communes = useMemo(() => {
    const region = CHILE_REGIONS.find((item) => item.name === form.region);
    return region?.communes.map((commune) => commune.name) ?? [];
  }, [form.region]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Misma regla que `normalizeSolicitud` en el servidor; acá se falla antes
    // de viajar para no perder lo escrito por un error de formato.
    const rol = form.rol.trim();
    if (!rol) {
      setError('El ROL es obligatorio.');
      return;
    }
    if (!isValidRol(rol)) {
      setError('ROL inválido (ej: 15234-67).');
      return;
    }
    const price = Number(form.expected_price);
    if (!form.expected_price.trim() || !Number.isFinite(price) || price <= 0) {
      setError('El precio esperado es obligatorio.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/solicitudes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'licitacion',
          ...form,
          // El input da cadena; vacío significa «a convenir», no cero.
          expected_price: form.expected_price.trim() ? Number(form.expected_price) : undefined,
          rol: form.rol.trim(),
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? 'No se pudo enviar la solicitud. Revisa los datos e intenta de nuevo.');
        return;
      }

      setSuccess({ id: body?.id ?? null, persisted: body?.persisted !== false });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Sin conexión con el servidor. Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <h2 className="mt-5 text-xl font-black text-slate-900">Recibimos tu propiedad</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Tu solicitud quedó ingresada a licitación. El equipo de Rix7 la revisará y
          contactará a corredoras registradas y verificadas para que compitan por
          representarte.
        </p>

        {success.id && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Referencia:{' '}
            <span className="font-mono font-semibold text-slate-700">{success.id}</span>
          </p>
        )}

        <ol className="mt-6 space-y-4">
          {[
            ['Revisamos la propiedad', 'Verificamos los datos y la zona para preparar la licitación.'],
            ['Invitamos a corredoras', 'Corredoras verificadas reciben la ficha y deciden si participan.'],
            ['Te contactamos', 'Te presentamos las propuestas y eliges con quién trabajar.'],
          ].map(([title, detail], index) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="text-xs leading-relaxed text-slate-500">{detail}</p>
              </div>
            </li>
          ))}
        </ol>

        {!success.persisted && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Este entorno funciona sin Supabase: la solicitud se guardó solo en memoria
            para poder probar el flujo.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/publicar"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Volver a Publicar
          </Link>
          <button
            type="button"
            onClick={() => {
              setForm(INITIAL);
              setSuccess(null);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Ingresar otra propiedad
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <Home className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-black text-slate-900">La propiedad</h2>
            <p className="text-xs text-slate-500">Datos básicos para preparar la licitación.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>Operación</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['sale', 'Venta'],
                ['rent', 'Arriendo'],
              ].map(([value, label]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                    form.operation === value
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="operation"
                    value={value}
                    checked={form.operation === value}
                    onChange={() => update('operation', value as 'sale' | 'rent')}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="property_type" className={labelClass}>
              Tipo de propiedad
            </label>
            <select
              id="property_type"
              value={form.property_type}
              onChange={(event) => update('property_type', event.target.value)}
              className={inputClass}
              required
            >
              {SOLICITUD_PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SOLICITUD_PROPERTY_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="expected_price" className={labelClass}>
              Precio esperado (CLP)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                $
              </span>
              {/* En CLP el precio es un entero: con `min={1}` y `step={1000}`
                  la base del paso queda en 1 y el navegador rechazaba montos
                  redondos como 150.000.000 (el más cercano válido era
                  149.999.001). Con paso 1 cualquier monto entero es válido y
                  el servidor sigue redondeando. */}
              <input
                id="expected_price"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={form.expected_price}
                onChange={(event) => update('expected_price', event.target.value)}
                placeholder="120000000"
                className={`${inputClass} pl-7`}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="region" className={labelClass}>
              Región
            </label>
            <select
              id="region"
              value={form.region}
              onChange={(event) => {
                update('region', event.target.value);
                update('commune', '');
              }}
              className={inputClass}
              required
            >
              <option value="">Selecciona una región</option>
              {CHILE_REGIONS.map((region) => (
                <option key={region.code} value={region.name}>
                  {region.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="commune" className={labelClass}>
              Comuna
            </label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="commune"
                type="text"
                list="comunas-licitacion"
                value={form.commune}
                onChange={(event) => update('commune', event.target.value)}
                placeholder={form.region ? 'Elige o escribe tu comuna' : 'Primero elige la región'}
                className={`${inputClass} pl-9`}
                required
                minLength={2}
                maxLength={80}
              />
              <datalist id="comunas-licitacion">
                {communes.map((commune) => (
                  <option key={commune} value={commune} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="address" className={labelClass}>
              Dirección exacta
            </label>
            <input
              id="address"
              type="text"
              autoComplete="street-address"
              value={form.address}
              onChange={(event) => update('address', event.target.value)}
              placeholder="Ej: Av. Providencia 1234"
              className={inputClass}
              required
              minLength={5}
              maxLength={300}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Calle y número. La usamos para ubicar la propiedad y asignar la zona; no se
              publica.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="rol" className={labelClass}>
              ROL (SII)
            </label>
            <input
              id="rol"
              type="text"
              value={form.rol}
              onChange={(event) => update('rol', event.target.value)}
              placeholder="15234-67"
              className={inputClass}
              required
              minLength={4}
              maxLength={ROL_MAX_LENGTH}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Identificación del inmueble ante el SII. Es obligatoria para preparar la licitación.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-black text-slate-900">Detalles de la propiedad</h2>
        <p className="mb-4 text-xs text-slate-500">
          Estado, urgencia, si ya tuvo corredora o cualquier detalle relevante para preparar la
          licitación.
        </p>
        <label htmlFor="message" className="sr-only">
          Detalles de la propiedad
        </label>
        <textarea
          id="message"
          value={form.message}
          onChange={(event) => update('message', event.target.value)}
          rows={4}
          required
          minLength={10}
          maxLength={1200}
          placeholder="Ej: departamento arrendado hasta marzo, quiero vender sin esperar."
          className={inputClass}
        />
        <p className="mt-1 text-right text-[11px] text-slate-400">{form.message.length}/1200</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-black text-slate-900">Tus datos</h2>
        <p className="mb-4 text-xs text-slate-500">
          Solo los usamos para contactarte por esta licitación.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="name" className={labelClass}>
              Nombre completo
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              className={inputClass}
              required
              minLength={2}
              maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              className={inputClass}
              required
              maxLength={200}
            />
          </div>

          <div>
            <label htmlFor="phone" className={labelClass}>
              Teléfono
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => update('phone', event.target.value)}
              placeholder="+56 9 1234 5678"
              className={inputClass}
              required
              minLength={6}
              maxLength={40}
            />
          </div>
        </div>

        <label className="mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(event) => update('consent', event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            required
          />
          <span>
            Acepto la{' '}
            <Link
              href="/legal/privacidad"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-700 underline underline-offset-2"
            >
              política de privacidad
            </Link>{' '}
            y autorizo a Rix7 a contactarme por esta solicitud.
          </span>
        </label>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/publicar"
          className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a las opciones
        </Link>

        <button
          type="submit"
          disabled={sending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? 'Enviando…' : 'Enviar a licitación'}
        </button>
      </div>
    </form>
  );
}
