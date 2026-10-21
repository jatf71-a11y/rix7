/**
 * Links de compartir por red social para el panel del socio.
 *
 * Módulo puro: nada de abrir ventanas ni tocar el DOM acá — solo se **construyen
 * los destinos**; quién abre qué lo decide el diálogo (`ShareDialog`). Tenerlo
 * puro es lo que permite probar el encoding sin navegador (un `&` sin codificar
 * rompe el texto en WhatsApp y Facebook lo devuelve como error 400).
 *
 * Criterio por red:
 *
 * - **WhatsApp / Telegram / X / LinkedIn / Facebook** tienen endpoint web de
 *   compartir: URL directa con el enlace y el texto ya codificados.
 * - **Instagram no acepta compartir desde la web** (no hay endpoint público):
 *   se le ofrece el flujo honesto — copiar el enlace y abrir Instagram para
 *   pegarlo en la historia o publicación. `href: null` marca ese caso.
 * - **Email** abre el cliente de correo con asunto y cuerpo.
 */
import { formatPrice } from './formatters';

export type ShareNetworkId =
  | 'whatsapp'
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'telegram'
  | 'linkedin'
  | 'email';

export interface ShareNetwork {
  id: ShareNetworkId;
  label: string;
  /** `null` = la red no tiene endpoint web: toca copiar y abrir la app. */
  href: string | null;
  /** Aviso que el diálogo muestra junto a la red (solo cuando hace falta). */
  note?: string;
}

export interface ShareInput {
  /** URL absoluta de la ficha o landing. */
  url: string;
  /** Texto que acompaña al enlace. */
  text: string;
}

/**
 * Texto por defecto: título, precio y portal.
 * El precio se formatea en CLP con el mismo helper de la ficha, para que el
 * mensaje del chat coincida con lo que verá quien haga clic.
 */
export function shareText(input: { title: string; price: number; isRent?: boolean }): string {
  const price = formatPrice(input.price, 'CLP', 'es-CL', input.isRent ?? false);
  return `${input.title} · ${price} — Rix7`;
}

/** Los destinos de compartir, con URL y texto ya codificados. */
export function buildShareLinks({ url, text }: ShareInput): ShareNetwork[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);

  return [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      // En WhatsApp el enlace va DENTRO del texto: es lo que se comparte.
      href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    },
    {
      id: 'x',
      label: 'X (Twitter)',
      href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    },
    {
      id: 'instagram',
      label: 'Instagram',
      href: null,
      note: 'Instagram no permite compartir desde la web: copiamos el enlace para que lo pegues en tu historia o publicación.',
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: `https://t.me/share/url?url=${u}&text=${t}`,
    },
    {
      id: 'linkedin',
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    },
    {
      id: 'email',
      label: 'Correo',
      // El cuerpo lleva el texto y la landing, no solo la URL: quien lo recibe
      // por correo ve de qué se trata antes de abrir el enlace.
      href: `mailto:?subject=${t}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
    },
  ];
}
