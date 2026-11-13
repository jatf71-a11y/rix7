'use client';

import React, { useState } from 'react';
import { Check, Copy, Link2, Mail } from 'lucide-react';

import { SITE_URL } from '@/lib/site';

/**
 * Enlace propio del socio (`/socio/<slug>`), para pasárselo.
 *
 * El panel tiene URL por corredora, pero hasta acá el equipo no tenía cómo
 * mandarla sin armarla a mano. Copiar es lo que se usa cuando el aviso va por
 * WhatsApp; el correo abre el cliente de quien atiende, con el enlace ya escrito
 * y —si la ficha tiene correo de contacto— dirigido, sin inventar destinatario.
 */
export default function PartnerPanelLink({
  slug,
  name,
  contactEmail,
}: {
  slug: string;
  name: string;
  contactEmail?: string | null;
}) {
  const url = `${SITE_URL}/socio/${slug}`;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('El navegador no dejó copiar: seleccioná el enlace y copialo a mano.');
    }
  }

  const subject = `Tu panel de ${name} en Rix7`;
  const body = [
    'Hola:',
    '',
    `Este es el enlace directo a tu panel de ${name} en Rix7:`,
    url,
    '',
    'Entrá con la cuenta que vinculamos a tu corredora. Desde ahí publicás propiedades,',
    'ves los contactos que llegan y administrás tu cuenta.',
    '',
    'Rix7 — Cuenta de empresas',
  ].join('\n');

  const mailto = `mailto:${encodeURIComponent(contactEmail ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

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

        <a
          href={mailto}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Mail className="h-3.5 w-3.5" />
          Enviar por correo
        </a>

        {!contactEmail && (
          <span className="text-[10px] text-slate-400">Sin correo de contacto en la ficha.</span>
        )}
      </div>

      {error && <p role="status" className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
