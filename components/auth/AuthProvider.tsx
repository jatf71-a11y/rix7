'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
// `import type`: son solo tipos. Sin el `type`, el bundler puede conservar la
// librería entera por si el import tiene efectos.
import type { User, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { resolveRole } from '@/lib/utils/roles';
import { REGISTRATION_KEY, parseStoredRegistration } from '@/lib/utils/registration';
import { normalizeChilePhone } from '@/lib/utils/phone';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /**
   * true si el usuario tiene el rol 'admin' en su app_metadata de Supabase.
   * En desarrollo (o con NEXT_PUBLIC_SHOW_ADMIN_ENV=1) se fuerza a true para
   * poder ver y probar el panel sin una sesión real.
   */
  isAdmin: boolean;
  /** true cuando isAdmin viene del bypass de desarrollo y no del rol real */
  isAdminDevBypass: boolean;
  isAuthModalOpen: boolean;
  /**
   * Por qué se pidió entrar ("guardar esta búsqueda", por ejemplo). El modal lo
   * muestra para que la persona sepa qué gana al identificarse, en vez de ver un
   * formulario genérico que no pidió.
   */
  authReason: string | null;
  /**
   * Error con el que se abrió el diálogo (por ejemplo, el que dejó Google al
   * volver). Vive acá y no en el estado del modal porque el modal limpia su
   * formulario al montarse, y ese borrado se llevaría el mensaje por delante.
   */
  authError: string | null;
  /**
   * Abre el diálogo de acceso. Hay **dos** formas de entrar —Google en un clic
   * y enlace mágico al correo—, así que registrar y entrar siguen siendo la
   * misma acción y no hace falta elegir modo.
   */
  openAuthModal: (reason?: string, error?: string) => void;
  closeAuthModal: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authReason, setAuthReason] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Un único cliente por montaje: al crearlo en cada render cambiaba de
  // identidad y el efecto de sesión se volvía a suscribir continuamente.
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    // Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Escuchar cambios de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  // El rol vive en app_metadata (controlado por el servidor, no editable por el
  // usuario). La resolución es la misma que usa el guard de las rutas de admin.
  const isAdminByRole = resolveRole(user) === 'admin';

  // Bypass de desarrollo: en local no hay proyecto Supabase real (el login es
  // imposible), así que se habilita el acceso al panel para poder ver y probar
  // la UI. En producción (next build / Vercel) NODE_ENV es 'production', por lo
  // que siempre se exige el rol admin real.
  const isAdminDevBypass =
    process.env.NEXT_PUBLIC_SHOW_ADMIN_ENV === '1' || process.env.NODE_ENV !== 'production';

  const isAdmin = isAdminByRole || isAdminDevBypass;

  /**
   * Pasa a la cuenta los datos que la persona ya había dejado para contactar a
   * una corredora (nombre y móvil de WhatsApp).
   *
   * Es la razón por la que el alta no pide nada más que el correo: lo que ya
   * sabemos no se vuelve a preguntar. Los guardas evitan reescribir metadatos en
   * cada refresco de token.
   */
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const stored = parseStoredRegistration(localStorage.getItem(REGISTRATION_KEY));
    if (!stored) return;

    const metadata = user.user_metadata || {};
    const phone = stored.phone ? normalizeChilePhone(stored.phone) ?? stored.phone : '';
    const addName = !metadata.full_name && !!stored.name;
    const addPhone = !metadata.phone && !!phone;

    if (!addName && !addPhone) return;

    supabase.auth
      .updateUser({
        data: {
          ...(addName ? { full_name: stored.name } : {}),
          ...(addPhone ? { phone } : {}),
        },
      })
      .catch(() => {
        // Si falla, la cuenta simplemente queda sin esos datos de perfil.
      });
  }, [user, supabase]);

  const openAuthModal = useCallback((reason?: string, error?: string) => {
    // Se pisan en cada apertura: un mensaje viejo no debe reaparecer cuando el
    // diálogo se abre por otro motivo.
    setAuthReason(reason ?? null);
    setAuthError(error ?? null);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const contextValue = useMemo(
    () => ({
      user,
      session,
      isLoading,
      isAdmin,
      isAdminDevBypass: isAdminDevBypass && !isAdminByRole,
      isAuthModalOpen,
      authReason,
      authError,
      openAuthModal,
      closeAuthModal,
      signOut,
    }),
    [
      user,
      session,
      isLoading,
      isAdmin,
      isAdminDevBypass,
      isAdminByRole,
      isAuthModalOpen,
      authReason,
      authError,
      openAuthModal,
      closeAuthModal,
      signOut,
    ]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
}
