import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';

/** Corredora inexistente: mismo mensaje que mostraba la página, pero con 404 real. */
export default function EmpresaNotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-400 text-lg font-semibold">Empresa no encontrada</p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 text-blue-600 font-bold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al portal
        </Link>
      </div>
    </div>
  );
}
