import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { kybPlanChoicesByToken } from '@/lib/kyb/onboarding';
import PlanChoice from './PlanChoice';

/**
 * Elección de plan, del lado de la empresa.
 *
 * Es el enlace que llega en el correo de **Calificado**: muestra los tres planes
 * con los montos de **Planes** y, al elegir uno, arma la propuesta comercial con
 * ese precio. Antes el correo anunciaba un plan fijo y la empresa solo podía
 * decir «de acuerdo»; acá elige con números a la vista.
 *
 * `noindex`: lleva un token en la URL y es una pantalla de trámite.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Elige tu plan | Rix7',
  robots: { index: false, follow: false },
};

export default async function PlanPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const view = await kybPlanChoicesByToken(searchParams.token ?? '');

  if (!view.ok || !view.plans || !view.legalName) {
    return (
      <div className="bg-slate-50 py-16">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <AlertCircle className="h-6 w-6 text-slate-500" />
          </div>
          <h1 className="text-lg font-black text-slate-900">Este enlace no es válido</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {view.error ??
              'El enlace que abriste no existe o ya se usó. Responde el último correo de Rix7 para que te enviemos uno nuevo.'}
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Volver al portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 py-12">
      <div className="mx-auto max-w-4xl px-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
          Alta de empresas · Rix7
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{view.legalName}</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Tu empresa quedó calificada. Elige el plan con el que quieres operar y te mostramos la
          propuesta con esos montos.
        </p>

        <PlanChoice
          token={searchParams.token ?? ''}
          plans={view.plans}
          profileLabel={view.profileLabel ?? 'Profesional'}
          captacionMonthlyClp={view.captacionMonthlyClp ?? 0}
        />
      </div>
    </div>
  );
}
