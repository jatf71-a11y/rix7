import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { kybProposalByToken } from '@/lib/kyb/onboarding';
import { formatPlanPrice } from '@/lib/kyb/plans';
import { proposalPlanName } from '@/lib/kyb/proposal';
import StageProgress from '@/components/kyb/StageProgress';
import ProposalDecision from './ProposalDecision';

/**
 * La propuesta comercial, del lado del candidato.
 *
 * Es la pantalla del enlace que llega por correo: muestra el plan, el alta
 * inicial y la mensualidad, y deja aceptar o rechazar. Antes de aceptar no se
 * habilita nada —la aceptación mueve la solicitud a `Alta` y emite el enlace
 * para elegir plan— y el pago sigue siendo el último paso antes de operar.
 *
 * Junto con el «de acuerdo» se decide si contrata o no el plan de captación. El
 * CCA no aparece: se resuelve después del alta, desde el panel del socio. Los
 * precios llegan resueltos del servidor.
 *
 * `noindex`: lleva un token en la URL y es una pantalla de trámite.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Propuesta comercial | Rix7',
  robots: { index: false, follow: false },
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <AlertCircle className="h-6 w-6 text-slate-500" />
      </div>
      <h1 className="text-lg font-black text-slate-900">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        Volver al portal
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value}</span>
    </div>
  );
}

export default async function ProposalPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const view = await kybProposalByToken(searchParams.token ?? '');

  if (!view.ok || !view.proposal || !view.legalName) {
    return (
      <div className="bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Notice
            title="Este enlace no es válido"
            body={
              view.error ??
              'El enlace que abriste no existe o ya se usó. Responde el último correo de Rix7 para que te enviemos uno nuevo.'
            }
          />
        </div>
      </div>
    );
  }

  const proposal = view.proposal;
  const planName = proposalPlanName(proposal.planId);

  return (
    <div className="bg-slate-50 py-12">
      <div className="mx-auto max-w-2xl px-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
            Propuesta comercial · Rix7
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            {view.legalName}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Tu empresa quedó calificada. Esta es la propuesta con la que operarías en el portal.
          </p>

          <StageProgress
            status="Propuesta_Comercial"
            className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
          />

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
            <Row label="Plan" value={planName} />
            <Row label="Alta inicial" value={formatPlanPrice(proposal.altaClp)} />
            <Row label="Mensualidad" value={`${formatPlanPrice(proposal.monthlyClp)} /mes`} />
          </div>

          {proposal.note ? (
            <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-900">
              {proposal.note}
            </p>
          ) : null}

          <div className="mt-6">
            <ProposalDecision
              token={searchParams.token ?? ''}
              legalName={view.legalName}
              decision={proposal.decision}
              captacionMonthlyClp={view.captacionMonthlyClp ?? 0}
              profileLabel={view.profileLabel ?? 'Profesional'}
              captacion={view.captacion ?? { ventas: [], arriendos: [] }}
              commercial={proposal.commercial}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
