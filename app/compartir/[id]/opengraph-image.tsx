import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';
import { fetchPropertyById } from '@/lib/data/propertyLookup';
import { getPartnerById } from '@/lib/data/partners-store';
import { buildShareFacts, truncateAtWord } from '@/lib/utils/shareMeta';
import { formatPrice, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import type { Property } from '@/lib/types/property';

/**
 * Tarjeta de vista previa del enlace compartido (la imagen que muestra WhatsApp
 * antes del clic).
 *
 * Es el único activo de marketing que viaja **sin que nadie habra la página**,
 * así que la pieza central es el precio, sobre la foto de la propiedad y con la
 * marca de la corredora al lado. La alternativa —lo que había antes— era la
 * primera foto del catálogo sin contexto: se veía como un enlace suelto.
 *
 * Decisiones que no son obvias:
 *
 * - **Las imágenes se convierten a `data:` antes de dibujarlas.** Satori
 *   descarga cada `src` por su cuenta y, si alguna falla, la tarjeta entera no
 *   se genera: el enlace se comparte sin imagen. Trayéndolas acá el fallo se
 *   detecta a tiempo y se cae a una tarjeta sin foto, que sigue siendo buena.
 * - **Un logo SVG no se intenta dibujar.** Satori no rasteriza SVG arbitrario y
 *   fallaría la tarjeta completa; en ese caso se usa la inicial sobre el color
 *   de la marca, que es el mismo recurso que usa el sitio.
 *
 * Corre en el **runtime edge**, y no por velocidad: el bundle de `next/og` para
 * Node lee las fuentes del disco **al importarse** (`fileURLToPath(join(import.meta.url…))`)
 * y en Windows esa ruta se arma mal, así que la imagen moría con un 500 antes de
 * dibujar nada. El bundle de edge pide las fuentes por `fetch`. Por eso acá no
 * hay `node:fs` ni `Buffer`: los assets locales se piden por HTTP a este mismo
 * servidor y el base64 se arma a mano.
 */

export const runtime = 'edge';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Ficha de propiedad compartida en Rix7';

/**
 * Un rato de caché en el borde: generar la tarjeta implica bajar la foto y
 * rasterizar. Una hora alcanza para que un enlace que circula no la regenere en
 * cada apertura, y es corto como para que un cambio de precio o de foto se vea
 * el mismo día.
 */
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

/** Formatos que satori dibuja de verdad. */
const RASTER = ['.png', '.jpg', '.jpeg', '.webp'];

/** 4 MB: una foto más grande no mejora la tarjeta y sí arriesga el render. */
const MAX_IMAGE_BYTES = 4_000_000;

/** Base64 sin `Buffer`: el runtime edge no lo tiene. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    // Índice a índice: spread sobre un TypedArray exige `downlevelIteration`.
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
  }
  return btoa(binary);
}

/**
 * Origen absoluto de esta misma petición, para pedir los assets de `public/`.
 * Si no se puede resolver (sin cabeceras), se devuelve `undefined` y la tarjeta
 * se dibuja sin logo: es mejor que una tarjeta que no se genera.
 */
function selfOrigin(host: string | null, proto: string | null): string | undefined {
  if (!host) return undefined;
  const scheme = proto?.split(',')[0]?.trim() || (host.startsWith('localhost') ? 'http' : 'https');
  return `${scheme}://${host}`;
}

async function toDataUri(source?: string, origin?: string): Promise<string | undefined> {
  if (!source) return undefined;
  if (source.startsWith('data:')) return source;

  // Solo se descarta acá lo que se sabe que satori no dibuja (un `.svg` local,
  // por ejemplo). El resto se decide con el `content-type` de la respuesta: las
  // fotos de un CDN suelen no tener extensión (`images.unsplash.com/photo-150…`),
  // y exigir una era descartar toda foto remota en silencio.
  const path = source.split('?')[0].split('#')[0];
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(path);
  if (hasExtension && !RASTER.includes(path.slice(path.lastIndexOf('.')).toLowerCase())) {
    return undefined;
  }

  const target = source.startsWith('/') ? (origin ? `${origin}${source}` : undefined) : source;
  if (!target) return undefined;

  try {
    const res = await fetch(target, { next: { revalidate: 86400 } });
    if (!res.ok) return undefined;

    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/') || type.includes('svg')) return undefined;

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return undefined;
    return `data:${type};base64,${toBase64(buf)}`;
  } catch {
    return undefined;
  }
}

interface CardInput {
  photo?: string;
  logo?: string;
  price?: string;
  title: string;
  place?: string;
  badge?: string;
  partnerName?: string;
  partnerColor: string;
}

/** El lienzo. Se dibuja igual con foto que sin ella: cambia el fondo. */
function card({
  photo,
  logo,
  price,
  title,
  place,
  badge,
  partnerName,
  partnerColor,
}: CardInput) {
  const initial = (partnerName || 'R').charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 56,
        // Sin foto, el fondo de marca. El valor no se pasa como `undefined`
        // cuando hay foto: satori intenta leerlo igual y revienta.
        ...(photo
          ? { backgroundColor: '#0f172a' }
          : { backgroundColor: '#0f172a', backgroundImage: `linear-gradient(135deg, #0f172a 0%, ${partnerColor} 100%)` }),
      }}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          width={1200}
          height={630}
          style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
        />
      ) : null}

      {/*
        Oscurecido por capas de `rgba` sólido y no con un gradiente: el parser de
        fondos de satori se cae con los gradientes cuyos colores son `rgba(…)`
        ("Cannot read properties of undefined (reading 'trim')"), y una tarjeta
        que no se genera deja el enlace sin imagen.
      */}
      {photo ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundColor: 'rgba(2,6,23,0.34)',
          }}
        />
      ) : null}

      {photo ? (
        <div
          style={{
            position: 'absolute',
            top: 230,
            left: 0,
            width: 1200,
            height: 400,
            backgroundColor: 'rgba(2,6,23,0.55)',
          }}
        />
      ) : null}

      {/* Marca del portal y de la corredora */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderRadius: 999,
            padding: '10px 22px',
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>Rix7</span>
          <span style={{ fontSize: 20, color: '#475569' }}>Portal Inmobiliario</span>
        </div>

        {partnerName ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              backgroundColor: 'rgba(255,255,255,0.95)',
              borderRadius: 999,
              padding: '8px 20px 8px 10px',
            }}
          >
            {logo ? (
              <img src={logo} alt="" width={44} height={44} style={{ objectFit: 'contain' }} />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  backgroundColor: partnerColor,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                {initial}
              </div>
            )}
            <span style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>{partnerName}</span>
          </div>
        ) : null}
      </div>

      {/* Precio y título */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {badge ? (
          <span style={{ fontSize: 22, fontWeight: 700, color: '#dbeafe', letterSpacing: 1 }}>
            {badge.toUpperCase()}
          </span>
        ) : null}

        {price ? (
          <span style={{ fontSize: 76, fontWeight: 800, color: '#ffffff', marginTop: 6 }}>
            {price}
          </span>
        ) : null}

        <span
          style={{
            fontSize: price ? 34 : 52,
            fontWeight: 700,
            color: '#f8fafc',
            marginTop: 12,
            lineHeight: 1.2,
          }}
        >
          {title}
        </span>

        {place ? (
          <span style={{ fontSize: 26, color: '#cbd5e1', marginTop: 12 }}>{place}</span>
        ) : null}
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: { id: string } }) {
  const property: Property | null = await fetchPropertyById(params.id);

  if (!property) {
    return new ImageResponse(
      card({ title: 'Propiedad no disponible', place: 'Rix7 · Portal Inmobiliario', partnerColor: '#1d4ed8' }),
      { ...size, headers: CACHE_HEADERS }
    );
  }

  const partner = property.partner_id ? await getPartnerById(property.partner_id) : undefined;
  const isRent = property.status === 'for_rent';

  const head = headers();
  const origin = selfOrigin(head.get('host'), head.get('x-forwarded-proto'));

  const [photo, logo] = await Promise.all([
    toDataUri(property.images?.[0], origin),
    toDataUri(partner?.logo, origin),
  ]);

  return new ImageResponse(
    card({
      photo,
      logo,
      price: formatPrice(property.price, 'CLP', 'es-CL', isRent),
      badge: `${getStatusLabel(property.status)} · ${getPropertyTypeLabel(property.property_type)}`,
      // El título de la corredora, no el de la tarjeta del enlace: el precio ya
      // está arriba en grande, y repetirlo abajo se leía como un error.
      title: truncateAtWord(property.title || 'Propiedad', 90),
      place: buildShareFacts({
        title: property.title,
        property_type: property.property_type,
        status: property.status,
        price: property.price,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        area_sqm: property.area_sqm,
        city: property.city,
      }),
      partnerName: partner?.name,
      partnerColor: partner?.color || '#1d4ed8',
    }),
    { ...size, headers: CACHE_HEADERS }
  );
}
