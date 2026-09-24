import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPropertyById } from '@/lib/data/propertyLookup';
import { getPartnerById } from '@/lib/data/partners-store';
import { poisFromSnapshot } from '@/lib/data/poiSnapshotLookup';
import { sectorGeometry } from '@/lib/data/mapSnapshotLookup';
import { POI_CATEGORIES, WALKABLE_RADIUS_M } from '@/lib/data/poiCategories';
import { buildSectorOverview, haversineMeters } from '@/lib/utils/sectorSummary';
import type { SectorCard } from '@/components/properties/SectorOverview';
import { SectorMap } from '@/components/properties/SectorMap';
import { approximatePoint, type ApproximatePoint } from '@/lib/utils/approximateLocation';
import { buildShareMeta } from '@/lib/utils/shareMeta';
import type { Property } from '@/lib/types/property';
import { SITE_URL } from '@/lib/site';
import SharePropertyLanding from './SharePropertyLanding';

type Props = { params: { id: string } };

/**
 * Versión publicable de la propiedad: lo que puede viajar al navegador.
 *
 * No es cosmético. La landing es un componente de cliente, así que **todo lo
 * que se le pasa queda escrito en el HTML** (`self.__next_f`), aunque el JSX no
 * lo muestre: con la propiedad completa, la dirección exacta y el teléfono del
 * agente eran legibles con "ver código fuente", es decir, un atajo para saltarse
 * a la corredora. Acá se quitan y el mapa se mueve al punto difuminado, de modo
 * que la ubicación real no llega nunca al cliente.
 */
function toPublishable(property: Property, approx: ApproximatePoint): Property {
  return {
    ...property,
    address: '',
    zip_code: undefined,
    agent_name: undefined,
    agent_email: undefined,
    agent_phone: undefined,
    agent_avatar: undefined,
    lat: approx.lat,
    lng: approx.lng,
  };
}

// Caché ISR corta, igual que la ficha: un enlace compartido por WhatsApp lo abre
// mucha gente seguida y no tiene sentido reconstruir la página (ni consultar el
// entorno) en cada visita. Sin `generateStaticParams` vacío, Next trataría el
// segmento dinámico como no cacheable.
export const revalidate = 60;

export function generateStaticParams() {
  return [];
}

/**
 * Entorno del sector para la landing, desde el snapshot estático.
 *
 * Es deliberadamente **sin red**: el enlace compartido tiene que abrir rápido y
 * no puede depender de que Overpass esté arriba. Si la celda no está en el
 * snapshot, se devuelve una lista vacía y la landing simplemente no muestra la
 * sección (mejor que un bloque a medio armar).
 *
 * Las coordenadas cumplen dos papeles distintos y no intercambiables:
 *
 * - `real*` busca el **pool** de POIs: el snapshot está indexado por la celda
 *   de la propiedad, así que no hay otra forma de encontrarlo. Se usan solo acá
 *   y no salen del servidor.
 * - `at*` es el punto desde el que se **miden** los conteos: el punto difuminado,
 *   que es el único que el visitante ve. Gracias a eso la descripción del barrio
 *   no aporta ni un dato sobre dónde está la propiedad de verdad.
 *
 * Medir desde un punto a lo más 230 m del real es seguro porque el pool cubre
 * 1500 m y solo se mide un radio de 1200 m (invariante documentada en
 * `SNAPSHOT_POOL_RADIUS_M`, con test).
 *
 * Devuelve dos cosas con el mismo criterio:
 *
 * - `cards`: solo lo que la tarjeta muestra (conteo y desglose por subtipo). El
 *   texto redactado y los lugares cercanos se descartan acá, así que tampoco
 *   viajan al navegador.
 * - `mapPois`: los puntos que dibuja el mapa del sector. Se filtran por el
 *   **mismo radio de 1.200 m** que cuentan las tarjetas, porque un marcador más
 *   allá del anillo diría "más lejos de 15 minutos" y contradiría los números
 *   de arriba.
 */
