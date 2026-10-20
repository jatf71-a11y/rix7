'use client';

import React, { useEffect, useState } from 'react';
import {
  Copy,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  Send,
  Share2,
  Twitter,
  X,
} from 'lucide-react';
import type { PanelProperty } from '@/lib/data/propertiesStore';
import { useAuth } from '@/components/auth/AuthProvider';
import { buildShareLinks, shareText } from '@/lib/utils/shareLinks';
import { trackShareEvent } from '@/lib/utils/shareTracking';
import { formatPrice } from '@/lib/utils/formatters';

/**
 * Selector de redes para compartir una publicación del panel.
 *
 * Un modal con la lista de destinos (la "selección" pedida): cada red abre su
 * endpoint de compartir en pestaña nueva con `noopener`; Instagram, que no
 * tiene endpoint web, **copia el enlace** y abre Instagram para pegarlo — con
 * el aviso a la vista, para que no parezca que el botón no hizo nada.
 *
 * El enlace apunta a `/compartir/[id]`, la landing pensada para compartir
 * (tarjeta OG con precio y fotos), no a la ficha: es la URL que ya usa el
 * portal cuando la corredora comparte desde la ficha.
 */
const NETWORK_ICONS = {
  whatsapp: MessageCircle,
  facebook: Facebook,
  x: Twitter,
  instagram: Instagram,
  telegram: Send,
  linkedin: Linkedin,
  email: Mail,
} as const;

export default function ShareDialog({
  property,
  onClose,
}: {
  property: PanelProperty;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/compartir/${property.id}`;
  const text = shareText({
    title: property.title,
    price: property.price,
    isRent: property.status === 'for_rent',
  });
  const links = buildShareLinks({ url, text });

  /**
   * Registra el compartido del socio con la identidad de su cuenta.
   *
   * El panel no es la ficha pública: acá la persona ya está autenticada, así
   * que el evento queda atribuido a su correo y a su corredora. Sin sesión (el
   * bypass de desarrollo) no se inventa una identidad y no se registra nada.
   */
  const trackShare = (channel: 'whatsapp' | 'copy' | 'share') => {
    if (!user?.email) return;
    const metadata = user.user_metadata ?? {};
    const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
    trackShareEvent({
      propertyId: property.id,
      partnerId: property.partner_id ?? null,
      channel,
      source: 'panel',
      registration: {
        name: fullName || user.email.split('@')[0],
        email: user.email,
        phone: typeof metadata.phone === 'string' ? metadata.phone : undefined,
      },
      shareUrl: url,
    });
  };

  // El compartir nativo (celular, menú del sistema) solo si el navegador lo
  // ofrece; en desktop no se muestra un botón que no va a hacer nada.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyLink(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      // Sin permiso de portapapeles (http:// o navegador viejo): el fallback
      // clásico con un textarea temporal sigue funcionando en todos lados.
      try {
        const area = document.createElement('textarea');
        area.value = url;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function handleInstagram() {
    const ok = await copyLink();
    if (ok) trackShare('copy');
    setClipboardNote(
      ok
        ? 'Enlace copiado. Pégalo en tu historia o publicación de Instagram.'
        : 'No se pudo copiar el enlace: cópialo de la barra de direcciones.'
    );
    window.open('https://www.instagram.com/', '_blank', 'noopener');
  }

  async function handleCopy() {
    const ok = await copyLink();
    if (ok) trackShare('copy');
    setClipboardNote(ok ? 'Enlace copiado.' : 'No se pudo copiar el enlace.');
  }

  async function handleNative() {
    try {
      await navigator.share({ title: property.title, text, url });
      trackShare('share');
    } catch {
      // Cancelar el share del sistema no es un error que mostrar.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Compartir ${property.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Compartir en…</h2>
            <p className="text-xs text-slate-500 truncate mt-0.5">{property.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-slate-400 mb-4 truncate" title={url}>
          {url.replace(/^https?:\/\//, '')}
        </p>

        <div className="grid grid-cols-3 gap-2">
          {links.map((link) => {
            const Icon = NETWORK_ICONS[link.id];
            if (!link.href) {
              return (
                <button
                  key={link.id}
                  onClick={handleInstagram}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-2 py-3 hover:border-pink-300 hover:bg-pink-50 transition-colors"
                >
                  <Icon className="w-5 h-5 text-pink-600" />
                  <span className="text-[11px] font-semibold text-slate-700">{link.label}</span>
                </button>
              );
            }
            return (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackShare(link.id === 'whatsapp' ? 'whatsapp' : 'share')}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 px-2 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <Icon className="w-5 h-5 text-slate-600" />
                <span className="text-[11px] font-semibold text-slate-700">{link.label}</span>
              </a>
            );
          })}
        </div>

        <div className="mt-3 space-y-2">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Copy className="w-4 h-4" />
            Copiar enlace
          </button>
          {canNativeShare && (
            <button
              onClick={handleNative}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <Share2 className="w-4 h-4" />
              Compartir con las apps del dispositivo
            </button>
          )}
        </div>

        {clipboardNote && (
          <p className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {clipboardNote}
          </p>
        )}

        <p className="mt-3 text-[11px] text-slate-400">
          Se comparte la landing con precio y fotos; la dirección exacta nunca
          aparece en el enlace.
        </p>
      </div>
    </div>
  );
}
