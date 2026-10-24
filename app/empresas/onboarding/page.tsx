import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import KybOnboarding from './KybOnboarding';

/**
 * Alta de empresas: destino del enlace que viaja en los correos de KYB.
 *
 * La página es privada por diseño —la solicitud se identifica con el token de
 * la URL— así que se marca `noindex` y `no-referrer`: no hay nada que indexar y
 * el token no debe viajar en la cabecera `Referer` si alguien sigue un enlace
 * desde acá.
 *
 * El contenido es un componente de cliente porque el token viene en la query y
 * el estado se consulta a la API; `useSearchParams` obliga a un Suspense, igual
 * que en el panel de empresas.
 */

export const metadata: Metadata = {
  title: 'Alta de empresas | Rix7',
  description: 'Elige tu plan y habilita el panel de publicaciones de tu empresa en Rix7.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function KybOnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-64px)] bg-slate-50" aria-busy="true">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
            <p className="text-sm font-semibold text-slate-400">Cargando tu solicitud…</p>
          </div>
        </div>
      }
    >
      <KybOnboarding />
    </Suspense>
  );
}