async function buildSector(
  realLat: number | undefined,
  realLng: number | undefined,
  atLat: number,
  atLng: number
): Promise<{ cards: SectorCard[]; mapPois: { lat: number; lng: number; category: string }[] }> {
  const empty = { cards: [], mapPois: [] };
  if (typeof realLat !== 'number' || typeof realLng !== 'number') return empty;

  const snapshot = await poisFromSnapshot(realLat, realLng);
  if (!snapshot) return empty;

  const cards = buildSectorOverview(snapshot.pois, Object.keys(POI_CATEGORIES), atLat, atLng).map(
    ({ category, count, byType }) => ({ category, count, byType })
  );

  const mapPois = snapshot.pois
    .filter((poi) => haversineMeters(atLat, atLng, poi.lat, poi.lng) <= WALKABLE_RADIUS_M)
    .map((poi) => ({ lat: poi.lat, lng: poi.lng, category: poi.category }));

  return { cards, mapPois };
}

/**
 * Metadata del enlace compartido.
 *
 * El `<title>` de la pestaña y el título de la **tarjeta** son distintos a
 * propósito: el de la tarjeta es el que se lee en WhatsApp y lleva el precio
 * adelante (`$ 1.800.000 /mes · Departamento 2 dormitorios · Las Condes`),
 * mientras que el de la pestaña mantiene el nombre completo para quien ya está
 * navegando. Los arma `buildShareMeta`, que además redacta la dirección, los
 * teléfonos y los correos que puedan venir dentro del texto de la corredora.
 *
 * La imagen no se declara acá: la aporta `opengraph-image.tsx`, que la genera
 * con el precio sobre la foto y publica su URL absoluta y sus dimensiones.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const property = await fetchPropertyById(params.id);
  if (!property) return { title: 'Propiedad no encontrada | Rix7' };

  const partner = property.partner_id ? await getPartnerById(property.partner_id) : undefined;

  const { title, description } = buildShareMeta(
    {
      title: property.title,
      description: property.description,
      property_type: property.property_type,
      status: property.status,
      price: property.price,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      area_sqm: property.area_sqm,
      city: property.city,
      state: property.state,
      address: property.address,
      features: property.features,
    },
    partner?.name
  );

  const url = `${SITE_URL}/compartir/${property.id}`;

  return {
    title: `${property.title || 'Propiedad'} | Rix7`,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Rix7',
      type: 'website',
      locale: 'es_CL',
    },
    twitter: { card: 'summary_large_image', title, description },
    alternates: { canonical: url },
  };
}

export default async function SharePropertyPage({ params }: Props) {
  const property = await fetchPropertyById(params.id);

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Propiedad no encontrada</h1>
          <p className="text-slate-500">Esta propiedad puede haber sido removida o el enlace no es válido.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl">
            Volver al portal
          </Link>
        </div>
      </div>
    );
  }

  // Las corredoras viven en Supabase: se resuelven acá, en el servidor, y bajan
  // como prop (los componentes de contacto son de cliente).
  const partner = property.partner_id ? await getPartnerById(property.partner_id) : undefined;
  // Un solo punto difuminado para todo: el mapa, el entorno y lo que baja al
  // cliente. Calcularlo una vez evita que el mapa y las distancias describan
  // manzanas distintas.
  const approx = approximatePoint(property.lat, property.lng, property.id);
  const sector = await buildSector(property.lat, property.lng, approx.lat, approx.lng);
  const publicProperty = toPublishable(property, approx);

  // Geometría de las calles: se dibuja en el **servidor** y llega como hijo,
  // así el navegador recibe el SVG ya pintado y no construye miles de nodos al
  // hidratar. Sin celda (propiedad nueva o snapshot anterior a las calles) no
  // hay mapa y la tarjeta queda con su texto, no a medio armar.
  const geometry = await sectorGeometry(property.lat, property.lng);
  const sectorMap = geometry ? (
    <SectorMap
      lat={approx.lat}
      lng={approx.lng}
      roads={geometry.roads}
      areas={geometry.areas}
      pois={sector.mapPois}
    />
  ) : undefined;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SharePropertyLanding
        property={publicProperty}
        partner={partner as any}
        sector={sector.cards}
        sectorMap={sectorMap}
        shareUrl={`${SITE_URL}/compartir/${property.id}`}
      />
    </div>
  );
}
