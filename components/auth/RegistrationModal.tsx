'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BROWSER_PERMISSIONS,
  CONSENTS,
  EMPTY_CONSENTS,
  missingRequiredConsents,
  type BrowserPermissionId,
  type ConsentId,
  type ConsentState,
} from '@/lib/utils/consents';
import { useRegistration } from '@/components/auth/RegistrationProvider';
import {
  AlertCircle,
  BellRing,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';

/**
 * Registro de una visita: nombre, correo y teléfono, más las autorizaciones.
 *
 * Es una **pantalla emergente** y no un formulario embebido porque lo que hay
 * que leer no cabe en una ficha: cuatro bloques de texto legal, dos de ellos
 * obligatorios, más los permisos del navegador. En una columna angosta eso se
 * convierte en un muro de texto que nadie lee, y una autorización que nadie lee
 * no autoriza nada.
 *
 * Tres decisiones que no son de estilo:
 *
 * 1. **Las dos autorizaciones obligatorias (datos personales y términos) van
 *    separadas** de las dos opcionales, con el rótulo a la vista. Aceptar los
 *    términos no es aceptar publicidad.
 * 2. **Nada viene premarcado.** Marketing y cesión a terceros llegan vacíos: una
 *    casilla ya marcada no es consentimiento.
 * 3. **Los permisos del navegador no son casillas.** El navegador solo concede
 *    ubicación y notificaciones con una acción explícita de la persona, así que
 *    se ofrecen como botones con su estado real —concedido, denegado, sin
 *    responder— en vez de un check que no puede cumplir esa promesa.
 *
 * Al guardar, la identidad queda en este dispositivo (`RegistrationProvider`):
 * el formulario «Contacta a un Agente» de cualquier ficha la lee de ahí y ya no
 * vuelve a pedir los datos.
 */

type Step = 'form' | 'done';
type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Estado de una casilla del formulario, indexado por la autorización. */
type CheckState = Record<ConsentId, boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nombre legible del permiso para los mensajes de estado. */
const PERMISSION_LABEL: Record<BrowserPermissionId, string> = {
  location: 'la ubicación',
  notifications: 'las notificaciones',
};

const PERMISSION_ICON: Record<BrowserPermissionId, React.ReactNode> = {
  location: <MapPin className="w-4 h-4" />,
  notifications: <BellRing className="w-4 h-4" />,
};

const PERMISSION_HELP: Record<Exclude<PermissionState, 'unsupported'>, string> = {
  unknown: '',
  granted: 'Concedido',
  denied: 'Bloqueado en el navegador',
  prompt: 'Sin responder todavía',
};

export function RegistrationModal() {
  const { isSignupOpen, closeSignup, save } = useRegistration();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [checks, setChecks] = useState<CheckState>({ ...EMPTY_CONSENTS });
  const [step, setStep] = useState<Step>('form');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  // El alta se guarda en el dispositivo igual; esto es sobre la **constancia**
  // de las autorizaciones, que es cosa del servidor. Si no se pudo dejar, se dice.
  const [storedFailed, setStoredFailed] = useState(false);

  const [permissions, setPermissions] = useState<Record<BrowserPermissionId, PermissionState>>({
    location: 'unknown',
    notifications: 'unknown',
  });
  const [permissionBusy, setPermissionBusy] = useState<BrowserPermissionId | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  const consents = useMemo<ConsentState>(() => ({ ...checks }), [checks]);
  const nameOk = name.trim().length > 1;
  const emailOk = EMAIL_RE.test(email.trim());
  const phoneOk = phone.replace(/\D/g, '').length >= 9;
  const requiredOk = missingRequiredConsents(consents).length === 0;
  const canSubmit = nameOk && emailOk && phoneOk && requiredOk;

  // Al cerrar se vuelve al formulario limpio para la próxima vez, salvo el
  // nombre y el correo: si la persona ya los escribió, no se los borramos.
  useEffect(() => {
    if (isSignupOpen) return;
    setStep('form');
    setSending(false);
    setErrorMsg(null);
    setEmailSent(false);
    setStoredFailed(false);
  }, [isSignupOpen]);

  // Escape cierra, y el foco arranca en el primer campo (no en el encabezado).
  useEffect(() => {
    if (!isSignupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSignup();
    };
    window.addEventListener('keydown', onKey);
    const focusTimer = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(focusTimer);
    };
  }, [isSignupOpen, closeSignup]);

  // Estado real de los permisos al abrir: si ya están concedidos o bloqueados,
  // el botón lo dice en vez de volver a pedirlos.
  useEffect(() => {
    if (!isSignupOpen || typeof navigator === 'undefined') return;

    let alive = true;

    const readState = async (id: BrowserPermissionId): Promise<PermissionState> => {
      if (id === 'notifications' && typeof Notification === 'undefined') return 'unsupported';
      if (!('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') {
        return 'prompt';
      }
      try {
        const status = await navigator.permissions.query({ name: id as PermissionName });
        return status.state as PermissionState;
      } catch {
        // Safari no expone todos los permisos por la API: queda como "sin responder".
        return 'prompt';
      }
    };

    void (async () => {
      const [location, notifications] = await Promise.all([
        readState('location'),
        readState('notifications'),
      ]);
      if (alive) setPermissions({ location, notifications });
    })();

    return () => {
      alive = false;
    };
  }, [isSignupOpen]);

  if (!isSignupOpen) return null;

  const setPermission = (id: BrowserPermissionId, state: PermissionState) => {
    setPermissions((prev) => ({ ...prev, [id]: state }));
  };

  /**
   * Pide el permiso de ubicación. El resultado se lee del propio navegador
   * —`getCurrentPosition` falla con `PERMISSION_DENIED`— porque es la única
   * señal fiable en todos los navegadores.
   */
  const requestLocation = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermission('location', 'unsupported');
      return;
    }
    setPermissionBusy('location');
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermission('location', 'granted');
        setPermissionBusy(null);
      },
      (err) => {
        setPermission('location', err.code === err.PERMISSION_DENIED ? 'denied' : 'prompt');
        setPermissionBusy(null);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setPermission('notifications', 'unsupported');
      return;
    }
    setPermissionBusy('notifications');
    try {
      const result = await Notification.requestPermission();
      setPermission('notifications', result === 'default' ? 'prompt' : result);
    } catch {
      setPermission('notifications', 'prompt');
    }
    setPermissionBusy(null);
  };

  const requestPermission = (id: BrowserPermissionId) => {
    if (id === 'location') requestLocation();
    else void requestNotifications();
  };

  /**
   * Guarda la identidad en el dispositivo y avisa al servidor para que salga el
   * correo de bienvenida. El registro local **no se espera** a la red: si el
   * endpoint falla, la persona ya quedó identificada y el formulario de contacto
   * funciona igual. Solo se pierde el correo, y se dice.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!nameOk) {
      setErrorMsg('Escribe tu nombre para continuar.');
      nameRef.current?.focus();
      return;
    }
    if (!emailOk) {
      setErrorMsg('Revisa tu correo: no tiene un formato válido.');
      return;
    }
    if (!phoneOk) {
      setErrorMsg('Revisa tu teléfono: debe tener al menos 9 dígitos.');
      return;
    }
    const missing = missingRequiredConsents(consents);
    if (missing.length > 0) {
      setErrorMsg(`Falta autorizar: ${missing.map((c) => c.title.toLowerCase()).join(' y ')}.`);
      return;
    }

    setSending(true);
    save({ name: name.trim(), email: email.trim(), phone });

    try {
      const response = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone,
          consents,
        }),
      });
      const result = await response.json().catch(() => null);
      setEmailSent(Boolean(result?.success && result?.email?.sent));
      setStoredFailed(result?.stored?.saved !== true);
    } catch {
      // Sin red la identidad ya quedó guardada: la bienvenida se pierde y las
      // autorizaciones no llegaron al servidor. Las dos cosas se dicen.
      setEmailSent(false);
      setStoredFailed(true);
    } finally {
      setSending(false);
      setStep('done');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSignup();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="registro-titulo"
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 my-4 sm:my-0 max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Cabecera de marca */}
        <div className="shrink-0 bg-slate-900 px-6 py-5 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 id="registro-titulo" className="text-lg font-black text-white">
              {step === 'done' ? '¡Listo, ya eres parte de Rix7!' : 'Regístrate en Rix7'}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              {step === 'done'
                ? 'Guarda tus búsquedas, marca favoritos y contacta corredoras sin repetir tus datos.'
                : 'Gratis, sin contraseñas. Solo tus datos de contacto y las autorizaciones de siempre.'}
            </p>
          </div>
          <button
            type="button"
            onClick={closeSignup}
            className="ml-auto shrink-0 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            aria-label="Cerrar el registro"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'done' ? (
            /* ─── Registro completado ─── */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-800">
                  <p className="font-semibold">Te reconoceremos en todo el portal.</p>
                  <p className="mt-1 text-emerald-700">
                    {emailSent ? (
                      <>
                        Te enviamos un correo de bienvenida a <strong>{email.trim()}</strong>. Si
                        no lo ves en unos minutos, revisa la carpeta de spam.
                      </>
                    ) : (
                      <>
                        Guardamos tu registro en este dispositivo. Cuando el envío de correos
                        esté activo te llegará la bienvenida a <strong>{email.trim()}</strong>.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {storedFailed ? (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold">
                      No pudimos dejar constancia de tus autorizaciones
                    </p>
                    <p className="mt-1 text-amber-700">
                      Tus datos quedaron guardados en este dispositivo y te reconoceremos igual en
                      todo el portal, pero lo que autorizaste no llegó a nuestro registro. Si
                      quieres que quede registrado, vuelve a enviar el formulario en un momento.
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900">
                <p className="font-semibold">Ya no tendrás que volver a escribir tus datos</p>
                <p className="mt-1 text-blue-800">
                  Cuando contactes a una corredora desde cualquier ficha, tu nombre, correo y
                  teléfono irán puestos. Tú solo eliges si llamar, escribir por WhatsApp o enviar
                  un correo.
                </p>
              </div>

              {permissions.location === 'prompt' || permissions.notifications === 'prompt' ? (
                <p className="text-xs text-slate-500">
                  Si no activaste todos los permisos, puedes hacerlo cuando los necesites: el
                  navegador volverá a preguntarte.
                </p>
              ) : null}

              <button
                type="button"
                onClick={closeSignup}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md shadow-blue-500/20 transition-all"
              >
                Ver propiedades
              </button>
            </div>
          ) : (
            /* ─── Formulario ─── */
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {/* 1. Datos de contacto */}
              <fieldset className="space-y-3">
                <legend className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  <UserRound className="w-3.5 h-3.5" />
                  Tus datos
                </legend>

                <div>
                  <label htmlFor="registro-nombre" className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre y apellido
                  </label>
                  <input
                    id="registro-nombre"
                    ref={nameRef}
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="María José Rojas"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="registro-email" className="block text-xs font-semibold text-slate-700 mb-1">
                      Correo electrónico
                    </label>
                    <input
                      id="registro-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.cl"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label htmlFor="registro-telefono" className="block text-xs font-semibold text-slate-700 mb-1">
                      Teléfono
                    </label>
                    <input
                      id="registro-telefono"
                      type="tel"
                      required
                      inputMode="numeric"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+56 9 1234 5678"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Los usamos para identificarte en el portal y para que la corredora pueda
                  contactarte. No vuelves a escribirlos en cada propiedad.
                </p>
              </fieldset>

              {/* 2. Autorizaciones */}
              <fieldset className="space-y-3">
                <legend className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Autorizaciones
                </legend>

                {CONSENTS.map((consent) => (
                  <label
                    key={consent.id}
                    htmlFor={`registro-consent-${consent.id}`}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      checks[consent.id]
                        ? 'border-blue-300 bg-blue-50/60'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <input
                      id={`registro-consent-${consent.id}`}
                      type="checkbox"
                      checked={checks[consent.id]}
                      onChange={(e) =>
                        setChecks((prev) => ({ ...prev, [consent.id]: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{consent.title}</span>
                        <span
                          className={`text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                            consent.required
                              ? 'bg-red-50 text-red-600 border border-red-100'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {consent.required ? 'Obligatoria' : 'Opcional'}
                        </span>
                      </span>
                      <span className="block text-xs text-slate-600 leading-relaxed mt-1.5">
                        {consent.description}{' '}
                        {consent.link ? (
                          <Link
                            href={consent.link.href}
                            target="_blank"
                            className="font-semibold text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {consent.link.label}
                          </Link>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {/* 3. Permisos del navegador */}
              <fieldset className="space-y-3">
                <legend className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  <BellRing className="w-3.5 h-3.5" />
                  Permisos del navegador
                </legend>
                <p className="text-[11px] text-slate-500 -mt-1">
                  Son opcionales y los concede el navegador, no nosotros. Puedes activarlos ahora
                  o cuando los necesites.
                </p>

                {BROWSER_PERMISSIONS.map((permission) => {
                  const state = permissions[permission.id];
                  const granted = state === 'granted';
                  const denied = state === 'denied' || state === 'unsupported';

                  return (
                    <div
                      key={permission.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white"
                    >
                      <span
                        className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          granted ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {granted ? <Check className="w-4 h-4" /> : PERMISSION_ICON[permission.id]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {permission.title}
                          </span>
                          {state !== 'unknown' && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                granted
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : denied
                                    ? 'bg-slate-100 text-slate-500'
                                    : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {state === 'unsupported'
                                ? 'No disponible en este navegador'
                                : PERMISSION_HELP[state]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed mt-1.5">
                          {permission.description}
                        </p>
                        {!granted && (
                          <button
                            type="button"
                            onClick={() => requestPermission(permission.id)}
                            disabled={permissionBusy === permission.id || state === 'unsupported'}
                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {permissionBusy === permission.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              PERMISSION_ICON[permission.id]
                            )}
                            {state === 'denied'
                              ? `Volver a pedir ${PERMISSION_LABEL[permission.id]}`
                              : permission.actionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </fieldset>

              {(errorMsg) && (
                <div className="flex items-start gap-2 p-3 text-sm text-red-700 bg-red-50 rounded-lg border border-red-100">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="space-y-3 pt-1">
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md shadow-blue-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{sending ? 'Creando tu registro…' : 'Crear mi registro'}</span>
                </button>

                <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                  Las casillas marcadas como obligatorias son necesarias para crear el registro.
                  Las opcionales puedes cambiarlas cuando quieras desde tus datos.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
