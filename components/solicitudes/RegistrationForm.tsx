'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  Send,
  UserRound,
} from 'lucide-react';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';

/**
 * Registro inicial de quien va a publicar: corredora, inmobiliaria o **agente**
 * independiente.
 *
 * Los tres caminos comparten la base —contacto, ubicación y cómo saber quién es
 * quien escribe— pero no piden lo mismo: una empresa acredita su operación y su
 * cargo; un agente trabaja por cuenta propia, no factura y emite boleta de
 * honorarios con su RUT de persona natural, así que no hay razón social que
 * pedirle. El formulario definitivo de cada camino se va a definir después;
 * por eso hoy guarda un **registro inicial** con lo mínimo para contactar y
 * revisar, y manda `kind` para que la API y el panel separen los tres.
 *
 * Lo que no se hace acá: prometer que quien se registra ya quedó habilitado. El
 * texto de éxito habla de revisión y acreditación, no de publicación inmediata.
 *
 * Toda la copia propia de cada camino vive en `COPY`, no en `if`s repartidos por
 * el JSX: agregar un cuarto camino es agregar una entrada.
 */

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const labelClass = 'mb-1.5 block text-xs font-bold text-slate-700';

export type RegistrationKind = 'corredora' | 'inmobiliaria' | 'agente';

interface KindCopy {
  /** Ícono de la sección de identificación. */
  icon: typeof Building2;
  sectionTitle: string;
  sectionBody: string;
  companyLabel: string;
  companyPlaceholder: string;
  /** El RUT de una empresa (76…) y el de una persona natural (12…) no se parecen. */
  rutPlaceholder: string;
  websitePlaceholder: string;
  contactTitle: string;
  contactBody: string;
  messagePlaceholder: string;
  successTitle: string;
  successBody: string;
  steps: [string, string][];
}

const COPY: Record<RegistrationKind, KindCopy> = {
  corredora: {
    icon: Building2,
    sectionTitle: 'La empresa',
    sectionBody: 'Estos datos nos permiten identificar y revisar la empresa.',
    companyLabel: 'Nombre de la empresa',
    companyPlaceholder: 'Ej: Catedral Propiedades',
    rutPlaceholder: '76.123.456-7',
    websitePlaceholder: 'https://tuempresa.cl',
    contactTitle: 'Quién nos contacta',
    contactBody: 'Una persona de la empresa que pueda responder por el registro.',
    messagePlaceholder: 'Ej: corredora con foco en departamentos en Providencia, 4 agentes.',
    successTitle: 'Recibimos el registro de tu corredora',
    successBody:
      'Vamos a revisar los datos de la empresa y te contactaremos para completar la acreditación. Una vez verificada, tu corredora podrá publicar stock en Rix7.',
    steps: [
      ['Revisamos la empresa', 'Comprobamos los datos de la corredora y de quien la representa.'],
      ['Acreditamos la operación', 'Te pedimos los documentos que respaldan la corredora.'],
      ['Habilitamos el acceso', 'Creamos el vínculo de la cuenta con la corredora y su panel.'],
    ],
  },
  inmobiliaria: {
    icon: Building2,
    sectionTitle: 'La empresa',
    sectionBody: 'Estos datos nos permiten identificar y revisar la empresa.',
    companyLabel: 'Nombre de la empresa',
    companyPlaceholder: 'Ej: Inmobiliaria Los Andes',
    rutPlaceholder: '76.123.456-7',
    websitePlaceholder: 'https://tuempresa.cl',
    contactTitle: 'Quién nos contacta',
    contactBody: 'Una persona de la empresa que pueda responder por el registro.',
    messagePlaceholder: 'Ej: inmobiliaria con dos proyectos en Ñuñoa y stock en arriendo.',
    successTitle: 'Recibimos el registro de tu inmobiliaria',
    successBody:
      'Vamos a revisar los datos de la empresa y te contactaremos para definir el perfil y el stock que publicará. Después de la acreditación, la inmobiliaria tendrá su espacio en Rix7.',
    steps: [
      ['Revisamos la empresa', 'Comprobamos la inmobiliaria y el tipo de stock que administra.'],
      ['Definimos el perfil', 'Acordamos proyectos, propiedades y datos públicos de la empresa.'],
      ['Habilitamos el acceso', 'Creamos la cuenta y el vínculo con el panel de publicación.'],
    ],
  },
  agente: {
    icon: UserRound,
    sectionTitle: 'Tus datos de agente',
    sectionBody:
      'No se pide razón social ni boleta de actividad: trabajas por cuenta propia y emites boleta de honorarios con tu RUT de persona natural.',
    companyLabel: 'Nombre comercial',
    companyPlaceholder: 'Si operas bajo uno, déjalo acá',
    rutPlaceholder: '12.345.678-5',
    websitePlaceholder: 'https://tusitio.cl',
    contactTitle: 'Tus datos de contacto',
    contactBody: 'Con estos te contactamos para revisar el registro.',
    messagePlaceholder: 'Ej: agente independiente en Ñuñoa y Providencia, 6 años en el mercado.',
    successTitle: 'Recibimos tu registro como agente',
    successBody:
      'Vamos a revisar tus datos y te contactaremos para completar la acreditación. Una vez verificado, podrás publicar tu stock en Rix7 desde tu cuenta.',
    steps: [
      ['Revisamos tus datos', 'Confirmamos tu RUT y cómo operas hoy.'],
      ['Definimos tu perfil público', 'Tu nombre, tu zona de trabajo y cómo te contactan.'],
      ['Habilitamos tu acceso', 'Creamos tu cuenta con su panel de publicaciones.'],
    ],
  },
};

