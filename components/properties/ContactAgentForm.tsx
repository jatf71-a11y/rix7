'use client';

import React, { useState } from 'react';
import { Property } from '@/lib/types/property';
import { Mail, Phone, Calendar, User, Send, CheckCircle2, ShieldCheck, Star } from 'lucide-react';

interface ContactAgentFormProps {
  property: Property;
}

export function ContactAgentForm({ property }: ContactAgentFormProps) {
  const [tourType, setTourType] = useState<'in_person' | 'video'>('in_person');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState(
    `Hola, me interesa obtener más información sobre "${property.title}" (Ref: ${property.id.slice(0, 8)}). ¿Podríamos coordinar una visita?`
  );
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const agentPhone = property.agent_phone || '56900000000';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Construir mensaje para WhatsApp
    const text = encodeURIComponent(
      `Hola ${property.agent_name || 'Agente'},\n\n` +
      `Soy ${name}${phone ? `, teléfono ${phone}` : ''}${email ? `, email ${email}` : ''}.\n\n` +
      `${message}\n\n` +
      `Tipo de visita: ${tourType === 'in_person' ? 'Presencial' : 'Videollamada'}\n` +
      `Propiedad: ${property.title}\n` +
      `Ref: ${property.id.slice(0, 12)}`
    );

    // Abrir WhatsApp con el mensaje prellenado
    window.open(`https://api.whatsapp.com/send?phone=${agentPhone.replace(/\D/g, '')}&text=${text}`, '_blank');

    setTimeout(() => {
      setLoading(false);
      setIsSubmitted(true);
    }, 500);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm sticky top-24">
      {/* Tarjeta del Agente Inmobiliario */}
      <div className="flex items-center gap-3.5 pb-4 border-b border-slate-100">
        <div className="relative">
          <img
            src={
              property.agent_avatar ||
              'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=256&q=80'
            }
            alt={property.agent_name || 'Agente Inmobiliario'}
            className="w-14 h-14 rounded-full object-cover border-2 border-blue-500 shadow-sm"
          />
          <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-1 rounded-full">
            <ShieldCheck className="w-3 h-3" />
          </div>
        </div>

        <div className="flex-1">
          <h4 className="font-bold text-slate-900 text-sm">
            {property.agent_name || 'Agente Rix7'}
          </h4>
          <p className="text-xs text-slate-500">Agente Inmobiliario Verificado</p>
          <div className="flex items-center gap-1 mt-1 text-amber-500 text-xs">
            <Star className="w-3.5 h-3.5 fill-current" />
            <span className="font-bold text-slate-800">4.9</span>
            <span className="text-slate-400">(38 operaciones)</span>
          </div>
        </div>
      </div>

      {/* Botones rápidos: Llamar / WhatsApp */}
      <div className="grid grid-cols-2 gap-2 mt-4 pb-4 border-b border-slate-100">
        {property.agent_phone && (
          <a
            href={`tel:${property.agent_phone}`}
            className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            Llamar
          </a>
        )}
        <a
          href={`https://api.whatsapp.com/send?phone=${(property.agent_phone || '56900000000').replace(/\D/g, '')}&text=${encodeURIComponent(`Hola, me interesa la propiedad "${property.title}" (Ref: ${property.id.slice(0, 12)})`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </a>
      </div>

      {isSubmitted ? (
        <div className="py-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-slate-900">¡Mensaje Enviado!</h4>
          <p className="text-xs text-slate-500">
            Se abrió WhatsApp con tu mensaje para el agente. También puedes llamar directamente.
          </p>
          {property.agent_phone && (
            <a
              href={`tel:${property.agent_phone}`}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
              Llamar al agente
            </a>
          )}
          <button
            onClick={() => setIsSubmitted(false)}
            className="block mt-3 text-xs font-semibold text-blue-600 hover:underline"
          >
            Enviar otra consulta
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Selector de Tipo de Visita */}
          <div>
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Tipo de Consulta / Visita
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTourType('in_person')}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                  tourType === 'in_person'
                    ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Presencial</span>
              </button>
              <button
                type="button"
                onClick={() => setTourType('video')}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                  tourType === 'video'
                    ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Videollamada</span>
              </button>
            </div>
          </div>

          <div>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                required
                placeholder="Tu nombre completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                required
                placeholder="Correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="tel"
                placeholder="Teléfono (opcional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>{loading ? 'Enviando solicitud...' : 'Contactar al Agente'}</span>
          </button>

          <p className="text-[10px] text-slate-400 text-center leading-tight">
            Al enviar este formulario aceptas nuestros Términos de Servicio y Política de Privacidad.
          </p>
        </form>
      )}
    </div>
  );
}
