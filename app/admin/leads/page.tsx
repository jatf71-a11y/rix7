'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ExternalLink,
  Inbox,
  Mail,
  Phone,
  RefreshCw,
  Search,
} from 'lucide-react';
import { leadChannelLabel, type Lead, type LeadChannel } from '@/lib/data/leads';
import type { Partner } from '@/lib/data/partners';

/** Colores del badge por canal, para leer la lista de un vistazo. */
const CHANNEL_STYLES: Record<LeadChannel, string> = {
  form: 'bg-slate-100 text-slate-700 border-slate-200',
  call: 'bg-slate-900 text-white border-slate-900',
  whatsapp: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  mail: 'bg-blue-50 text-blue-700 border-blue-200',
};

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

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [persistent, setPersistent] = useState(true);
  const [search, setSearch] = useState('');

  const loadLeads = () => {
    setLoading(true);
    fetch('/api/leads')
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          setLeads(result.data);
          setPersistent(result.persistent !== false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLeads();

    // Nombres de corredoras para no mostrar solo el id en la lista.
    fetch('/api/partners')
      .then((r) => r.json())
      .then((result) => {
        if (!result?.success) return;
        const map: Record<string, string> = {};
        for (const partner of result.data as Partner[]) map[partner.id] = partner.name;
        setPartners(map);
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;

    return leads.filter((lead) =>
      [lead.name, lead.email, lead.phone, lead.propertyId, lead.partnerId]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [leads, search]);

  const ultimos7Dias = useMemo(() => {
    const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return leads.filter((lead) => new Date(lead.createdAt).getTime() >= corte).length;
  }, [leads]);

  return (
    <div className="max-w-6xl">
      {/* Aviso: sin Supabase los contactos viven en memoria */}
      {!loading && !persistent && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Modo de prueba: los contactos no se guardan</p>
            <p className="mt-0.5 text-amber-700">
              No hay un proyecto Supabase configurado, así que los contactos que lleguen se
              pierden al reiniciar el servidor. En producción quedan registrados en
              <code className="font-mono"> public.leads</code>.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Contactos recibidos</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading
              ? 'Cargando...'
              : `${leads.length} ${leads.length === 1 ? 'contacto' : 'contactos'} · ${ultimos7Dias} en los últimos 7 días`}
          </p>
        </div>
        <button
          onClick={loadLeads}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-sm font-semibold text-slate-700 rounded-lg transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, correo, teléfono o propiedad..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
          <Inbox className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 font-semibold">
            {leads.length === 0
              ? 'Todavía no hay contactos'
              : 'Ningún contacto coincide con la búsqueda'}
          </p>
          {leads.length === 0 && (
            <p className="text-sm text-slate-400 mt-1">
              Cuando una visita deje sus datos en una ficha, aparecerá acá.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((lead) => {
            const digits = lead.phone.replace(/\D/g, '');
            const partnerName = lead.partnerId ? partners[lead.partnerId] || lead.partnerId : null;

            return (
              <div
                key={lead.id}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-200 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-sm">{lead.name}</h3>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${CHANNEL_STYLES[lead.channel]}`}
                      >
                        {leadChannelLabel(lead.channel)}
                      </span>
                      {partnerName && (
                        <span className="text-[11px] font-semibold text-slate-500">
                          {partnerName}
                        </span>
                      )}
                    </div>

                    {/* Datos de contacto: accionables para el equipo */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                      <a
                        href={`mailto:${lead.email}`}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {lead.email}
                      </a>
                      <a
                        href={digits ? `tel:+${digits}` : '#'}
                        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {lead.phone}
                      </a>
                    </div>

                    {lead.propertyId && (
                      <Link
                        href={`/properties/${lead.propertyId}`}
                        className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-blue-600 mt-2"
                        title="Ver la propiedad que generó el interés"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {lead.propertyId}
                      </Link>
                    )}

                    {lead.message && (
                      <p className="text-xs text-slate-500 mt-2 line-clamp-2">{lead.message}</p>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {formatDate(lead.createdAt)}
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