interface FormState {
  company: string;
  rut: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  region: string;
  commune: string;
  website: string;
  message: string;
  consent: boolean;
}

const INITIAL: FormState = {
  company: '',
  rut: '',
  name: '',
  role: '',
  email: '',
  phone: '',
  region: '',
  commune: '',
  website: '',
  message: '',
  consent: false,
};

interface Success {
  id: string | null;
  persisted: boolean;
}

export default function RegistrationForm({ kind }: { kind: RegistrationKind }) {
  const copy = COPY[kind];
  // Un agente es una persona: no hay nombre de empresa que pedirle ni cargo que
  // declarar. Esconder los campos no es atajo visual, es la coherencia con el
  // servidor, que tampoco los exige para este `kind` (ver `normalizeSolicitud`).
  const asksCompany = kind !== 'agente';
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
    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/solicitudes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, ...form }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? 'No se pudo enviar el registro. Revisa los datos e intenta de nuevo.');
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
        <h2 className="mt-5 text-xl font-black text-slate-900">{copy.successTitle}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.successBody}</p>

        {success.id && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Referencia:{' '}
            <span className="font-mono font-semibold text-slate-700">{success.id}</span>
          </p>
        )}

        <ol className="mt-6 space-y-4">
          {copy.steps.map(([title, detail], index) => (
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
            Este entorno funciona sin Supabase: el registro se guardó solo en memoria
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
            Enviar otro registro
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <copy.icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-black text-slate-900">{copy.sectionTitle}</h2>
            <p className="text-xs text-slate-500">{copy.sectionBody}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {asksCompany && (
            <div className="sm:col-span-2">
              <label htmlFor="company" className={labelClass}>
                {copy.companyLabel}
              </label>
              <input
                id="company"
                type="text"
                autoComplete="organization"
                value={form.company}
                onChange={(event) => update('company', event.target.value)}
                placeholder={copy.companyPlaceholder}
                className={inputClass}
                required
                minLength={2}
                maxLength={160}
              />
            </div>
          )}

          <div>
            <label htmlFor="rut" className={labelClass}>
              RUT <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="rut"
              type="text"
              value={form.rut}
              onChange={(event) => update('rut', event.target.value)}
              placeholder={copy.rutPlaceholder}
              className={inputClass}
              maxLength={20}
            />
          </div>

          <div>
            <label htmlFor="website" className={labelClass}>
              Sitio web <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="website"
              type="url"
              inputMode="url"
              value={form.website}
              onChange={(event) => update('website', event.target.value)}
              placeholder={copy.websitePlaceholder}
              className={inputClass}
              maxLength={300}
            />
          </div>

          <div>
            <label htmlFor="region" className={labelClass}>
              Región <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <select
              id="region"
              value={form.region}
              onChange={(event) => {
                update('region', event.target.value);
                update('commune', '');
              }}
              className={inputClass}
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
              Comuna <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="commune"
              type="text"
              list="comunas-empresa"
              value={form.commune}
              onChange={(event) => update('commune', event.target.value)}
              placeholder={form.region ? 'Elige o escribe la comuna' : 'Primero elige la región'}
              className={inputClass}
              maxLength={80}
            />
            <datalist id="comunas-empresa">
              {communes.map((commune) => (
                <option key={commune} value={commune} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-black text-slate-900">{copy.contactTitle}</h2>
        <p className="mb-4 text-xs text-slate-500">{copy.contactBody}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
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

          {asksCompany && (
            <div>
              <label htmlFor="role" className={labelClass}>
                Cargo <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="role"
                type="text"
                autoComplete="organization-title"
                value={form.role}
                onChange={(event) => update('role', event.target.value)}
                placeholder="Ej: Gerente comercial"
                className={inputClass}
                maxLength={80}
              />
            </div>
          )}

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
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <label htmlFor="message" className={labelClass}>
          {asksCompany ? 'Cuéntanos sobre la empresa' : 'Cuéntanos sobre tu trabajo'}{' '}
          <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <textarea
          id="message"
          value={form.message}
          onChange={(event) => update('message', event.target.value)}
          rows={4}
          maxLength={1200}
          placeholder={copy.messagePlaceholder}
          className={inputClass}
        />
        <p className="mt-1 text-right text-[11px] text-slate-400">{form.message.length}/1200</p>

        <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
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
            y autorizo a Rix7 a contactarme por este registro.
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
          {sending ? 'Enviando…' : 'Enviar registro'}
        </button>
      </div>
    </form>
  );
}
