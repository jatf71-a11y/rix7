import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';

/**
 * Footer global del portal (hallazgo #6): sin él, las páginas legales quedaban
 * a un clic de nada y el sitio no declaraba quiénes son sus responsables.
 *
 * Es un server component: no hay nada interactivo acá más que enlaces, y así
 * no añade ni un byte de JS al bundle compartido (que la auditoría mantiene
 * como presupuesto duro: 89,6 kB).
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {/* Marca y naturaleza del servicio */}
          <div className="sm:col-span-2 max-w-md">
            <span className="text-2xl font-black tracking-tight text-slate-900">
              Rix<span className="text-blue-600">7</span>
            </span>
            <p className="mt-3 text-sm text-slate-500 leading-relaxed">
              Portal inmobiliario para todo Chile: propiedades en venta y
              arriendo, con mapa interactivo, precios en $, UF y US$ y
              calculadora de dividendo.
            </p>
          </div>

          {/* Navegación */}
          <nav aria-label="Enlaces de pie de página">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Explorar
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/?operation=sale" className="text-slate-600 hover:text-blue-600 transition-colors">
                  Comprar
                </Link>
              </li>
              <li>
                <Link href="/?operation=rent" className="text-slate-600 hover:text-blue-600 transition-colors">
                  Arrendar
                </Link>
              </li>
            </ul>

            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-6 mb-3">
              Legal
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/legal/terminos" className="text-slate-600 hover:text-blue-600 transition-colors">
                  Términos de Servicio
                </Link>
              </li>
              <li>
                <Link href="/legal/privacidad" className="text-slate-600 hover:text-blue-600 transition-colors">
                  Política de Privacidad
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* Línea de derechos */}
        <div className="mt-10 pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-slate-400">
            © {year} {SITE_NAME}. Todos los derechos reservados.
          </p>
          <p className="text-xs text-slate-400">
            Los avisos publicados son responsabilidad de cada publicante.
          </p>
        </div>
      </div>
    </footer>
  );
}
