import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Building2, ChartNoAxesColumn, Globe2 } from 'lucide-react';
import RegistrationForm from '@/components/solicitudes/RegistrationForm';

/**
 * Registro de corredoras.
 *
 * Es una sección propia y no la misma pantalla que inmobiliarias: la
 * acreditación de una corredora y la de una inmobiliaria no van a pedir lo
 * mismo. Hoy comparten el registro inicial y `kind` los separa en la base y en
 * el panel; cuando se definan los formularios completos, cada ruta crece por su
 * lado sin arrastrar a la otra.
 */

export const metadata: Metadata = {
  title: 'Registro de corredoras | Rix7',
  description:
    'Registra tu corredora de propiedades para acreditar la empresa y publicar tu stock en Rix7.',
};

export default function RegistroCorredoraPage() {
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
          <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-800">
            Empresa
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Registra tu corredora
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Para publicar en Rix7 tu corredora tiene que estar registrada y verificada.
            Completa los datos: el RUT, el registro comercial, la reputación, el sitio y el
            correo se verifican automáticamente al enviar.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Globe2,
              title: 'Página de empresa',
              detail: 'Tu marca, contacto y stock en una URL pública.',
            },
            {
              icon: Building2,
              title: 'Panel de publicaciones',
              detail: 'Publica, edita y da de baja tu stock.',
            },
            {
              icon: ChartNoAxesColumn,
              title: 'Contactos y métricas',
              detail: 'Sigue los enlaces compartidos y los interesados.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="text-xs font-bold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <RegistrationForm kind="corredora" />
        </div>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
          La verificación no habilita la publicación por sí sola: si la empresa queda
          aceptada, eliges el plan y el panel queda habilitado.
        </p>
      </div>
    </div>
  );
}
