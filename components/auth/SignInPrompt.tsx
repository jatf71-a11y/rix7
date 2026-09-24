'use client';

import { Mail } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';

/**
 * Isla de cliente para ofrecer el acceso desde una página de servidor.
 *
 * Las páginas que se renderizan en el servidor no pueden abrir el modal (vive en
 * el contexto del cliente), así que el botón se aísla acá en vez de convertir la
 * página entera en cliente —que es justo lo que le quitaba velocidad a la ficha.
 */
export function SignInPrompt({ reason }: { reason: string }) {
  const { openAuthModal } = useAuth();

  return (
    <button
      type="button"
      onClick={() => openAuthModal(reason)}
      className="inline-flex items-center gap-2 mt-5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
    >
      <Mail className="w-4 h-4" />
      Entrar con mi correo
    </button>
  );
}
