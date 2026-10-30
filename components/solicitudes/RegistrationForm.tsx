'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  MailQuestion,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { KYB_STATUS_LABELS, type KybQuestion, type KybStatus } from '@/lib/kyb/status';
import { toKybPayload, usesKybFlow } from '@/lib/kyb/registration';

/**
 * Registro inicial de quien va a publicar: corredora, inmobiliaria o
 * **profesional independiente**
 * independiente.
 *
 * Los tres caminos comparten la base —contacto, ubicación y cómo saber quién es
 * quien escribe— pero no piden lo mismo: una empresa acredita su operación y su
 * cargo; un profesional independiente trabaja por cuenta propia, no factura y emite boleta de
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
    rutPlaceholder: '76.123.456-0',
    websitePlaceholder: 'https://tuempresa.cl',
    contactTitle: 'Quién nos contacta',
    contactBody: 'Una persona de la empresa que pueda responder por el registro.',
    messagePlaceholder: 'Ej: corredora con foco en departamentos en Providencia, 4 corredores.',
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
    rutPlaceholder: '76.123.456-0',
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
    sectionTitle: 'Tus datos de profesional independiente',
    sectionBody:
      'No se pide razón social ni boleta de actividad: trabajas por cuenta propia y emites boleta de honorarios con tu RUT de persona natural.',
    companyLabel: 'Nombre comercial',
    companyPlaceholder: 'Si operas bajo uno, déjalo acá',
    rutPlaceholder: '12.345.678-5',
    websitePlaceholder: 'https://tusitio.cl',
    contactTitle: 'Tus datos de contacto',
    contactBody: 'Con estos te contactamos para revisar el registro.',
    messagePlaceholder:
      'Ej: profesional independiente en Ñuñoa y Providencia, 6 años en el mercado.',
    successTitle: 'Recibimos tu registro como profesional independiente',
    successBody:
      'Vamos a revisar tus datos y te contactaremos para completar la acreditación. Una vez verificado, podrás publicar tu stock en Rix7 desde tu cuenta.',
    steps: [
      ['Revisamos tus datos', 'Confirmamos tu RUT y cómo operas hoy.'],
      ['Definimos tu perfil público', 'Tu nombre, tu zona de trabajo y cómo te contactan.'],
      ['Habilitamos tu acceso', 'Creamos tu cuenta con su panel de publicaciones.'],
    ],
  },
};

/**
 * Alcance geográfico del registro.
 *
 * Antes se preguntaba región y comuna de la oficina; lo que sirve para asignar
 * trabajo es si la corredora, inmobiliaria o profesional independiente opera en todo Chile o solo
 * en algunas regiones. `''` es «todavía no eligió» y el formulario lo exige.
 */
type Coverage = '' | 'nacional' | 'regional';

const COVERAGE_OPTIONS: { value: Exclude<Coverage, ''>; title: string; detail: string }[] = [
  { value: 'nacional', title: 'Nacional', detail: 'Trabajas en todo Chile.' },
  { value: 'regional', title: 'Regional', detail: 'Trabajas en regiones específicas.' },
];

interface FormState {
  company: string;
  rut: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  coverage: Coverage;
  regions: string[];
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
  coverage: '',
  regions: [],
  website: '',
  message: '',
  consent: false,
};

/**
 * Resultado del envío.
 *
 * Una empresa recibe la **evaluación** (estado, y las preguntas si quedaron
 * puntos por aclarar); un profesional independiente recibe la confirmación del
 * contacto, porque su
 * registro no pasa por el motor.
 */
type Success =
  | { mode: 'solicitud'; id: string | null; persisted: boolean }
  | {
      mode: 'kyb';
      id: string | null;
      status: KybStatus;
      questions: KybQuestion[];
      persisted: boolean;
      /** El acuse no salió: no se puede prometer un correo que no existe. */
      emailSkipped: boolean;
    };

