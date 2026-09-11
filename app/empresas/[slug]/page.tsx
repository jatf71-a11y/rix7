'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getPartnerBySlug } from '@/lib/data/partners';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { ArrowLeft, MapPin, Bed, Bath, Maximize2, LampDesk, ExternalLink, Building2 } from 'lucide-react';
import { Property } from '@/lib/types/property';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { formatArea } from '@/lib/utils/formatters';

export default function EmpresaPage({ params }: { params: { slug: string } }) {
  const partner = getPartnerBySlug(params.slug);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const { format } = useCurrency();

  useEffect(() => {
    if (!partner) { setLoading(false); return; }
    fetch(`/api/properties?partnerId=${partner.id}&limit=500`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setProperties(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partner]);

  // Partner not found
  if (!partner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 text-lg font-semibold">Empresa no encontrada</p>
          <Link href="/" className="mt-4 inline-flex items-center gap-2 text-blue-600 font-bold hover:underline">
            <ArrowLeft className="w-4 h-4" />
            Volver al portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al portal
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-8 overflow-hidden">
              <PartnerLogo logo={partner.logo} name={partner.name} color={partner.color} className="h-full w-auto" />
            </div>
            <span className="text-sm font-bold text-slate-800">{partner.name}</span>
          </div>
        </div>
      </div>

      {/* Partner banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center gap-6">
            <div className="h-16 overflow-hidden">
              <PartnerLogo logo={partner.logo} name={partner.name} color={partner.color} className="h-full w-auto" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-black text-slate-900">{partner.name}</h1>
              <p className="text-slate-500 text-sm mt-1">{partner.description}</p>
            </div>
            {partner.website && (
              <a
                href={partner.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors text-sm font-semibold text-slate-700"
              >
                <ExternalLink className="w-4 h-4" />
                Sitio web
              </a>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <span className="text-sm font-semibold text-slate-500">
              {loading ? 'Cargando...' : `${properties.length} ${properties.length === 1 ? 'propiedad' : 'propiedades'} disponibles`}
            </span>
          </div>
        </div>
      </div>

      {/* Properties grid */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
                <div className="aspect-[16/10] bg-slate-200" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="h-6 bg-slate-200 rounded w-1/3 mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : properties.length === 0 ? (
          <div className="text-center py-20">
            <Building2 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 text-lg font-semibold">No hay propiedades disponibles de esta empresa</p>
            <Link href="/" className="mt-4 inline-flex items-center gap-2 text-blue-600 font-bold hover:underline">
              <ArrowLeft className="w-4 h-4" />
              Volver al portal
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties.map((property) => (
              <Link
                key={property.id}
                href={`/properties/${property.id}`}
                className="group block bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-blue-300 transition-all duration-300"
              >
                {/* Image */}
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={property.images?.[0] || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80'}
                    alt={property.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 flex gap-2">
                    <span className={`px-2.5 py-1 text-[10px] font-bold rounded-lg ${
                      property.status === 'for_rent' ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {property.status === 'for_rent' ? 'Arriendo' : 'Venta'}
                    </span>
                  </div>
                  {/* Partner logo badge — solo en destacadas o nuevas */}
                  {(property.featured || (property.created_at && (Date.now() - new Date(property.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000)) && (
                    <div className="absolute top-3 right-3 h-8 rounded-lg overflow-hidden shadow-lg">
                      <PartnerLogo logo={partner.logo} name={partner.name} color={partner.color} className="h-full w-auto" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="text-sm font-bold text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                    {property.title}
                  </h3>
                  <div className="flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500 truncate">{property.address}, {property.city}</span>
                  </div>

                  {/* Specs */}
                  <div className="flex items-center gap-3 mt-3">
                    {property.bedrooms > 0 && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Bed className="w-3.5 h-3.5 text-blue-500" />
                        <span>{property.bedrooms}</span>
                      </div>
                    )}
                    {property.bathrooms > 0 && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Bath className="w-3.5 h-3.5 text-blue-500" />
                        <span>{property.bathrooms}</span>
                      </div>
                    )}
                    {(property.privates ?? 0) > 0 && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <LampDesk className="w-3.5 h-3.5 text-blue-500" />
                        <span>{property.privates}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Maximize2 className="w-3.5 h-3.5 text-blue-500" />
                      <span>{formatArea(property.area_sqm)}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-lg font-black text-slate-900">
                      {format(property.price, property.status === 'for_rent')}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
