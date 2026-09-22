'use client';

import React, { useEffect, useState } from 'react';
import { Mail, Phone, ShieldCheck } from 'lucide-react';
import { Property } from '@/lib/types/property';
import { getPartnerById } from '@/lib/data/partners';

interface ContactAgentFormProps {
  property: Property;
}

/** Clave de localStorage para persistir la inscripción (semáforo en verde). */
const REGISTRATION_KEY = 'rix7_contact_registration';

/**
 * Sección de contacto de una propiedad.
 *
 * - La cabecera muestra la corredora (socio estratégico) con su logo.
 * - El botón principal funciona como SEMÁFORO: rojo mientras el usuario
 *   no esté inscrito y verde ("Registro completado") una vez que envía su
 *   registro (nombre + correo + teléfono). La inscripción se persiste en
 *   localStorage para que el semáforo quede en verde al volver a entrar.
 * - Los botones de contacto (Llamar, WhatsApp, Mail) aparecen solo después
 *   de la inscripción y muestran los datos registrados por la corredora
 *   (teléfono/correo del agente en la ficha). Al tocarlos, además de intentar
 *   abrir el canal, aparece un mensaje de respaldo con el número/correo crudo
 *   (copiable) por si el dispositivo no puede conectarse desde la web.
 */
export function ContactAgentForm({ property }: ContactAgentFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  /** Semáforo: null = no inscrito (rojo), objeto = inscrito (verde). */
  const [registered, setRegistered] = useState<{ name: string; email: string; phone: string } | null>(null);
  /** Mensaje de respaldo de un canal (número/correo visible y copiable). */
  const [fallback, setFallback] = useState<{ hint: string; value: string } | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  // Al montar, restaura una inscripción previa: el semáforo queda en verde.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REGISTRATION_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.name && data?.email && data?.phone) {
        setRegistered(data);
        setName(data.name);
        setEmail(data.email);
        setPhone(data.phone);
      }
    } catch {
      // Sin almacenamiento disponible: la inscripción dura solo esta sesión.
    }
  }, []);

  const partner = property.partner_id ? getPartnerById(property.partner_id) : undefined;
  const partnerName = partner?.name || (property.partner_id || '').slice(0, 1).toUpperCase() + ' / Portal Rix7';
  const partnerLogo = partner?.logo || null;

  const agentPhoneClean = (property.agent_phone || '').replace(/\D/g, '');
  const agentPhoneDisplay = property.agent_phone || '';
  const agentEmail = property.agent_email || 'contacto@' + (partner?.slug || 'rix7') + '.cl';

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
        `Teléfono: ${phone}\n` +
        `Me interesa más información sobre la propiedad "${property.title}" (Ref: ${property.id.slice(0, 12)}).\n\nAtentamente,\n${name}`
    );
    return `mailto:${agentEmail}?subject=${subject}&body=${body}`;
  };

  // Al tocar un canal se intenta abrir la app correspondiente (el href del ancla
  // hace su trabajo); en paralelo aparece un mensaje con el dato crudo por si el
  // dispositivo del usuario no puede conectarse a WhatsApp/correo/llamada desde la web.
  const showFallback = (hint: string, value: string) => {
    if (value) setFallback({ hint, value });
  };

  const copyFallback = async (value: string) => {
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
          if (!fieldsComplete || registered) return;
          const data = { name: name.trim(), email: email.trim(), phone };
          try {
            localStorage.setItem(REGISTRATION_KEY, JSON.stringify(data));
          } catch {
            // Sin almacenamiento: la inscripción dura solo esta sesión.
          }
          setRegistered(data);
        }}
        className="space-y-3 pt-5"
        noValidate
      >
        {/* Semáforo de inscripción: rojo hasta inscribirse, verde al estar inscrito */}
        <button
          type={registered ? 'button' : 'submit'}
          disabled={!registered && !fieldsComplete}
          className={`w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            registered
              ? 'bg-emerald-600 text-white shadow-emerald-500/20'
              : 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
          }`}
        >
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          {registered
            ? 'Registro completado'
            : fieldsComplete
              ? 'Enviar'
              : 'Completa tus datos para contactar a un Agente'}
        </button>

        <div className="relative">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre completo"
            readOnly={!!registered}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        <div className="relative">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Tu correo electrónico"
            readOnly={!!registered}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        <div className="relative">
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Tu teléfono"
            inputMode="numeric"
            readOnly={!!registered}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
          />
        </div>

        {!registered && (
          <p className="text-[10px] text-slate-400 text-center">
            Completa tus datos para poder contactar.
          </p>
        )}

        {/* Botones de contacto: solo aparecen cuando completó nombre + correo + teléfono,
            y en ese momento muestran los datos registrados por la corredora
            (teléfono y correo del agente en la ficha). */}
        {registered && (
          <>
          <div className="grid grid-cols-3 gap-2 mb-4 pb-3">
            <a
              href={agentPhoneClean ? `tel:${agentPhoneClean}` : '#'}
              onClick={(e) => {
                if (!agentPhoneClean) {
                  e.preventDefault();
                  return;
                }
                // Respaldo por si el dispositivo no puede abrir la app de llamadas
                showFallback('¿No se abrió la app de llamadas? Marca desde tu teléfono:', agentPhoneDisplay);
              }}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-semibold rounded-xl transition-colors ${
                agentPhoneClean
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
              aria-disabled={!agentPhoneClean}
            >
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                Llamar
              </span>
              {agentPhoneDisplay && (
                <span className="text-[10px] font-normal opacity-80">{agentPhoneDisplay}</span>
              )}
            </a>
            <a
              href={
                agentPhoneClean
                  ? `https://api.whatsapp.com/send?phone=${agentPhoneClean}&text=${waText}`
                  : '#'
              }
              onClick={() =>
                // Respaldo por si no puede abrir WhatsApp desde la web
                showFallback('¿No se abrió WhatsApp? También puedes escribirnos directo:', agentPhoneDisplay)
              }
              target="_blank"
              rel="noopener noreferrer"
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-semibold rounded-xl transition-colors ${
                agentPhoneClean
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
              aria-disabled={!agentPhoneClean}
            >
              <span className="flex items-center gap-1.5">
                {/* SVG de WhatsApp */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                WhatsApp
              </span>
              {agentPhoneDisplay && (
                <span className="text-[10px] font-normal opacity-80">{agentPhoneDisplay}</span>
              )}
            </a>
            <a
              href={fieldsComplete ? prepareMailto() : '#'}
              onClick={() =>
                // Respaldo por si el dispositivo no tiene app de correo configurada
                showFallback('¿No se abrió tu app de correo? Envía un mensaje a:', agentEmail)
              }
              className="flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                Mail
              </span>
              <span className="text-[10px] font-normal opacity-80 truncate max-w-full px-1">
                {agentEmail}
              </span>
            </a>
          </div>

          {/* Mensaje de respaldo: el dato crudo (número/correo) aparece como mensaje
              por si el dispositivo no puede abrir WhatsApp, la llamada o el correo
              desde nuestra web. Seleccionable + botón de copiar. */}
          {fallback && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-slate-600"
            >
              <span className="flex-1 leading-relaxed">
                {fallback.hint}{' '}
                <span className="font-semibold text-slate-900 select-all">{fallback.value}</span>
              </span>
              <button
                type="button"
                onClick={() => copyFallback(fallback.value)}
                className="shrink-0 font-semibold text-blue-600 hover:text-blue-700"
              >
                {copiedValue === fallback.value ? '¡Copiado!' : 'Copiar'}
              </button>
              <button
                type="button"
                onClick={() => setFallback(null)}
                aria-label="Cerrar mensaje"
                className="shrink-0 text-slate-400 hover:text-slate-700 leading-none"
              >
                ×
              </button>
            </div>
          )}
          </>
        )}

        {loadingMsg && (
          <p className="text-[10px] text-slate-500 text-center">{loadingMsg}</p>
        )}
      </form>

      <p className="text-[10px] text-slate-400 text-center leading-tight mt-3">
        La información es remitida a la corredora inmobiliaria.
      </p>
    </div>
  );
}
