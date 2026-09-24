import { headers } from 'next/headers';
import { fetchPropertyById } from '@/lib/data/propertyLookup';
import { getPartnerById } from '@/lib/data/partners-store';
import { buildShareFacts, shareLinkLabel, truncateAtWord } from '@/lib/utils/shareMeta';
import { formatPrice, getPropertyTypeLabel, getStatusLabel } from '@/lib/utils/formatters';
import { SITE_URL } from '@/lib/site';

/**
 * La tarjeta gráfica de una ficha compartida: la imagen que se manda por
 * WhatsApp.
 *
 * Hay dos formatos del mismo contenido, y por eso el lienzo vive acá y no dentro
 * de cada route:
 *
 * - **Horizontal 1200×630** — la tarjeta de vista previa (Open Graph): la muestra
 *   el chat por su cuenta, sin que nadie la pida. El enlace viene escrito en el
 *   propio mensaje, así que imprimirlo otra vez sería redundante.
 * - **Vertical 1080×1350** — la que la corredora **descarga y adjunta** a mano.
 *   Es la proporción que WhatsApp muestra completa, sin recortar, así que la foto
 *   ocupa más y el precio va más grande. Acá el enlace **sí** se imprime al pie:
 *   la imagen viaja sola, sin texto que la acompañe, y sin el enlace impreso quien
 *   la recibe no tiene cómo llegar a la ficha.
 *
 * Decisiones que no son obvias:
 *
 * - **Las imágenes se convierten a `data:` antes de dibujarlas.** Satori descarga
 *   cada `src` por su cuenta y, si alguna falla, la tarjeta entera no se genera:
 *   el enlace se compartiría sin imagen. Trayéndolas acá el fallo se detecta a
 *   tiempo y se cae a una tarjeta sin foto, que sigue siendo buena.
 * - **Un logo SVG no se intenta dibujar.** Satori no rasteriza SVG arbitrario y
 *   fallaría la tarjeta completa; en ese caso se usa la inicial sobre el color de
 *   la marca, que es el mismo recurso que usa el sitio.
 * - **Corre en el runtime edge** (lo declaran las dos routes), y no por velocidad:
 *   el bundle de `next/og` para Node lee las fuentes del disco **al importarse** y
 *   en Windows esa ruta se arma mal, así que la imagen moría con un 500 antes de
 *   dibujar. El bundle de edge las pide por `fetch`. Por eso acá no hay `node:fs`
 *   ni `Buffer`: los assets locales se piden por HTTP y el base64 se arma a mano.
 * - **Sin gradientes con `rgba()`**: el parser de fondos de satori se cae con ellos
 *   ("Cannot read properties of undefined (reading 'trim')") y una tarjeta que no
 *   se genera deja el enlace sin imagen.
 */

/**
 * Un rato de caché en el borde: generar la tarjeta implica bajar la foto y
 * rasterizar. Una hora alcanza para que un enlace que circula no la regenere en
 * cada apertura, y es corto como para que un cambio de precio o de foto se vea el
 * mismo día.
 */
export const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};

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

  // Solo se descarta acá lo que se sabe que satori no dibuja (un `.svg` local, por
  // ejemplo). El resto se decide con el `content-type` de la respuesta: las fotos
  // de un CDN suelen no tener extensión (`images.unsplash.com/photo-150…`), y
  // exigir una era descartar toda foto remota en silencio.
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

export interface ShareCardData {
  /** Foto de portada, ya convertida a `data:` (o ausente si no se pudo traer). */
  photo?: string;
  /** Logo de la corredora, ya convertido a `data:`. */
  logo?: string;
  price: string;
  title: string;
  /** Especificación corta: "2 dormitorios · 2 baños · 95 m² · Las Condes". */
  facts: string;
  badge: string;
  partnerName?: string;
  partnerColor: string;
  /** Enlace sin protocolo, para imprimirlo al pie de la tarjeta vertical. */
  link: string;
}

/**
 * Tarjeta de reemplazo cuando el id no existe o la propiedad no se puede leer.
 * No es un error: un enlace compartido que ya no está tiene que mostrar algo
 * presentable en el chat, no un 404 con el cuadro roto.
 */
export const SHARE_CARD_UNAVAILABLE: ShareCardData = {
  price: '',
  title: 'Propiedad no disponible',
  facts: 'Rix7 · Portal Inmobiliario',
  badge: '',
  partnerColor: '#1d4ed8',
  link: '',
};

/**
 * Junta todo lo que las dos tarjetas dibujan, ya resuelto: propiedad (catálogo,
 * Supabase o API), corredora, foto y logo como `data:`.
 *
 * Devuelve `null` cuando la propiedad no existe, para que cada route decida con
 * qué la reemplaza.
 */
export async function loadShareCard(id: string): Promise<ShareCardData | null> {
  const property = await fetchPropertyById(id);
  if (!property) return null;

  const partner = property.partner_id ? await getPartnerById(property.partner_id) : undefined;

  const head = headers();
  const origin = selfOrigin(head.get('host'), head.get('x-forwarded-proto'));

  const [photo, logo] = await Promise.all([
    toDataUri(property.images?.[0], origin),
    toDataUri(partner?.logo, origin),
  ]);

  const isRent = property.status === 'for_rent';

  return {
    photo,
    logo,
    price: formatPrice(property.price, 'CLP', 'es-CL', isRent),
    // El título de la corredora, no el de la tarjeta del enlace: el precio ya está
    // aparte y repetirlo se leía como un error.
    title: truncateAtWord(property.title || 'Propiedad', 90),
    facts: buildShareFacts({
      title: property.title,
      property_type: property.property_type,
      status: property.status,
      price: property.price,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      area_sqm: property.area_sqm,
      city: property.city,
    }),
    badge: `${getStatusLabel(property.status)} · ${getPropertyTypeLabel(property.property_type)}`,
    partnerName: partner?.name,
    partnerColor: partner?.color || '#1d4ed8',
    link: shareLinkLabel(`${SITE_URL}/compartir/${property.id}`),
  };
}

