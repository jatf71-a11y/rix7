import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, ReceiptText, UserRound, Wallet } from 'lucide-react';
import RegistrationForm from '@/components/solicitudes/RegistrationForm';

/**
 * Registro de agentes independientes.
 *
 * Es el cuarto camino de «Publicar» y el primero que no es una empresa: un
 * corredor que opera por cuenta propia, sin sociedad detrás. Por eso esta
 * pantalla no promete «página de empresa» ni «acreditación de equipo»: lo que
 * ofrece es una cuenta con panel de publicaciones y un perfil público.
 *
 * Lo que se **no** se le pide es tan importante como lo que se pide: no hay
 * razón social, ni boleta de actividad, ni RUT de empresa, porque un agente no
 * factura — emite boleta de honorarios con su RUT de persona natural. Decirlo
 * explícitamente evita que quien llega acá cierre la pestaña buscando un dato
 * que no tiene.
 */

export const metadata: Metadata = {
  title: 'Registro de agentes independientes | Rix7',
  description:
    'Registra tu actividad como agente de propiedades por cuenta propia y publica tu stock en Rix7. Sin razón social: trabajas con tu RUT de persona natural.',
};

export default function RegistroAgentePage() {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
        <Link
          href="/publicar"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a las opciones
        </Link>

        <div className="mt-5 max-w-3xl">
          <span className="inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-800">
            Cuenta propia
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Regístrate como agente
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Si eres corredor de propiedades y trabajas por cuenta propia, Rix7 te permite publicar
            tu stock desde tu propia cuenta. No pedimos razón social ni boleta de actividad: los
            agentes emiten boleta de honorarios con su RUT de persona natural.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: UserRound,
              title: 'Tu nombre, no una empresa',
              detail: 'Tu perfil público eres tú, con tu zona de trabajo y tu contacto.',
            },
            {
              icon: Wallet,
              title: 'Boleta de honorarios',
              detail: 'No se pide RUT de empresa ni boleta de actividad: trabajas como persona.',
            },
            {
              icon: ReceiptText,
              title: 'Panel de publicaciones',
              detail: 'Publica, edita y da de baja tus propiedades desde tu cuenta.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <div>
                <p className="text-xs font-bold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <RegistrationForm kind="agente" />
        </div>

        <p className="mt-8 flex items-start justify-center gap-2 text-center text-[11px] leading-relaxed text-slate-400">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
          <span className="max-w-xl">
            El registro inicial no habilita la publicación por sí solo: revisamos cada solicitud
            antes de crear la cuenta y su acceso al panel.
          </span>
        </p>
      </div>
    </div>
  );
}
