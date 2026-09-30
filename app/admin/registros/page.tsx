'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Inbox,
  Mail,
  Phone,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { CONSENTS } from '@/lib/utils/consents';
import type { Signup } from '@/lib/data/signups';

/**
 * Registros de visitas y las autorizaciones que dieron.
 *
 * No es una libreta de contactos: es la **constancia de consentimiento**. Por eso
 * la lista muestra las cuatro autorizaciones de cada alta, incluidas las que
 * quedaron sin marcar —saber quién dijo que no es tan importante como saber
 * quién dijo que sí— y la versión de los textos que aceptó.
 *
 * La tabla es solo-anexa: si una persona cambia de opinión y vuelve a
 * registrarse, no se pisa la fila anterior, se agrega otra. Ver dos filas del
 * mismo correo no es un error, es la respuesta a «¿cuándo autorizó esto?».
 */

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Autorizaciones opcionales: son las que vale la pena contar. */
const OPTIONAL_CONSENTS = CONSENTS.filter((consent) => !consent.required);

export default function AdminRegistrosPage() {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [persistent, setPersistent] = useState(true);
  const [search, setSearch] = useState('');

  const loadSignups = () => {
    setLoading(true);
    fetch('/api/registro')
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          setSignups(result.data);
          setPersistent(result.persistent !== false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSignups();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return signups;

    return signups.filter((signup) =>
      [signup.name, signup.email, signup.phone]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [signups, search]);

  const ultimos7Dias = useMemo(() => {
    const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return signups.filter((signup) => new Date(signup.createdAt).getTime() >= corte).length;
  }, [signups]);

  return (
    <div className="max-w-6xl">
      {/* Aviso: sin Supabase los registros viven en memoria */}
      {!loading && !persistent && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Modo de prueba: las constancias no se guardan</p>
            <p className="mt-0.5 text-amber-700">
              No hay un proyecto Supabase configurado, así que esto se pierde al reiniciar el
              servidor. En producción cada alta queda en
              <code className="font-mono"> public.signups</code>.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Registros y autorizaciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading
              ? 'Cargando...'
              : `${signups.length} ${signups.length === 1 ? 'registro' : 'registros'} · ${ultimos7Dias} en los últimos 7 días`}
          </p>
        </div>
        <button
          onClick={loadSignups}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-sm font-semibold text-slate-700 rounded-lg transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Resumen de las opcionales: la pregunta que hay que poder responder */}
      {!loading && signups.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-6">
          {OPTIONAL_CONSENTS.map((consent) => {
            const cuantos = signups.filter((signup) => signup.consents[consent.id]).length;
            return (
              <div
                key={consent.id}
                className="px-4 py-2.5 bg-white rounded-lg border border-slate-200"
              >
                <p className="text-[11px] font-semibold text-slate-500">{consent.title}</p>
                <p className="text-sm font-bold text-slate-900">
                  {cuantos} de {signups.length}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, correo o teléfono..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
          <Inbox className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 font-semibold">
            {signups.length === 0
              ? 'Todavía no hay registros'
              : 'Ningún registro coincide con la búsqueda'}
          </p>
          {signups.length === 0 && (
            <p className="text-sm text-slate-400 mt-1">
              Cuando alguien se registre desde el navbar, su alta y sus autorizaciones aparecerán
              acá.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((signup) => {
            const digits = signup.phone.replace(/\D/g, '');

            return (
              <div
                key={signup.id}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-200 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-sm">{signup.name}</h3>

                    {/* Datos de contacto: accionables para el equipo */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                      <a
                        href={`mailto:${signup.email}`}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {signup.email}
                      </a>
                      <a
                        href={digits ? `tel:+${digits}` : '#'}
                        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {signup.phone}
                      </a>
                    </div>
                  </div>

                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {formatDate(signup.createdAt)}
                  </span>
                </div>

                {/* Las cuatro autorizaciones, tal como quedaron */}
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                  {CONSENTS.map((consent) => {
                    const granted = signup.consents[consent.id];
                    return (
                      <span
                        key={consent.id}
                        title={`${consent.title}: ${granted ? 'autorizado' : 'no autorizado'}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                          granted
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-50 text-slate-400 border-slate-200'
                        }`}
                      >
                        {granted ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {consent.title}
                      </span>
                    );
                  })}

                  <span className="text-[10px] text-slate-400 ml-auto">
                    Textos v. {signup.consentVersion}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
