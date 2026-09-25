import { ImageResponse } from 'next/og';
import {
  CACHE_HEADERS,
  SHARE_CARD_UNAVAILABLE,
  ShareCardLandscape,
  loadShareCard,
} from './ShareCard';

/**
 * Tarjeta de vista previa del enlace compartido (la imagen que muestra WhatsApp
 * antes del clic).
 *
 * Acá solo va lo que es propio de una imagen de Open Graph: el tamaño, el tipo y
 * la ruta que Next publica sola. El lienzo y los datos viven en `ShareCard`, que
 * es el mismo que dibuja la tarjeta vertical que la corredora descarga.
 *
 * **Runtime Node, y no edge.** El edge parecía la opción natural —es más liviano y
 * arranca antes—, pero el plan Hobby de Vercel **limita cada Edge Function a
 * 1 MB** y `next/og` (satori + resvg) ya pesa **1.05 MB**: medido por Vercel, el
 * deploy fallaba con "The Edge Function … size is 1.05 MB and your plan size limit
 * is 1 MB". Una función Node no tiene ese tope, así que acá es la única salida.
 *
 * El costo de ese cambio es un bug de Next en Windows (`ERR_INVALID_URL` al
 * resolver sus fuentes; ver vercel/next.js#77164), que se arregla en
 * `postinstall` con `scripts/patch-next-og.mjs`. Sin ese parche, esta ruta solo
 * funcionaría en el deploy, no en local.
 */
export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Ficha de propiedad compartida en Rix7';

export default async function Image({ params }: { params: { id: string } }) {
  const data = (await loadShareCard(params.id)) ?? SHARE_CARD_UNAVAILABLE;

  return new ImageResponse(<ShareCardLandscape data={data} />, {
    ...size,
    headers: CACHE_HEADERS,
  });
}
