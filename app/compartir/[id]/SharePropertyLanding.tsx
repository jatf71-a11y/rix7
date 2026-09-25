'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Property } from '@/lib/types/property';
import { Partner } from '@/lib/data/partners';
import type { SectorCard } from '@/components/properties/SectorOverview';
import { formatArea, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import { claimShareViewMarker } from '@/lib/utils/shareViewPing';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { CurrencySelector } from '@/components/currency/CurrencySelector';
import { ContactAgentForm } from '@/components/properties/ContactAgentForm';
import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { PropertyGallery } from '@/components/properties/PropertyGallery';
import { SectorOverview } from '@/components/properties/SectorOverview';
import {
  Bed,
  Bath,
  Maximize2,
  Car,
  CheckCircle,
  Share2,
  ExternalLink,
  ShieldCheck,
  EyeOff,
  Calendar,
  Layers,
  Download,
} from 'lucide-react';

interface Props {
  property: Property;
  partner?: Partner;
  /** Entorno ya calculado en el servidor (POIs del snapshot estático). */
  sector?: SectorCard[];
  /**
   * Mapa del sector, dibujado en el servidor y montado acá como hijo: el SVG
   * llega pintado, sin que el navegador tenga que construirlo. `undefined` si
   * no hay geometría para esa celda, y en ese caso la tarjeta se queda con su
   * texto.
   */
  sectorMap?: React.ReactNode;
  shareUrl?: string;
}

/**
 * Avisa al servidor que el enlace se abrió, para que la corredora pueda saber
 * qué enlaces le traen interesados.
 *
 * Tres decisiones deliberadas:
 *
 * 1. **Una vez por sesión del navegador.** La decisión vive en
 *    `claimShareViewMarker`, que es una función pura y tiene test: recargar o
 *    volver a la página en la misma pestaña no vuelve a contar. Cerrar la
 *    pestaña y abrir el enlace de nuevo sí cuenta: para la corredora eso es un
 *    enlace que volvió a circular.
 * 2. **No bloquea ni falla a la vista.** Se manda con `keepalive` y sin
 *    `await`: si el aviso se pierde, el visitante no se enteró de nada y la
 *    página sigue igual.
 * 3. **No se guarda nada del visitante.** Se manda el id de la propiedad y el de
 *    la corredora; del otro lado solo se incrementa un contador del día.
 */
function useShareViewPing(propertyId: string, partnerId?: string) {
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // Navegador que bloquea el acceso a `sessionStorage`.
    }

    if (!claimShareViewMarker(storage, propertyId)) return;

    try {
      void fetch('/api/share/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, partnerId: partnerId ?? null }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Sin red o sin `fetch`: el informe pierde una apertura, la página no.
    }
  }, [propertyId, partnerId]);
}

/**
 * Landing compartible de una propiedad.
 *
 * Es la página que se manda por WhatsApp o correo, así que su trabajo no es
 * reemplazar la ficha sino **resumirla y llevar a la corredora**. De ahí las
 * dos reglas que la separan de `/properties/[id]`:
 *
 * 1. **Nada que permita saltarse a la corredora.** No aparece la dirección
 *    exacta ni el teléfono o el correo directos del agente: el mapa muestra un
 *    punto desplazado ~130-230 m y los canales de contacto viven detrás del
 *    formulario, que es el que registra al interesado y lo asigna a la
 *    corredora. Publicar el dato de contacto convertiría el enlace en un
 *    atajo que deja a Rix7 fuera de la operación.
 *
 * 2. **El entorno se cuenta desde los POIs** (colegios, salud, transporte,
 *    comercio…) porque es lo que un enlace reenviado tiene que vender: quien lo
 *    recibe no conoce el barrio.
 */
