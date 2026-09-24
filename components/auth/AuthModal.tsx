'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { X, Mail, AlertCircle, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import {
  describeAuthError,
  hasAuthError,
  parseAuthErrorFromUrl,
  stripAuthError,
} from '@/lib/utils/authMessages';
import {
  describeAnonKeyProblem,
  describeSupabaseUrlProblem,
  isSupabaseConfigured,
} from '@/lib/utils/supabaseEnv';

/**
 * Acceso al portal, con **dos puertas y ninguna contraseña**:
 *
 * 1. **Google**, en un clic. Google ya tiene el correo verificado, así que la
 *    cuenta queda lista sin pasar por la bandeja de entrada.
 * 2. **Enlace mágico** al correo, que sigue siendo el camino de siempre.
 *
 * Las consecuencias, que son la razón de haber elegido este modelo:
 *
 * - **No hay contraseña** que crear, recordar ni recuperar.
 * - **Registrarse y entrar son la misma acción**: desaparecen las pestañas de
 *   "Iniciar Sesión / Registrarse" y la pregunta "¿ya tienes cuenta?".
 * - Es un camino **natural para una Visita**, que no tiene por qué crear una
 *   cuenta para contactar a una corredora: eso ya lo hace dejando sus datos en
 *   la ficha. La cuenta sirve para lo demás (favoritos, alertas).
 *
 * Los dos caminos terminan en la misma cuenta si el correo coincide, así que
 * nadie queda con dos identidades por haber entrado de otra forma.
 *
 * El nombre y el móvil de WhatsApp **no se piden acá**: si la persona ya los
 * dejó en una ficha, `AuthProvider` los pasa a su cuenta sin preguntar.
 *
 * Google va primero porque es el camino más corto, pero el enlace del correo no
 * es un plan B: es la salida para quien no tiene cuenta de Google, no quiere
 * usarla para esto, o tiene un correo corporativo.
 */

/**
 * Espera mínima antes de poder reenviar el enlace.
 *
 * No es capricho: el proveedor de correo integrado de Supabase está limitado a
 * **2 correos por hora** y no es para producción. Un botón de reenvío libre se
 * agota en tres clics.
 */
const RESEND_COOLDOWN_S = 60;

/**
 * ¿Hay un proyecto real detrás del acceso?
 *
 * Sin esto, el botón de Google **navegaba igual** al dominio de ejemplo
 * (`placeholder-project.supabase.co`), que no existe: el navegador terminaba en
 * su página de error, sin explicación y sin forma de volver a algo útil. El
 * enlace al correo fallaba más discreto, con un "Failed to fetch".
 *
 * Los dos valores se leen acá porque Next los sustituye en el bundle al
 * compilar: no hay ninguna llamada de red para saberlo.
 */
