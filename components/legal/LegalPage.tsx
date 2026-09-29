import Link from 'next/link';
import type { LegalDocument } from '@/lib/legal/content';

/**
 * Id estable para el encabezado de cada sección: los títulos llevan número y
 * espacios («1. Naturaleza del servicio»), que no valen como id, así que se
 * convierten a slug para que `aria-labelledby` referencie algo real.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Renderizador de documentos legales. Es un server component a propósito: el
 * texto legal no necesita hidratación ni interacción, y así el JS que viaja
 * al navegador por estas páginas es cero.
 *
 * El markup es deliberadamente plano (prosa `text-slate-600`, jerarquía por
 * tamaño y peso, sin plugin de tipografía): se apoya en las mismas utilidades
 * Tailwind que el resto del portal.
 */
export function LegalPage({
  doc,
  other,
}: {
  doc: LegalDocument;
  /** Documento hermano, para la navegación al pie. */
  other: { href: string; title: string };
}) {
  const lastUpdated = new Date(`${doc.effectiveDate}T12:00:00`).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="w-full bg-slate-50">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {/* Encabezado del documento */}
        <header className="mb-10 pb-8 border-b border-slate-200">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3">
            Legal
          </p>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 mb-4">
            {doc.title}
          </h1>
          <p className="text-slate-500 text-sm">Vigente desde el {lastUpdated}</p>
        </header>

        {/* Intro antes de la primera sección */}
        <div className="space-y-4 text-slate-600 leading-relaxed mb-10">
          {doc.intro.map((node, i) => (
            <p key={`intro-${i}`} className="text-lg">
              {node}
            </p>
          ))}
        </div>

        {/* Secciones: los textos son JSX, no markdown, así que no hay parser
            ni dependencia extra — solo prosa con listas cuando el documento
            las necesita. */}
        <div className="space-y-10">
          {doc.sections.map((section) => (
            <section key={section.title} aria-labelledby={`h-${slugify(section.title)}`}>
              <h2 id={`h-${slugify(section.title)}`} className="text-xl font-bold text-slate-900 mb-4">
                {section.title}
              </h2>
              {/* Cada ítem del cuerpo va en su propio <p>: los textos son
                  fragments, y sin el wrapper el HTML los pega corridos
                  («…las partes.La información…») — visible en producción. */}
              <div className="space-y-4 text-slate-600 leading-relaxed">
                {section.body.map((node, i) => (
                  <p key={i}>{node}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Pie con navegación entre documentos y vuelta al portal */}
        <footer className="mt-14 pt-8 border-t border-slate-200 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/" className="text-blue-600 hover:text-blue-700 font-medium">
            ← Volver al portal
          </Link>
          <Link href={other.href} className="text-slate-500 hover:text-slate-700">
            {other.title}
          </Link>
        </footer>
      </article>
    </div>
  );
}
