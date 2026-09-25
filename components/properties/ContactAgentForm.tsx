'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Phone, ShieldCheck, X } from 'lucide-react';
import { Property } from '@/lib/types/property';
import type { Partner } from '@/lib/data/partners';
import type { LeadChannel } from '@/lib/data/leads';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRegistration } from '@/components/auth/RegistrationProvider';

interface ContactAgentFormProps {
  property: Property;
  /**
   * Corredora ya resuelta por el servidor. Llega como prop y no se busca acá
   * porque los datos viven en Supabase, y resolverlos en el cliente obligaría a
   * un viaje extra y a mostrar el formulario sin ellos.
   */
  partner?: Partner;
}

/**
 * Canal de contacto. El dato (teléfono, móvil o correo) NO se muestra en el
 * botón: se revela en el popup al tocarlo, junto con la acción directa y un
 * botón para copiarlo.
 */
interface ContactChannel {
  id: 'call' | 'whatsapp' | 'mail';
  label: string;
  icon: React.ReactNode;
  /** Dato de la corredora que se revela en el popup. */
  value: string;
  /** Acción directa: `tel:`, `api.whatsapp.com` o `mailto:`. */
  href: string;
  title: string;
  hint: string;
  actionLabel: string;
  /** Colores del botón dentro de la fila de tres. */
  buttonClass: string;
  /** WhatsApp se abre en otra pestaña. */
  external?: boolean;
}

/**
 * Sección de contacto de una propiedad.
 *
 * - La cabecera muestra la corredora (socio estratégico) con su logo.
 * - El botón principal funciona como SEMÁFORO:
 *     · neutro mientras se verifica el registro,
 *     · rojo si el usuario no está identificado,
 *     · verde con el NOMBRE del usuario una vez identificado.
 * - La identidad NO se resuelve acá: viene de `RegistrationProvider`, que vive en
 *   el layout. Así el Navbar y el home reconocen exactamente al mismo usuario que
 *   habilita estos canales (antes el reconocimiento existía solo en esta ficha).
 * - Los botones de contacto (Llamar, WhatsApp, Mail) solo aparecen cuando el
 *   usuario está identificado, y se alimentan con los datos que aporta la
 *   corredora (`partner.contact`), con el detalle de la ficha como respaldo.
 *   El dato no se muestra en el botón: se revela en el popup, junto con la
 *   acción directa y un botón para copiarlo.
 */
