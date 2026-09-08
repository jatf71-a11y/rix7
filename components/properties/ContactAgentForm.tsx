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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulación de envío de lead al backend de Supabase o email del agente
    setTimeout(() => {
      setLoading(false);
      setIsSubmitted(true);
    }, 1000);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm sticky top-24">
      {/* Tarjeta del Agente Inmobiliario */}
      <div className="flex items-center gap-3.5 pb-5 border-b border-slate-100">
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

        <div>
          <h4 className="font-bold text-slate-900 text-sm">
            {property.agent_name || 'Elena Valenzuela'}
          </h4>
          <p className="text-xs text-slate-500">Agente Inmobiliario Verificado</p>
          <div className="flex items-center gap-1 mt-1 text-amber-500 text-xs">
            <Star className="w-3.5 h-3.5 fill-current" />
            <span className="font-bold text-slate-800">4.9</span>
            <span className="text-slate-400">(38 operaciones)</span>
          </div>
        </div>
      </div>

      {isSubmitted ? (
        <div className="py-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-slate-900">¡Mensaje Enviado con Éxito!</h4>
          <p className="text-xs text-slate-500">
            El agente se pondrá en contacto contigo a la brevedad mediante correo o teléfono.
          </p>
          <button
            onClick={() => setIsSubmitted(false)}
            className="mt-3 text-xs font-semibold text-blue-600 hover:underline"
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
