import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PartnerLogo } from '@/components/properties/PartnerLogo';
import { getPartnerBySlug } from '@/lib/data/partners-store';
import { requireMember } from '@/lib/supabase/auth-guard';

import SocioPanelPage from '../page';

/**
 * Entrada propia de cada socio: `/socio/catedral`, `/socio/corredora-4204`.
 *
 * El panel ya estaba acotado por sesión, pero entrar siempre por el botón del
 * home obliga a un paso de más —y a que el socio recuerde una ruta genérica—.
 * Con esta ruta cada corredora tiene su enlace: se lo puede mandar por correo,
 * dejarlo en favoritos o, más adelante, usarlo como base de su propia app.
 *
 * Tres estados, explícitos:
 *
 * - **Cuenta de este socio**: ve su panel. La identidad de la cabecera la pone
 *   el layout, que lee la misma sesión.
 * - **Sin sesión**: la pantalla explica de qué corredora es el panel y ofrece
 *   entrar; al hacerlo vuelve a esta misma URL, ya con su panel.
 * - **Sesión de otra corredora**: no se muestra nada de esta empresa. Se dice
 *   el motivo y se ofrece el panel propio, en vez de mezclar dos cuentas bajo
 *   una URL que no les corresponde.
 *
 * El slug identifica la entrada, **no autoriza**: lo que se lee y escribe sigue
 * saliendo del `partner_id` de la sesión en las rutas de API.
 */

export const metadata: Metadata = {
  title: 'Panel Socios | Rix7',
  robots: { index: false, follow: false },
};

export default async function SocioPorSlugPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const partner = await getPartnerBySlug(slug).catch(() => undefined);
  if (!partner) notFound();

  const guard = await requireMember({ allowPendingMfa: true });

  if (guard.ok && guard.partnerId !== partner.id) {
    return (
      <div className="max-w-xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-base font-black text-slate-900">
            Este panel es de {partner.name}
          </h1>
          <p className="mt-2 text-sm text-amber-800">
            Tu cuenta pertenece a otra corredora, así que acá no se muestra nada de esta
            empresa. Entrá a tu propio panel y vas a ver tus publicaciones.
          </p>
          <Link
            href="/socio"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Ir a mi panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sin sesión, la cabecera del shell no tiene de quién tomar la
          identidad: la empresa se nombra acá, para que quien abra el enlace
          sepa que llegó al lugar correcto antes de entrar. */}
      {!guard.ok && (
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <PartnerLogo
              logo={partner.logo ?? undefined}
              name={partner.name}
              color={partner.color ?? '#1d4ed8'}
              className="h-9 w-9 text-lg"
              decorative
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-slate-900">{partner.name}</h1>
            <p className="text-xs text-slate-500">Panel Socios · entrá con tu cuenta para publicar</p>
          </div>
        </div>
      )}

      <SocioPanelPage />
    </>
  );
}
