import { ImageResponse } from 'next/og';
import {
  CACHE_HEADERS,
  SHARE_CARD_UNAVAILABLE,
  ShareCardLandscape,
  loadShareCard,
} from '@/app/compartir/[id]/ShareCard';

/**
 * Tarjeta Open Graph de una ficha (`/properties/[id]`) — plan fase 3, 2.3.
 *
 * Hasta ahora todas las fichas compartían la tarjeta genérica del sitio en
 * redes y chats; la tarjeta bonita con foto y precio solo existía para el
 * enlace de `/compartir`. El lienzo 1200×630 ya estaba construido y probado
 * (`ShareCardLandscape`), así que acá no se dibuja nada nuevo: se reutiliza
 * tal cual, con el mismo cargador (`loadShareCard`) y la misma caída elegante
 * a "Propiedad no disponible" cuando el id ya no existe.
 *
 * **Runtime Node, y no edge**, por la misma razón que el de `/compartir`:
 * `next/og` (satori + resvg) supera el límite de 1 MB de las Edge Functions
 * del plan Hobby, y el bug de Next en Windows con las fuentes ya quedó
 * parcheado en `postinstall` para el runtime Node.
 */
export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Propiedad en Rix7';

export default async function Image({ params }: { params: { id: string } }) {
  const data = (await loadShareCard(params.id)) ?? SHARE_CARD_UNAVAILABLE;

  return new ImageResponse(<ShareCardLandscape data={data} />, {
    ...size,
    headers: CACHE_HEADERS,
  });
}
