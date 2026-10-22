'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

/**
 * La pantalla de acceso del panel, cargada **solo cuando hace falta**.
 *
 * El layout de `/admin` es de servidor y no puede usar `next/dynamic` con
 * `ssr: false`; este envoltorio de cliente existe para eso. La tarjeta de
 * acceso arrastra el cliente de Supabase y su modal de cuenta, y un
 * administrador con sesión nunca la ve: con la importación estática, esas
 * piezas viajaban en el bundle de **todas** las rutas del panel.
 *
 * Mismo criterio que `/socio/publicar` con `SocioAccessNotice`: se paga el
 * código del aviso cuando el aviso es lo que se va a mostrar. El hueco que
 * deja `ssr: false` lo cubre el marcador de carga, con el mismo alto que la
 * tarjeta para que no salte el layout al aparecer.
 */
const AdminLogin = dynamic(() => import('./AdminLogin'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-slate-50 px-4 py-12">
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando el acceso…
      </p>
    </div>
  ),
});

export default function AdminAccess({ status }: { status: number }) {
  return <AdminLogin status={status} />;
}
