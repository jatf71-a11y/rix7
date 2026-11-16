'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

/**
 * Widget de Cloudflare Turnstile para formularios públicos.
 *
 * Solo se dibuja si hay `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Sin esa clave no hay
 * desafío que mostrar y el servidor deja pasar (ver `lib/utils/turnstile.ts`),
 * así que el formulario sigue funcionando en entornos sin configurar.
 *
 * `onToken` recibe el token resuelto (o '' cuando caduca) y el formulario lo
 * envía como `turnstileToken` en el cuerpo.
 */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const renderWidget = () => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(''),
      'error-callback': () => onTokenRef.current(''),
    });
  };

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <div ref={containerRef} className="flex justify-center" />
    </>
  );
}
