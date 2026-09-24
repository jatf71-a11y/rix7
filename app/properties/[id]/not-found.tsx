import Link from 'next/link';
import { ChevronLeft, SearchX } from 'lucide-react';

export default function PropertyNotFound() {
  return (
    <div className="bg-slate-50 min-h-screen flex items-center justify-center">
      <div className="text-center px-4">
        <SearchX className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h1 className="text-xl font-black text-slate-900">Propiedad no encontrada</h1>
        <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
          Esta propiedad ya no está disponible o la dirección es incorrecta.
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
