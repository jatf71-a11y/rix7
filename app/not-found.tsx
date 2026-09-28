import Link from 'next/link';
import { ChevronLeft, Compass } from 'lucide-react';

/**
 * 404 raíz de la aplicación.
 *
 * Las rutas dinámicas ya tenían su 404 propio (properties/[id], empresas/[slug])
 * pero el resto del portal caía en el 404 por defecto de Next: sin marca, sin
 * español y sin salida. Este reemplaza ese default para cualquier URL que no
 * exista, manteniendo Navbar y footer (los segmentos padres siguen renderizando).
 *
 * Renderiza estático a propósito: no depende de datos ni de sesión.
 */
export default function RootNotFound() {
  return (
    <div className="bg-slate-50 min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <Compass className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-black text-slate-900">Página no encontrada</h1>
        <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
          La dirección que buscas no existe o fue movida. Puedes volver a la
          búsqueda o explorar las propiedades publicadas.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Volver a la búsqueda
        </Link>
      </div>
    </div>
  );
}