export default function RegistrationForm({ kind }: { kind: RegistrationKind }) {
  const copy = COPY[kind];
  // Un profesional independiente es una persona: no hay nombre de empresa que pedirle ni cargo que
  // declarar. Esconder los campos no es atajo visual, es la coherencia con el
  // servidor, que tampoco los exige para este `kind` (ver `normalizeSolicitud`).
  const asksCompany = kind !== 'agente';
  const [form, setForm] = useState<FormState>(INITIAL);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleRegion(name: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      regions: checked
        ? Array.from(new Set([...current.regions, name]))
        : current.regions.filter((region) => region !== name),
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Las casillas de región no pueden usar `required` por separado (haría
    // falta marcarlas todas), así que el grupo se valida acá antes de viajar.
    if (!form.coverage) {
      setError('Indica si tu alcance es nacional o regional.');
      return;
    }
    if (form.coverage === 'regional' && form.regions.length === 0) {
      setError('Marca al menos una región donde trabajas.');
      return;
    }

    setSending(true);

    // Una empresa va al alta evaluada; un independiente, al registro de contactos.
    const kyb = usesKybFlow(kind);

    try {
      const response = await fetch(kyb ? '/api/kyb' : '/api/solicitudes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(kyb ? toKybPayload(form, kind) : { kind, ...form }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? 'No se pudo enviar el registro. Revisa los datos e intenta de nuevo.');
        return;
      }

      if (kyb) {
        setSuccess({
          mode: 'kyb',
          id: body?.data?.id ?? null,
          status: body?.data?.status ?? 'Recibida',
          questions: Array.isArray(body?.data?.questions) ? body.data.questions : [],
          persisted: body?.persistent !== false,
          emailSkipped: body?.email?.skipped === true,
        });
      } else {
        setSuccess({ mode: 'solicitud', id: body?.id ?? null, persisted: body?.persisted !== false });
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Sin conexión con el servidor. Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  }

  if (success) {
    // Una empresa ve el resultado de la verificación; un independiente, la confirmación
    // del contacto. El estado de la solicitud manda el texto: prometer «aceptada»
    // cuando quedó pendiente sería el peor mensaje posible.
    const accepted =
      success.mode === 'kyb' && (success.status === 'En_Alta' || success.status === 'Aceptada');
    const pending = success.mode === 'kyb' && !accepted;
    const pendingBody =
      success.mode === 'kyb' && success.questions.length > 0
        ? 'La verificación automática encontró puntos que necesitan una aclaración. Te enviamos al correo de contacto las preguntas y el enlace para responderlas; cuando lo hagas, la evaluación se repite sola.'
        : 'La verificación automática no alcanzó el mínimo para el alta automática. Te enviamos al correo de contacto los siguientes pasos.';

    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            accepted ? 'bg-emerald-50' : success.mode === 'kyb' ? 'bg-blue-50' : 'bg-emerald-50'
          }`}
        >
          {accepted ? (
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
          ) : success.mode === 'kyb' ? (
            <MailQuestion className="h-6 w-6 text-blue-600" />
          ) : (
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          )}
        </div>

        {success.mode === 'kyb' ? (
          <>
            <h2 className="mt-5 text-xl font-black text-slate-900">
              {accepted ? 'Tu empresa quedó aceptada' : 'Recibimos tu registro'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {accepted
                ? 'La verificación automática pasó y la empresa quedó aceptada. Te enviamos al correo de contacto el enlace para elegir el plan y habilitar el panel de publicaciones.'
                : pendingBody}
            </p>

            {pending && success.questions.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Lo que falta aclarar
                </p>
                <ul className="mt-2 space-y-1.5">
                  {success.questions.map((question) => (
                    <li
                      key={question.id}
                      className="flex gap-2 text-xs leading-relaxed text-slate-600"
                    >
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span>{question.question}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                {KYB_STATUS_LABELS[success.status]}
              </span>
              <span className="text-[11px] text-slate-400">El enlace del correo vale 7 días.</span>
            </div>

            {success.emailSkipped && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Este entorno no tiene configurado el envío de correo, así que el aviso no
                salió. Guarda la referencia y escríbenos para continuar.
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="mt-5 text-xl font-black text-slate-900">{copy.successTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.successBody}</p>

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
          </>
        )}

        {success.id && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Referencia:{' '}
            <span className="font-mono font-semibold text-slate-700">{success.id}</span>
          </p>
        )}

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
              RUT
            </label>
            <input
              id="rut"
              type="text"
              value={form.rut}
              onChange={(event) => update('rut', event.target.value)}
              placeholder={copy.rutPlaceholder}
              className={inputClass}
              required
              minLength={8}
              maxLength={20}
              aria-describedby="rut-ayuda"
            />
            <p id="rut-ayuda" className="mt-1 text-[11px] text-slate-400">
              Obligatorio, con dígito verificador. Ej: {copy.rutPlaceholder}
            </p>
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

          <div className="sm:col-span-2">
            <fieldset>
              <legend className={labelClass}>Alcance geográfico</legend>
              <p className="mb-2 text-xs text-slate-500">
                ¿Dónde trabajas? Lo usamos para asignarte propiedades y consultas de tu zona.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {COVERAGE_OPTIONS.map((option) => {
                  const selected = form.coverage === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                        selected
                          ? 'border-blue-400 bg-blue-50/60'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="coverage"
                        value={option.value}
                        checked={selected}
                        onChange={() => update('coverage', option.value)}
                        className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-blue-600 focus:ring-blue-500"
                        required
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">
                          {option.title}
                        </span>
                        <span className="block text-[11px] leading-relaxed text-slate-500">
                          {option.detail}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {form.coverage === 'regional' && (
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
              <legend className="px-1 text-xs font-bold text-slate-700">
                Regiones donde trabajas
              </legend>
              <p className="text-xs text-slate-500">Marca todas las regiones que cubres.</p>
              <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {CHILE_REGIONS.map((region) => (
                  <label
                    key={region.code}
                    className="flex items-center gap-2 text-xs text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={form.regions.includes(region.name)}
                      onChange={(event) => toggleRegion(region.name, event.target.checked)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {region.name}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {form.regions.length === 0
                  ? 'Sin regiones seleccionadas'
                  : form.regions.length === 1
                    ? '1 región seleccionada'
                    : `${form.regions.length} regiones seleccionadas`}
              </p>
            </fieldset>
          )}
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
