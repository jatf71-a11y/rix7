import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Home,
  Landmark,
  ShieldCheck,
} from 'lucide-react';

/**
 * Puerta única de «Publicar».
 *
 * Antes el botón llevaba directo al alta de una corredora. Eso dejaba afuera a
 * dos públicos reales: quien tiene una propiedad y todavía no contrató corredora
 * (que necesita una licitación) y las inmobiliarias, que no son corredoras.
 * Acá se elige el camino antes de pedir datos; cada uno tiene su propio flujo y
 * su propio formulario.
 *
 * Rix7 publica solo con corredoras registradas y verificadas, así que el
 * propietario no publica una ficha: pide que corredoras compitan por ella.
 */

export const metadata: Metadata = {
  title: 'Publicar una propiedad | Rix7',
  description:
    'Publica como propietario en licitación, o registra tu corredora o inmobiliaria para publicar tu stock en Rix7.',
};

const options = [
  {
    href: '/publicar/propietario',
    icon: Home,
    badge: 'Sin corredora',
    title: 'Soy propietario',
    subtitle: 'Tengo una propiedad y aún no tengo corredora',
    description:
      'Ingresa tu propiedad a licitación para que corredoras verificadas compitan por representarte y publicarla en Rix7.',
    bullets: [
      'Rix7 revisa la solicitud',
      'Corredoras registradas y verificadas',
      'Tú eliges con quién trabajar',
    ],
    cta: 'Iniciar licitación',
    tone: 'amber' as const,
  },
  {
    href: '/registro/corredora',
    icon: Building2,
    badge: 'Empresa',
    title: 'Soy corredora',
    subtitle: 'Represento a una corredora de propiedades',
    description:
      'Registra tu corredora para acreditar la empresa y publicar tu stock en el portal y en tu página de empresa.',
    bullets: [
      'Perfil público de tu corredora',
      'Publicación y gestión de propiedades',
      'Contactos y métricas de tus enlaces',
    ],
    cta: 'Registrar mi corredora',
    tone: 'blue' as const,
  },
  {
    href: '/registro/inmobiliaria',
    icon: Landmark,
    badge: 'Empresa',
    title: 'Soy inmobiliaria',
    subtitle: 'Represento a una inmobiliaria o desarrolladora',
    description:
      'Registra tu inmobiliaria para publicar proyectos y stock propio, con un perfil de empresa dentro de Rix7.',
    bullets: [
      'Perfil de inmobiliaria y proyectos',
      'Publicación de stock propio',
      'Revisión y acreditación del equipo',
    ],
    cta: 'Registrar mi inmobiliaria',
    tone: 'emerald' as const,
  },
];

const tones = {
  amber: {
    ring: 'hover:border-amber-300',
    icon: 'bg-amber-50 text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
    cta: 'text-amber-800',
    bar: 'bg-amber-400',
  },
  blue: {
    ring: 'hover:border-blue-300',
    icon: 'bg-blue-50 text-blue-700',
    badge: 'bg-blue-100 text-blue-800',
    cta: 'text-blue-700',
    bar: 'bg-blue-500',
  },
  emerald: {
    ring: 'hover:border-emerald-300',
    icon: 'bg-emerald-50 text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
    cta: 'text-emerald-700',
    bar: 'bg-emerald-500',
  },
} as const;

export default function PublicarPage() {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
            Publicar en Rix7
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            ¿Quién publica?
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Rix7 trabaja con corredoras registradas y verificadas. Elige tu caso y te
            llevamos al flujo que corresponde: licitación para propietarios, o
            registro de empresa para corredoras e inmobiliarias.
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {options.map((option) => {
            const tone = tones[option.tone];
            return (
              <Link
                key={option.href}
                href={option.href}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${tone.ring}`}
              >
                <span className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} aria-hidden="true" />

                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone.icon}`}>
                    <option.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone.badge}`}>
                    {option.badge}
                  </span>
                </div>

                <h2 className="mt-5 text-xl font-black text-slate-900">{option.title}</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">{option.subtitle}</p>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">
                  {option.description}
                </p>

                <ul className="mt-5 space-y-2">
                  {option.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-xs text-slate-600">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                <span className={`mt-6 inline-flex items-center gap-1.5 text-sm font-bold ${tone.cta}`}>
                  {option.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
              <p className="text-sm font-bold text-slate-900">
                Verificamos cada corredora antes de publicar
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Una propiedad nunca se publica sin una corredora responsable. Por eso el
                registro de empresas pasa por revisión.
              </p>
            </div>
          </div>
          <Link
            href="/socio"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Ya tengo cuenta de socio
          </Link>
        </div>
      </div>
    </div>
  );
}
