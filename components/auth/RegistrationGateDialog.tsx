'use client';

import { useEffect } from 'react';
import { Lock } from 'lucide-react';

import { useRegistration } from '@/components/auth/RegistrationProvider';

interface RegistrationGateDialogProps {
  /** Si es `false` no se monta nada. */
  open: boolean;
  /** Qué acción se bloqueó: «Regístrate para compartir por WhatsApp», etc. */
  title: string;
  /**
   * Texto que explica el requisito. Se puede adaptar a la pantalla: la landing
   * no ofrece guardar, así que repetir «compartir y guardar» ahí confundiría.
   */
  description?: string;
  onClose: () => void;
}

/**
 * Aviso único para las acciones que piden visitante registrado (compartir,
 * copiar, guardar).
 *
 * Vive en `components/auth` porque lo usan tanto la ficha como las tarjetas del
 * listado; tener dos copias del diálogo fue justo lo que dejaba una de las dos
 * sin el aviso. «Inscribirme» abre el registro que ya vive en el layout, así que
 * no hay un segundo formulario en el sitio.
 */
export function RegistrationGateDialog({
  open,
  title,
  description = 'Compartir y guardar propiedades está disponible para visitantes registrados. El registro es gratis: así el enlace que envíes y tus favoritos quedan ligados a tu cuenta.',
  onClose,
}: RegistrationGateDialogProps) {
  const { openSignup } = useRegistration();

  // Escape cierra el aviso, como cualquier diálogo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-registro-titulo"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
          <Lock className="w-5 h-5" />
        </div>
        <h2 id="gate-registro-titulo" className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mt-2">{description}</p>
        <div className="flex flex-col sm:flex-row gap-2 mt-6">
          <button
            type="button"
            onClick={() => {
              onClose();
              openSignup();
            }}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-all"
          >
            Inscribirme
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition-colors"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
