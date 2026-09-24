import { ImageResponse } from 'next/og';
import {
  CACHE_HEADERS,
  SHARE_CARD_UNAVAILABLE,
  ShareCardPortrait,
  loadShareCard,
} from '../ShareCard';

/**
 * Tarjeta vertical 1080×1350 de una ficha compartida: la que la corredora
 * descarga desde la landing y adjunta a mano en WhatsApp.
 *
 * Por qué una route y no la convención `opengraph-image`: Next solo publica sola
 * la imagen de Open Graph. Una segunda imagen —otra proporción, otro uso— tiene
 * que ser una route propia.
 *
 * **Runtime Node.** El edge tiene un tope de 1 MB por función en el plan Hobby de
 * Vercel y `next/og` ya pesa más que eso, así que ninguna de las dos tarjetas cabe
 * ahí (está medido y explicado en `opengraph-image.tsx`). Node no tiene ese tope;
 * a cambio hay que parchear un bug de Next en Windows, que es lo que hace
 * `scripts/patch-next-og.mjs` en `postinstall`.
 *
 * `Content-Disposition: inline` y no `attachment`: si el navegador la bajara
 * siempre, abrir la URL no mostraría nada y no habría forma de revisarla. La
 * descarga la dispara el atributo `download` del botón, que además le pone nombre
 * al archivo.
 */
export const runtime = 'nodejs';

/** Proporción 4:5 — la que WhatsApp muestra entera, sin recortar. */
const SIZE = { width: 1080, height: 1350 };

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const data = (await loadShareCard(params.id)) ?? SHARE_CARD_UNAVAILABLE;

  return new ImageResponse(<ShareCardPortrait data={data} />, {
    ...SIZE,
    headers: { ...CACHE_HEADERS, 'Content-Disposition': 'inline' },
  });
}
