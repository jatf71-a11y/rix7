import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, Clock3, Handshake } from 'lucide-react';
import PropietarioForm from '@/components/solicitudes/PropietarioForm';

/**
 * Propuestas para propietarios.
 *
 * El propietario no publica: pide recibir propuestas. El formulario deja
 * la propiedad y el contacto; la revisión y la competencia entre corredoras
 * ocurren después. Así se respeta la regla del portal —solo corredoras
 * registradas y verificadas publican— sin dejar afuera a quien todavía no tiene
 * una.
 */

export const metadata: Metadata = {
  title: 'Recibe propuestas para tu propiedad | Rix7',
  description:
    'Ingresa tu propiedad y recibe propuestas de corredoras de propiedades verificadas que compiten por representarte.',
};

export default function PublicarPropietarioPage() {
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
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Sin corredora
          </span>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Recibe propuestas para tu propiedad
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Cuéntanos qué propiedad tienes y qué buscas. Revisamos los datos e invitamos
            a corredoras registradas y verificadas a competir por representarte. Tú
            decides con quién trabajar.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: BadgeCheck,
              title: 'Corredoras verificadas',
              detail: 'Solo participan empresas acreditadas por Rix7.',
            },
            {
              icon: Handshake,
              title: 'Tú eliges',
              detail: 'Recibes propuestas y decides con quién seguir.',
            },
            {
              icon: Clock3,
              title: 'Solicitud revisada',
              detail: 'El equipo revisa los datos antes de compartirla con las corredoras.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-xs font-bold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <PropietarioForm />
        </div>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-slate-400">
          La propiedad no se publica hasta que una corredora verificada tome el mandato
          y complete la ficha con los datos definitivos.
        </p>
      </div>
    </div>
  );
}
