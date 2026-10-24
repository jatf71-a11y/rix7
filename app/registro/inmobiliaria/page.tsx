import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Building, Landmark, PanelsTopLeft } from 'lucide-react';
import RegistrationForm from '@/components/solicitudes/RegistrationForm';

/**
 * Registro de inmobiliarias.
 *
 * Comparte la base con el registro de corredoras, pero es una ruta y un `kind`
 * distintos: una inmobiliaria/desarrolladora publica proyectos y stock propio,
 * no necesariamente intermedia propiedades de terceros. Los campos propios de
 * este registro se definirán después; el registro inicial ya queda separado en
 * la base y en el panel.
 */

export const metadata: Metadata = {
  title: 'Registro de inmobiliarias | Rix7',
  description:
    'Registra tu inmobiliaria o desarrolladora para publicar proyectos y stock propio en Rix7.',
};

export default function RegistroInmobiliariaPage() {
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
          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
            Empresa
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Registra tu inmobiliaria
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Si representas a una inmobiliaria o desarrolladora, registra la empresa para
            publicar tus proyectos y stock propio con un perfil dentro de Rix7. La
            verificación de identidad, reputación y dominio es automática al enviar.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Landmark,
              title: 'Perfil de empresa',
              detail: 'Tu marca y tus proyectos en una página pública.',
            },
            {
              icon: Building,
              title: 'Stock propio',
              detail: 'Publica y administra las propiedades de la inmobiliaria.',
            },
            {
              icon: PanelsTopLeft,
              title: 'Panel de gestión',
              detail: 'Un solo lugar para el equipo y las publicaciones.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-bold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <RegistrationForm kind="inmobiliaria" />
        </div>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
          La verificación no habilita la publicación por sí sola: si la empresa queda
          aceptada, eliges el plan y el panel queda habilitado.
        </p>
      </div>
    </div>
  );
}
