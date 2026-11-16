'use client';

import React, { useState } from 'react';
import { Check, Copy, Link2, Loader2, Mail } from 'lucide-react';

import { SITE_URL } from '@/lib/site';

/**
 * Enlace propio del socio (`/socio/<slug>`), para pasárselo.
 *
 * Copiar es lo que se usa cuando el aviso va por WhatsApp. El correo ya no abre
 * el cliente de quien atiende: lo manda el servidor con la plantilla de Rix7 al
 * correo de contacto de la ficha, así que sale del dominio del portal, queda
 * igual para todos los socios y no depende de que el equipo tenga un cliente de
 * correo configurado.
 *
 * El destinatario lo elige la ficha, no esta pantalla: el cuerpo del pedido solo
 * lleva el id del socio.
 */
export default function PartnerPanelLink({
  partnerId,
  slug,
  name,
  contactEmail,
}: {
  partnerId: string;
  slug: string;
  name: string;
  contactEmail?: string | null;
}) {
  const url = `${SITE_URL}/socio/${slug}`;
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function copy() {
    setMessage(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage('El navegador no dejó copiar: seleccioná el enlace y copialo a mano.');
    }
  }

  async function send() {
    setStatus('sending');
    setMessage(null);
    try {
      const response = await fetch('/api/admin/partners/panel-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setStatus('error');
        setMessage(data?.error ?? 'No se pudo enviar el correo.');
        return;
      }

      setStatus('sent');
      setMessage(`Enviado a ${data.to ?? contactEmail ?? 'el correo de la ficha'}.`);
    } catch {
      setStatus('error');
      setMessage('No hubo respuesta del servidor: revisá la conexión y reintentá.');
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
      <div className="flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-700">Enlace del panel</span>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        Cada socio entra por su propia dirección, sin pasar por el botón del portal.
      </p>

      <p className="mt-2 truncate rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700" title={url}>
        {url}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>

        <button
          type="button"
          onClick={send}
          disabled={!contactEmail || status === 'sending'}
          title={contactEmail ? `Enviar a ${contactEmail}` : 'La ficha no tiene correo de contacto'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'sending' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mail className="h-3.5 w-3.5" />
          )}
          {status === 'sending' ? 'Enviando…' : 'Enviar por correo'}
        </button>

        {!contactEmail && (
          <span className="text-[10px] text-slate-400">Sin correo de contacto en la ficha.</span>
        )}
      </div>

      {message && (
        <p
          role="status"
          className={`mt-2 text-[11px] ${status === 'error' ? 'text-red-600' : 'text-emerald-600'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