const SUPABASE_CONFIGURED = isSupabaseConfigured(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Motivo técnico, para el desarrollador y solo mientras se desarrolla. */
const SUPABASE_PROBLEM =
  describeSupabaseUrlProblem(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
  describeAnonKeyProblem(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Lo que se le dice a la persona cuando el acceso no está disponible.
 *
 * No dice "error": el acceso no está roto para ella, simplemente todavía no
 * está encendido. Y le recuerda la salida que **sí** funciona hoy, que es
 * dejar sus datos en la ficha para que la corredora la contacte.
 */
const NOT_CONFIGURED_MESSAGE =
  'El acceso a la cuenta todavía no está disponible. Puedes contactar a la corredora desde la ficha sin crear una cuenta.';

/**
 * Logo de Google en SVG.
 *
 * Va embebido y no como imagen remota: un acceso que depende de que cargue un
 * archivo de otro dominio se ve roto justo cuando la red va mal, que es cuando
 * más se necesita entrar.
 */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.86c2.26-2.09 3.56-5.17 3.56-8.88Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.28v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

export function AuthModal() {
  const { isAuthModalOpen, authReason, authError, user, closeAuthModal, openAuthModal } =
    useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [supabase] = useState(() => createClient());

  // Distingue "se abrió estando afuera" de "se abrió ya adentro": el modal solo
  // debe cerrarse solo cuando entrar tuvo sentido.
  const openedSignedOut = useRef(false);

  // Cuenta atrás del reenvío.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Al cerrar, se vuelve al formulario limpio para la próxima vez.
  useEffect(() => {
    if (isAuthModalOpen) return;
    setSentTo(null);
    setErrorMsg(null);
    setCooldown(0);
    setGoogleLoading(false);
  }, [isAuthModalOpen]);

  // Al abrir estando afuera, queda pendiente cerrar cuando la sesión aparezca.
  useEffect(() => {
    if (isAuthModalOpen && !user) openedSignedOut.current = true;
  }, [isAuthModalOpen, user]);

  // Entrar cerró el modal por sí solo: antes quedaba abierto con el formulario
  // encima de la página, ya adentro, que es confuso.
  useEffect(() => {
    if (user && openedSignedOut.current) {
      openedSignedOut.current = false;
      closeAuthModal();
    }
  }, [user, closeAuthModal]);

  /**
   * Al volver de Google (o de un enlace vencido) Supabase deja el error en la
   * URL. Sin leerlo, el acceso fallido se ve como si no hubiera pasado nada: la
   * persona vuelve sin sesión y sin explicación.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const search = window.location.search;
    if (!hasAuthError(search)) return;

    const parsed = parseAuthErrorFromUrl(search);
    if (!parsed) return;

    // El mensaje va al contexto (no al estado local) porque al montarse el modal
    // limpia su formulario, y eso borraría un mensaje guardado acá. Con el error
    // en el contexto sobrevive a esa limpieza.
    openAuthModal(undefined, parsed.message);

    // Se limpia el error de la URL para que recargar no lo repita. El `code` y
    // el `state` no se tocan: son los que canjean la sesión cuando vuelve bien.
    const clean = stripAuthError(search);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${clean}${window.location.hash}`
    );
  }, [openAuthModal]);

  if (!isAuthModalOpen) return null;

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendLink = async (destination: string) => {
    if (!SUPABASE_CONFIGURED) {
      setErrorMsg(NOT_CONFIGURED_MESSAGE);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: destination,
        options: {
          // El enlace también crea la cuenta si no existe: es lo que permite
          // tener una sola puerta de entrada.
          shouldCreateUser: true,
          // Se vuelve a la misma página desde la que se pidió el enlace (una
          // ficha, un listado), no al inicio.
          emailRedirectTo:
            typeof window !== 'undefined'
              ? `${window.location.origin}${window.location.pathname}${window.location.search}`
              : undefined,
        },
      });

      if (error) throw error;

      setSentTo(destination);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      // "Failed to fetch" es lo que ve el navegador cuando no hay red o el
      // proyecto no responde: al usuario hay que decirle algo entendible.
      setErrorMsg(
        !raw || /fetch|network/i.test(raw)
          ? 'No pudimos conectar con el servicio de acceso. Revisa tu conexión e intenta de nuevo.'
          : raw
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) {
      setErrorMsg('Escribe un correo válido para enviarte el enlace.');
      return;
    }
    await sendLink(email.trim());
  };

  /**
   * Acceso con Google: un clic y vuelve ya adentro.
   *
   * Se vuelve a **la misma página** desde la que se pidió (una ficha, la lista
   * de favoritos) para no perder el contexto. Ojo: esa URL tiene que estar en
   * *Redirect URLs* del proyecto Supabase, igual que el enlace mágico.
   */
  const continueWithGoogle = async () => {
    // Antes de tocar nada: si no hay proyecto, la redirección terminaría en un
    // dominio que no existe. Mejor decirlo acá que en la página de error del
    // navegador, de la que no se puede volver.
    if (!SUPABASE_CONFIGURED) {
      setErrorMsg(NOT_CONFIGURED_MESSAGE);
      return;
    }

    setGoogleLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo:
            typeof window !== 'undefined'
              ? `${window.location.origin}${window.location.pathname}${window.location.search}`
              : undefined,
          // Permite elegir cuenta en vez de entrar directo con la que ya tenga
          // abierta: en un computador compartido eso evita entrar como el otro.
          queryParams: { prompt: 'select_account' },
        },
      });

      if (error) throw error;

      // Si no hubo error, el navegador ya está yendo a Google: se deja el estado
      // de carga puesto para que no se pueda apretar dos veces mientras sale.
      // Si la redirección no llega a ocurrir (red, bloqueo del navegador), hay
      // que devolverle el botón en vez de dejarlo con un spinner para siempre.
      window.setTimeout(() => {
        setGoogleLoading(false);
        setErrorMsg(
          'No pudimos abrir la pantalla de Google. Intenta de nuevo o entra con el enlace al correo.'
        );
      }, 10000);
    } catch (err) {
      setErrorMsg(describeAuthError(err));
      setGoogleLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100 transform transition-all scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeAuthModal}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
          aria-label="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Encabezado */}
        <div className="px-8 pt-8 pb-2 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 mb-3">
            <Mail className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">
            {sentTo ? 'Revisa tu correo' : 'Entrar a Rix7'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {sentTo
              ? 'Te enviamos un enlace de acceso.'
              : 'Sin contraseñas: entra con Google o con un enlace al correo.'}
          </p>
          {/* Motivo por el que se pidió entrar (guardar una búsqueda, por
              ejemplo): sin esto el formulario aparece sin explicación. */}
          {!sentTo && authReason && (
            <p className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-3">
              {authReason}
            </p>
          )}
        </div>

        <div className="p-8">
          {(errorMsg || authError) && (
            <div className="flex items-start gap-2 p-3 mb-4 text-sm text-red-700 bg-red-50 rounded-lg border border-red-100">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{errorMsg || authError}</span>
            </div>
          )}

          {/*
            Aviso permanente cuando no hay proyecto de Supabase conectado.
            Se muestra antes de que la persona intente nada: ofrecer un botón
            que no puede funcionar es peor que decir que todavía no está.
          */}
          {!SUPABASE_CONFIGURED && (
            <div className="flex items-start gap-2 p-3 mb-4 text-sm text-amber-800 bg-amber-50 rounded-lg border border-amber-200">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                {NOT_CONFIGURED_MESSAGE}
                {process.env.NODE_ENV !== 'production' && SUPABASE_PROBLEM && (
                  <span className="block mt-1 text-xs font-mono text-amber-700">
                    {SUPABASE_PROBLEM}
                  </span>
                )}
              </span>
            </div>
          )}

          {sentTo ? (
            /* ─── Enlace enviado ─── */
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 text-sm text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-100">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>
                  Abre el enlace que enviamos a <strong>{sentTo}</strong> desde este dispositivo
                  para entrar.
                </span>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Si no llega en unos minutos, revisa la carpeta de spam. El enlace vence, así que
                conviene usarlo pronto.
              </p>

              <button
                type="button"
                onClick={() => sendLink(sentTo)}
                disabled={loading || cooldown > 0}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {cooldown > 0 ? `Podrás reenviar en ${cooldown} s` : 'Reenviar el enlace'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setErrorMsg(null);
                }}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Usar otro correo
              </button>
            </div>
          ) : (
            /* ─── Elegir puerta ─── */
            <div className="space-y-4">
              {/* Google primero: es el camino más corto, un solo clic. */}
              <button
                type="button"
                onClick={continueWithGoogle}
                disabled={googleLoading || !SUPABASE_CONFIGURED}
                aria-label="Continuar con Google"
                title={!SUPABASE_CONFIGURED ? 'El acceso todavía no está disponible' : undefined}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-800 font-semibold rounded-xl transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {googleLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                ) : (
                  <GoogleLogo />
                )}
                <span>{googleLoading ? 'Conectando con Google…' : 'Continuar con Google'}</span>
              </button>

              {/* Separador: deja claro que hay dos caminos y no uno con opción */}
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  o
                </span>
                <span className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Enlace mágico: sigue igual que siempre, debajo de Google. */}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                    Correo Electrónico
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="tu@correo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !emailOk || !SUPABASE_CONFIGURED}
                  title={!SUPABASE_CONFIGURED ? 'El acceso todavía no está disponible' : undefined}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                  <span>Enviarme el enlace</span>
                </button>

                <p className="text-xs text-slate-500 text-center leading-relaxed">
                  Si todavía no tienes cuenta, se crea con este mismo enlace. Cualquiera de las dos
                  formas lleva a la misma cuenta.
                </p>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