/** Pastilla de marca blanca, para leer sobre cualquier foto. */
function brandPill(text: string) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 999,
        padding: '10px 22px',
      }}
    >
      <span style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{text}</span>
    </div>
  );
}

/** La inicial sobre el color de la marca: reemplazo cuando el logo no se puede dibujar. */
function partnerBadge(name: string | undefined, color: string, size: number) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: color,
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size / 2),
        fontWeight: 800,
      }}
    >
      {(name || 'R').charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Lienzo horizontal 1200×630 — la tarjeta de vista previa del enlace.
 *
 * Se dibuja igual con foto que sin ella: sin foto el fondo pasa a la marca, pero
 * el precio y el nombre de la corredora son los mismos. El precio es el elemento
 * más grande porque es el dato que decide si alguien abre el enlace.
 */
export function ShareCardLandscape({ data }: { data: ShareCardData }) {
  const { photo, logo, price, title, facts, badge, partnerName, partnerColor } = data;

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
          : {
              backgroundColor: '#0f172a',
              backgroundImage: `linear-gradient(135deg, #0f172a 0%, ${partnerColor} 100%)`,
            }),
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
        fondos de satori se cae con los gradientes cuyos colores son `rgba(…)`, y
        una tarjeta que no se genera deja el enlace sin imagen.
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
              partnerBadge(partnerName, partnerColor, 44)
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

        {facts ? (
          <span style={{ fontSize: 26, color: '#cbd5e1', marginTop: 12 }}>{facts}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Lienzo vertical 1080×1350 — la tarjeta que la corredora descarga y adjunta.
 *
 * Se parte en dos mitades: la foto arriba (58 %) y un panel blanco abajo con el
 * precio, el título y el pie. El panel es blanco y opaco a propósito: sobre la
 * foto, el precio tendría que competir con lo que muestre la imagen, y esta
 * tarjeta circula sin más contexto que ella misma.
 *
 * Al pie van las tres cosas que hacen que la imagen sirva sola: **quién** la
 * ofrece (logo y nombre de la corredora), **de dónde** sale (Rix7) y **adónde ir**
 * (el enlace impreso). Sin el enlace, quien recibe la imagen no tiene forma de
 * llegar a la ficha; es la única tarjeta del proyecto que lo imprime, porque es
 * la única que viaja sin texto que la acompañe.
 */
export function ShareCardPortrait({ data }: { data: ShareCardData }) {
  const { photo, logo, price, title, facts, badge, partnerName, partnerColor, link } = data;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ffffff',
      }}
    >
      {/* ═══ Foto ═══ */}
      <div
        style={{
          width: 1080,
          height: 780,
          display: 'flex',
          position: 'relative',
          // Sin foto, el bloque se pinta con el color de la corredora en vez de
          // quedar un hueco negro: la tarjeta sigue teniendo identidad.
          backgroundColor: photo ? '#0f172a' : partnerColor,
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            width={1080}
            height={780}
            style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
          />
        ) : null}

        {badge ? (
          <div
            style={{
              position: 'absolute',
              top: 44,
              left: 44,
              display: 'flex',
              backgroundColor: 'rgba(2,6,23,0.72)',
              borderRadius: 999,
              padding: '12px 26px',
            }}
          >
            <span style={{ fontSize: 26, fontWeight: 700, color: '#ffffff', letterSpacing: 1 }}>
              {badge.toUpperCase()}
            </span>
          </div>
        ) : null}

        <div style={{ position: 'absolute', top: 44, right: 44, display: 'flex' }}>
          {brandPill('Rix7')}
        </div>
      </div>

      {/* ═══ Panel de datos y pie ═══ */}
      <div
        style={{
          width: 1080,
          height: 570,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '46px 56px 40px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {price ? (
            <span style={{ fontSize: 64, fontWeight: 800, color: '#0f172a', lineHeight: 1.05 }}>
              {price}
            </span>
          ) : null}

          <span
            style={{
              fontSize: price ? 36 : 52,
              fontWeight: 700,
              color: '#334155',
              marginTop: price ? 16 : 0,
              lineHeight: 1.25,
            }}
          >
            {title}
          </span>

          {/*
            La especificación se dibuja solo si hay precio, es decir si hay ficha.
            En la tarjeta de reemplazo esa línea no describe nada ("Rix7 · Portal
            Inmobiliario") y el pie ya lleva la marca: repetirla a un renglón de
            distancia se lee como un descuido.
          */}
          {facts && price ? (
            <span style={{ fontSize: 27, color: '#64748b', marginTop: 16 }}>{facts}</span>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 2, backgroundColor: '#e2e8f0', marginBottom: 26 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {logo ? (
              <img src={logo} alt="" width={56} height={56} style={{ objectFit: 'contain' }} />
            ) : (
              partnerBadge(partnerName, partnerColor, 56)
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>
                {truncateAtWord(partnerName || 'Rix7', 26)}
              </span>
              <span style={{ fontSize: 22, color: '#94a3b8' }}>Rix7 · Portal Inmobiliario</span>
            </div>
          </div>

          {link ? (
            <span style={{ fontSize: 25, fontWeight: 700, color: '#1d4ed8', marginTop: 22 }}>
              {link}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