export default function SharePropertyLanding({
  property,
  partner,
  sector = [],
  sectorMap,
  shareUrl: staticShareUrl,
}: Props) {
  const { format } = useCurrency();
  const isRent = property.status === 'for_rent';
  const [copyOk, setCopyOk] = useState(false);

  useShareViewPing(property.id, partner?.id);

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

  const partnerName = partner?.name || 'la corredora';

  return (
    <div className="min-h-screen bg-slate-50">
      {/*
        Barra propia de esta página, no la del sitio: al ser un enlace compartido
        se comporta como un folleto aparte — sin menú de secciones ni accesos —
        pero con la marca, para que quien recibe el enlace sepa de dónde viene.
      */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 group shrink-0"
              title="Rix7 — Portal Inmobiliario"
            >
              <div className="w-9 h-9 rounded-xl overflow-hidden bg-white border border-slate-200/90 p-1 flex items-center justify-center shadow-md shadow-blue-500/10 group-hover:scale-105 transition-transform">
                <Image
                  src="/brand-logo.png"
                  alt="Logo Rix7"
                  width={32}
                  height={32}
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="text-lg font-black tracking-tight text-slate-900">
                Rix<span className="text-blue-600">7</span>
              </span>
            </Link>

            {/* La corredora dueña de la ficha: logo y nombre junto a la marca
                del portal, para que el enlace reenviado se lea como "Rix7 ·
                Catedral" desde el primer vistazo. Sin partner no se pinta nada
                — mostrar "la corredora" con una inicial sería peor que no
                decirlo. */}
            {partner && (
              <>
                <span className="w-px h-5 bg-slate-200 shrink-0" />
                <Link
                  href={`/empresas/${partner.slug}`}
                  className="flex items-center gap-2 min-w-0 group"
                  title={`Ver las propiedades de ${partner.name}`}
                >
                  <PartnerLogo
                    logo={partner.logo}
                    name={partner.name}
                    color={partner.color}
                    className="h-7 w-auto max-w-[110px] shrink-0"
                  />
                  <span className="text-sm font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                    {partner.name}
                  </span>
                </Link>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CurrencySelector />
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              title="Compartir esta ficha"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compartir</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-6 pb-10 space-y-6">
        {/* ═══ Fotos + video ═══ */}
        <PropertyGallery
          images={property.images || []}
          title={property.title}
          partnerLogo={partner?.logo}
          partnerName={partner?.name}
          partnerColor={partner?.color}
          showPartnerLogo={!!partner}
          videoUrl={property.video_url}
          videoPoster={property.video_poster}
        />

        {/* ═══ Precio, operación y detalles ═══ */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span
                className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white rounded-lg ${
                  isRent ? 'bg-blue-600' : 'bg-emerald-600'
                }`}
              >
                {getStatusLabel(property.status)}
              </span>
              <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 rounded-lg">
                {getPropertyTypeLabel(property.property_type)}
              </span>
              {property.featured && (
                <span className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 rounded-lg">
                  Destacada
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
              {property.title}
            </h1>

            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 mt-3">
              <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                {format(property.price, isRent)}
              </span>
              {/* Comuna y región, nunca la calle: es el dato que la corredora
                  entrega al interesado, no la página pública */}
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                <EyeOff className="w-4 h-4 text-slate-400" />
                {[property.city, property.state].filter(Boolean).join(', ')}
              </span>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Bed className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Dormitorios</span>
                <div className="text-sm font-bold text-slate-900">{property.bedrooms}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Bath className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Baños</span>
                <div className="text-sm font-bold text-slate-900">{property.bathrooms}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Maximize2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Superficie</span>
                <div className="text-sm font-bold text-slate-900">{formatArea(property.area_sqm)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Car className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Estacionamiento</span>
                <div className="text-sm font-bold text-slate-900">
                  {property.parking_spots > 0 ? property.parking_spots : '—'}
                </div>
              </div>
            </div>
            {typeof property.privates === 'number' && property.privates > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Privados</span>
                  <div className="text-sm font-bold text-slate-900">{property.privates}</div>
                </div>
              </div>
            )}
            {property.year_built && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Año</span>
                  <div className="text-sm font-bold text-slate-900">{property.year_built}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* ═══ Entorno / barrio, desde los POIs ═══ */}
            <SectorOverview insights={sector} />

            {/* ═══ Descripción ═══ */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-3">Descripción</h2>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{property.description}</p>
            </div>

            {/* ═══ Equipamiento ═══ */}
            {property.features?.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-3">Equipamiento</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {property.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                      <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ Ubicación aproximada ═══
                El mapa es un SVG propio, dibujado en el servidor con la red de
                calles del snapshot: la landing no le pide nada a ningún
                proveedor de mapas al abrirse, no hay petición a terceros ni
                imágenes que cargar, y el anillo de 15 minutos coincide exacto
                con el conteo de la sección anterior. */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 pb-3">
                <h2 className="text-lg font-bold text-slate-900">Ubicación</h2>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1">
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  Zona aproximada de {[property.city, property.state].filter(Boolean).join(', ')}
                </p>
              </div>

              {sectorMap && <div className="px-6 pb-4">{sectorMap}</div>}

              <div className="p-4 border-t border-slate-100 flex items-start gap-2 text-xs text-slate-600">
                <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                <span>
                  La dirección exacta, el número y el piso los entrega <strong>{partnerName}</strong> al
                  interesado. El punto del mapa es referencial y no corresponde a la ubicación de la propiedad.
                </span>
              </div>
            </div>
          </div>

          {/* ═══ CTA: la corredora ═══ */}
          {/*
            La columna NO es sticky: el grupo entero (aviso + formulario) es más
            alto que una pantalla, y un contenedor pegajoso más alto que el
            viewport deja la parte de abajo inalcanzable. La pieza que se pega es
            el formulario, que ya se declara `sticky` por dentro.
          */}
          <div className="lg:col-span-1 space-y-4">
            {/* Qué pasa si deja los datos: el contexto que convierte el
                formulario en una oferta en vez de un trámite. Encabeza la
                columna la identidad de la corredora —logo y nombre— para que se
                lea antes de llegar al formulario. */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <PartnerLogo
                  logo={partner?.logo}
                  name={partnerName}
                  color={partner?.color || '#3B82F6'}
                  className="h-9 w-auto max-w-[130px]"
                />
                <span className="text-sm font-bold text-slate-900 leading-tight">{partnerName}</span>
              </div>

              <h2 className="text-sm font-bold text-slate-900">¿Te interesa esta propiedad?</h2>
              <p className="text-xs text-slate-600 leading-relaxed mt-2">
                {partnerName} te entrega la información completa, confirma disponibilidad y coordina la
                visita.
              </p>
              {partner?.description && (
                <p className="text-xs text-slate-500 leading-relaxed mt-2">{partner.description}</p>
              )}
              <p className="text-xs text-slate-500 leading-relaxed mt-3 pt-3 border-t border-slate-100">
                La dirección exacta, el número y el piso se entregan al completar tus datos.
              </p>
            </div>

            <ContactAgentForm property={property} partner={partner} />

            <button
              onClick={openWhatsApp}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Compartir esta ficha por WhatsApp
            </button>

            {/*
              La tarjeta para adjuntar, que es otra cosa que compartir el enlace:
              en WhatsApp se manda la **imagen** con el texto aparte, y una imagen
              sola sin el enlace impreso no lleva a ningún lado. Por eso esta
              descarga el enlace va al pie de la propia tarjeta (ver ShareCard).
            */}
            <div className="space-y-2">
              <a
                href={`/compartir/${property.id}/share-card`}
                download={`Rix7-${property.id}.png`}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors"
              >
                <Download className="w-4 h-4" />
                Descargar tarjeta para WhatsApp
              </a>
              <p className="text-[11px] text-slate-500 leading-relaxed text-center">
                Imagen 1080×1350 con la foto, el precio y el enlace al pie, lista para adjuntar.
              </p>
            </div>
          </div>
        </div>

        {/* Pie: deja claro por qué faltan datos y adónde ir */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-slate-500 leading-relaxed flex items-start gap-2">
            <EyeOff className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
            <span>
              Por seguridad de los propietarios, esta ficha no publica la dirección exacta ni los datos de
              contacto directos. Se entregan a través de {partnerName}.
            </span>
          </p>
          <Link
            href={`/properties/${property.id}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <span>Ver ficha completa</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