export function ContactAgentForm({ property, partner }: ContactAgentFormProps) {
  const { openAuthModal } = useAuth();
  // La identidad vive en el layout: el mismo usuario que reconoce el Navbar es
  // el que habilita los canales de contacto de la ficha.
  const { registration, isChecking, save, updatePhone } = useRegistration();

  /** Borrador del formulario, solo para quien todavía no está identificado. */
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  /** Canal abierto en el popup (null = cerrado). */
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [supabaseUrl] = useState(() => process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const hasPortal = !!supabaseUrl && !supabaseUrl.includes('placeholder');

  // Referencias de los campos: el semáforo rojo lleva al que falta.
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Identidad vigente: la del provider si la hay, y si no el borrador del
  // formulario. Un solo origen de verdad para los mensajes y los inputs.
  const name = registration?.name ?? draftName;
  const email = registration?.email ?? draftEmail;
  const phone = registration?.phone ?? draftPhone;

  const partnerName = partner?.name || (property.partner_id || '').slice(0, 1).toUpperCase() + ' / Portal Rix7';
  const partnerLogo = partner?.logo || null;

  // Datos de contacto que aporta la corredora; el detalle de la ficha queda
  // como respaldo para propiedades antiguas sin `partner.contact`.
  const contactPhone = partner?.contact?.phone || property.agent_phone || '';
  const contactWhatsApp = partner?.contact?.whatsapp || property.agent_phone || '';
  const contactEmail = partner?.contact?.email || property.agent_email || '';

  const contactPhoneClean = contactPhone.replace(/\D/g, '');
  const contactWhatsAppClean = contactWhatsApp.replace(/\D/g, '');

  const phoneClean = phone.replace(/\D/g, '');
  const fieldsComplete =
    name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    phoneClean.length >= 9;

  const waText = encodeURIComponent(
    `Hola, soy ${name}. Me interesa más información sobre "${property.title}" (Ref: ${property.id.slice(0, 12)}).`
  );

  const prepareMailto = (): string => {
    const subject = encodeURIComponent(`Información propiedad: ${property.title} (Ref: ${property.id.slice(0, 12)})`);
    const body = encodeURIComponent(
      `Hola ${partnerName},\n\n` +
        `Soy ${name}.\n` +
        (phone ? `Teléfono: ${phone}\n` : '') +
        `Me interesa más información sobre la propiedad "${property.title}" (Ref: ${property.id.slice(0, 12)}).\n\nAtentamente,\n${name}`
    );
    return `mailto:${contactEmail}?subject=${subject}&body=${body}`;
  };

  /**
   * Lleva el foco al primer dato que falta.
   *
   * El semáforo rojo dice qué pasa; esto lleva a donde hay que arreglarlo, en
   * lugar de dejar un botón que no responde porque está deshabilitado.
   */
  const focusFirstIncompleteField = () => {
    if (!name.trim()) nameRef.current?.focus();
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) emailRef.current?.focus();
    else phoneRef.current?.focus();
  };

  /**
   * El teléfono se puede completar después: un usuario que llega ya logueado
   * tiene nombre y correo, pero no necesariamente dejó su teléfono en el portal.
   */
  const handlePhoneChange = (value: string) => {
    if (registration) updatePhone(value);
    else setDraftPhone(value);
  };

  // Cerrar el popup con Escape (además del botón y del clic en el fondo).
  useEffect(() => {
    if (!channel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChannel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channel]);

  /**
   * Los tres canales con los datos que aporta la corredora. Se construyen acá y
   * no en el JSX para que el botón y el popup compartan exactamente el mismo dato.
   */
  const channels: ContactChannel[] = [
    {
      id: 'call',
      label: 'Llamar',
      icon: <Phone className="w-3.5 h-3.5" />,
      value: contactPhone,
      href: contactPhoneClean ? `tel:${contactPhoneClean}` : '',
      title: `Llamar a ${partnerName}`,
      hint: 'Marca este número desde tu teléfono.',
      actionLabel: 'Marcar ahora',
      buttonClass: contactPhoneClean
        ? 'bg-slate-900 text-white hover:bg-slate-800'
        : 'bg-slate-100 text-slate-400 cursor-not-allowed',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ),
      value: contactWhatsApp,
      href: contactWhatsAppClean
        ? `https://api.whatsapp.com/send?phone=${contactWhatsAppClean}&text=${waText}`
        : '',
      title: `Escribir por WhatsApp a ${partnerName}`,
      hint: 'Se abre WhatsApp con el mensaje listo para enviar.',
      actionLabel: 'Abrir WhatsApp',
      external: true,
      buttonClass: contactWhatsAppClean
        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
        : 'bg-slate-100 text-slate-400 cursor-not-allowed',
    },
    {
      id: 'mail',
      label: 'Mail',
      icon: <Mail className="w-3.5 h-3.5" />,
      value: contactEmail,
      href: contactEmail ? prepareMailto() : '',
      title: `Enviar correo a ${partnerName}`,
      hint: 'Se abre tu correo con el mensaje redactado.',
      actionLabel: 'Escribir correo',
      buttonClass: contactEmail
        ? 'bg-blue-600 text-white hover:bg-blue-700'
        : 'bg-slate-100 text-slate-400 cursor-not-allowed',
    },
  ];

  /**
   * Contactos ya registrados en esta sesión, para no repetir el mismo canal de
   * la misma ficha (abrir el popup y usar la acción son el mismo interés).
   */
  const recordedLeads = useRef<Set<string>>(new Set());

  /**
   * Registra el contacto para que el equipo pueda consultarlo y hacerle
   * seguimiento. Antes, al abrir WhatsApp, el dato se perdía.
   *
   * Es "dispara y olvida" a propósito: la acción del usuario (llamar, abrir
   * WhatsApp) no espera ni falla porque el registro interno no llegue.
   */
  const recordLead = useCallback(
    (channel: LeadChannel, who?: { name: string; email: string; phone: string }) => {
      const data = who ?? { name, email, phone };
      if (!data.name.trim() || !data.email.trim() || !data.phone.trim()) return;

      const key = `${property.id}:${channel}`;
      if (recordedLeads.current.has(key)) return;
      recordedLeads.current.add(key);

      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          partner_id: partner?.id ?? property.partner_id ?? null,
          name: data.name.trim(),
          email: data.email.trim(),
          phone: data.phone,
          channel,
        }),
      }).catch(() => {
        // Si el registro interno falla, el contacto del usuario ya se disparó.
      });
    },
    [property.id, property.partner_id, partner?.id, name, email, phone]
  );

  /** Copia el dato del canal. Si el portapapeles falla, el dato queda visible y seleccionable. */
  const copyContactData = async (value: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Portapapeles moderno bloqueado (p. ej. documento sin foco o contexto
      // no seguro): intento clásico con un textarea temporal.
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
    }
    // Si ambos fallan, el dato ya está visible y seleccionable en el mensaje.
  };

  /**
   * Estado visual del semáforo.
   *
   * El rojo va **siempre sólido**, aunque falten datos: este botón comunica un
   * estado (falta completar), y atenuarlo cuando falta justamente lo que anuncia
   * decía lo contrario — parecía deshabilitado en vez de "te falta esto". Por eso
   * tampoco se deshabilita: si falta algo, al tocarlo lleva al primer campo
   * vacío, que es lo que la persona necesita hacer a continuación.
   */
  const semaphore = isChecking
    ? {
        text: 'Verificando tu registro…',
        className: 'bg-slate-200 text-slate-500 cursor-wait',
        disabled: true,
      }
    : registration
      ? {
          // Verde + nombre del usuario: el color ya comunica el estado.
          text: registration.name,
          className: 'bg-emerald-600 text-white shadow-emerald-500/20',
          disabled: false,
        }
      : {
          // Texto corto a propósito: el anterior ("Completa tus datos para
          // contactar a un Agente") forzaba dos líneas en la columna angosta y
          // el corte caía a mitad de frase. La instrucción de completar los
          // campos vive en el aviso de debajo, no en el botón.
          text: fieldsComplete ? 'Enviar' : 'Contacta a un Agente',
          className: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-500/25',
          disabled: false,
        };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm sticky top-24">
      {/* Sección de la corredora / socio estratégico */}
      <div className="flex items-center gap-3.5 pb-5 border-b border-slate-100">
        {/* Logo de socio estratégico */}
        {partnerLogo ? (
          <div className="shrink-0">
            <img
              src={partnerLogo}
              alt={partnerName}
              className="h-12 max-w-[140px] object-contain drop-shadow-sm"
              onError={(e) => {
                // Si la imagen del logo no carga, mostramos un placeholder
                // con la inicial del partner para que no se rompa la sección.
                const parent = (e.target as HTMLImageElement).parentElement;
                if (parent) parent.innerHTML = '';
              }}
            />
          </div>
        ) : (
          <div className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 text-xs font-bold uppercase tracking-wider">
            {property.partner_id?.[0]?.toUpperCase() || 'R'}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-slate-900 text-sm truncate">{partnerName}</h4>
        </div>

        {/* Badge verificado */}
        <div className="shrink-0 relative">
          <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Formulario obligatorio: nombre + correo + teléfono */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!fieldsComplete || registration) return;
          save({ name: name.trim(), email: email.trim(), phone });
          // El contacto queda registrado con los mismos datos que se guardan.
          recordLead('form', { name: name.trim(), email: email.trim(), phone });
        }}
        className="space-y-3 pt-5"
        noValidate
      >
        {/* Semáforo de inscripción: neutro al verificar, rojo si falta el registro, verde con el nombre */}
        <button
          type={registration ? 'button' : 'submit'}
          disabled={semaphore.disabled}
          onClick={() => {
            // Con datos incompletos el botón no envía: lleva al campo que falta.
            if (!registration && !fieldsComplete) focusFirstIncompleteField();
          }}
          title={
            registration
              ? 'Registro completado'
              : fieldsComplete
                ? 'Enviar tus datos'
                : 'Falta completar tus datos'
          }
          className={`w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${semaphore.className}`}
        >
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          {/* En la columna angosta de la ficha y de la landing el texto no cabe
              en una línea: se recorta con puntos suspensivos y la persona no
              llega a leer qué le falta. Se prefiere que ocupe dos líneas. */}
          <span className="text-center leading-tight">{semaphore.text}</span>
        </button>

        {registration && (
          <p className="text-[10px] text-emerald-700 text-center">
            {registration.source === 'portal'
              ? 'Registro completado · cuenta del portal verificada'
              : 'Registro completado · identificado en este dispositivo'}
          </p>
        )}

        <div className="relative">
          <input
            ref={nameRef}
            type="text"
            required
            value={name}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Tu nombre completo"
            readOnly={!!registration}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        <div className="relative">
          <input
            ref={emailRef}
            type="email"
            required
            value={email}
            onChange={(e) => setDraftEmail(e.target.value)}
            placeholder="Tu correo electrónico"
            readOnly={!!registration}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        <div className="relative">
          <input
            ref={phoneRef}
            type="tel"
            required
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="Tu teléfono"
            inputMode="numeric"
            // Editable si aún no hay teléfono: un usuario ya logueado en el
            // portal puede no haberlo dejado nunca.
            readOnly={!!registration && !!registration.phone}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        {!registration && !isChecking && (
          <p className="text-[10px] text-slate-400 text-center">
            Completa tus datos para poder contactar.{' '}
            {hasPortal && (
              <button
                type="button"
                onClick={() => openAuthModal()}
                className="font-semibold text-blue-600 hover:underline"
              >
                ¿Ya tienes cuenta? Inicia sesión
              </button>
            )}
          </p>
        )}

        {/* Botones de contacto: se habilitan cuando el usuario está identificado
            (sesión del portal o registro local) y usan los datos de la corredora.
            El dato NO se muestra acá: al tocar un canal se abre el popup. */}
        {registration && (
          <div className="grid grid-cols-3 gap-2 mb-1">
            {channels.map((c) => (
              <a
                key={c.id}
                href={c.href || '#'}
                target={c.external ? '_blank' : undefined}
                rel={c.external ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  if (!c.href) {
                    e.preventDefault();
                    return;
                  }
                  // Se dispara la acción directa (marcar/abrir WhatsApp/escribir)
                  // y en paralelo se abre el popup con el dato, por si el
                  // dispositivo no tiene con qué abrir ese canal.
                  recordLead(c.id);
                  setChannel(c);
                }}
                className={`flex items-center justify-center gap-1.5 py-3 text-xs font-semibold rounded-xl transition-colors ${c.buttonClass}`}
                aria-disabled={!c.href}
                aria-haspopup="dialog"
              >
                {c.icon}
                {c.label}
              </a>
            ))}
          </div>
        )}

        {loadingMsg && (
          <p className="text-[10px] text-slate-500 text-center">{loadingMsg}</p>
        )}
      </form>

      <p className="text-[10px] text-slate-400 text-center leading-tight mt-3">
        La información se comparte con {partnerName} y queda registrada en Rix7 para su
        seguimiento.
      </p>

      {/* ─── Popup del canal ───
          Muestra el dato de la corredora (teléfono / móvil / correo) sin
          ocupar espacio en los botones, y deja la acción directa a un clic. */}
      {channel && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-channel-title"
          onClick={() => setChannel(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div className="min-w-0">
                <h5 id="contact-channel-title" className="text-sm font-bold text-slate-900">
                  {channel.title}
                </h5>
                <p className="text-[11px] text-slate-500 mt-0.5">{channel.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => setChannel(null)}
                aria-label="Cerrar"
                className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <span className="flex-1 text-sm font-semibold text-slate-900 select-all break-all">
                  {channel.value}
                </span>
                <button
                  type="button"
                  onClick={() => copyContactData(channel.value)}
                  className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  {copiedValue === channel.value ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <a
                href={channel.href}
                target={channel.external ? '_blank' : undefined}
                rel={channel.external ? 'noopener noreferrer' : undefined}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                {channel.icon}
                {channel.actionLabel}
              </a>
              <button
                type="button"
                onClick={() => setChannel(null)}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
