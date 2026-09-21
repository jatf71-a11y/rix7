'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Property } from '@/lib/types/property';
import { Partner } from '@/lib/data/partners';
import { formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { CurrencySelector } from '@/components/currency/CurrencySelector';
import { ContactAgentForm } from '@/components/properties/ContactAgentForm';
import { MapPin, Bed, Bath, Maximize2, Car, CheckCircle, ChevronLeft, Share2, Phone, ExternalLink, ShieldCheck } from 'lucide-react';

interface Props {
  property: Property;
  partner?: Partner;
  shareUrl?: string;
}

export default function SharePropertyLanding({ property, partner, shareUrl: staticShareUrl }: Props) {
  const { format } = useCurrency();
  const isRent = property.status === 'for_rent';
  const pricePerSqm = property.area_sqm > 0 ? Math.round(property.price / property.area_sqm) : 0;
  const [copyOk, setCopyOk] = useState(false);

  const shareUrl = useMemo(() => {
    if (typeof window !== 'undefined') return `${window.location.origin}/compartir/${property.id}`;
    return staticShareUrl || '';
  }, [staticShareUrl, property.id]);

  const shareText = `${property.title} en ${property.city} | Rix7`;

  const openWhatsApp = () => {
    const text = encodeURIComponent(`${shareText}\n${shareUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {}
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: shareText, text: shareText, url: shareUrl });
      } else {
        copyLink();
      }
    } catch {}
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href={`/properties/${property.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">
            <ChevronLeft className="w-4 h-4" />
            <span>Ver ficha completa</span>
          </Link>

          <div className="flex items-center gap-2">
            <CurrencySelector />
            <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <Share2 className="w-3.5 h-3.5" />
              <span>Compartir</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-6 pb-10 space-y-6">
        {/* Hero */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="relative aspect-[16/7] w-full bg-slate-100">
            {property.images?.[0] && (
              <img src={property.images[0]} alt={property.title} className="w-full h-full object-cover" />
            )}

            {partner && (
              <div className="absolute top-3 right-3 h-8">
                <img src={partner.logo} alt={partner.name} className="h-full w-auto object-contain" />
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-lg ${isRent ? 'bg-blue-600' : 'bg-emerald-600'}`}>
                  {getStatusLabel(property.status)}
                </span>
                <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-white/90 text-slate-900 rounded-lg">
                  {getPropertyTypeLabel(property.property_type)}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{format(property.price, isRent)}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/90">
                <MapPin className="w-4 h-4" />
                {property.address}, {property.city}{property.state ? ` (${property.state})` : ''}
              </p>
            </div>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Bed className="w-5 h-5" /></div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Dormitorios</span>
                <div className="text-sm font-bold text-slate-900">{property.bedrooms} dorm.</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Bath className="w-5 h-5" /></div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Baños</span>
                <div className="text-sm font-bold text-slate-900">{property.bathrooms} baños</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Maximize2 className="w-5 h-5" /></div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Superficie</span>
                <div className="text-sm font-bold text-slate-900">{formatArea(property.area_sqm)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Car className="w-5 h-5" /></div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Estacionamiento</span>
                <div className="text-sm font-bold text-slate-900">{property.parking_spots > 0 ? `${property.parking_spots} estac.` : 'Sin estac.'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions + Description + Map */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* CTA row */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src={property.agent_avatar || 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=256&q=80'} alt={property.agent_name || 'Agente'} className="w-10 h-10 rounded-full border-2 border-blue-500 object-cover" />
                <div>
                  <div className="text-sm font-bold text-slate-900">{property.agent_name || 'Agente Rix7'}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-blue-600" /> Agente verificado</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {property.agent_phone && (
                  <a href={`tel:${property.agent_phone}`} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors">
                    <Phone className="w-3.5 h-3.5" />
                    Llamar
                  </a>
                )}
                <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors">
                  WhatsApp
                </a>
                <button onClick={copyLink} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors">
                  {copyOk ? 'Copiado ✓' : 'Copiar enlace'}
                </button>
              </div>
            </div>

            {/* Description */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-3">Descripción</h2>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{property.description}</p>
            </div>

            {/* Features */}
            {property.features?.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-3">Equipamiento</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {property.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Static map */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 pb-3">
                <h2 className="text-lg font-bold text-slate-900">Ubicación</h2>
                <p className="text-xs text-slate-500">{property.address}, {property.city}</p>
              </div>
              <div className="relative h-72 sm:h-96 bg-slate-100">
                <iframe
                  title={`Mapa de ${property.title}`}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${property.lng - 0.012},${property.lat - 0.008},${property.lng + 0.012},${property.lat + 0.008}&layer=mapnik&marker=${property.lat},${property.lng}`}
                />
              </div>
              <div className="p-4 border-t border-slate-100">
                <a href={`https://www.openstreetmap.org/?mlat=${property.lat}&mlon=${property.lng}#map=16/${property.lat}/${property.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en OpenStreetMap
                </a>
              </div>
            </div>
          </div>

          {/* Contact form */}
          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <ContactAgentForm property={property} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
