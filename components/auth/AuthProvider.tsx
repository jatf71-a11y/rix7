'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

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
  authMode: 'login' | 'register';
  openAuthModal: (mode?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

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

  // El rol vive en app_metadata (controlado por el servidor, no editable por el usuario).
  const isAdminByRole = user?.app_metadata?.role === 'admin';

  // Bypass de desarrollo: en local no hay proyecto Supabase real (el login es
  // imposible), así que se habilita el acceso al panel para poder ver y probar
  // la UI. En producción (next build / Vercel) NODE_ENV es 'production', por lo
  // que siempre se exige el rol admin real.
  const isAdminDevBypass =
    process.env.NEXT_PUBLIC_SHOW_ADMIN_ENV === '1' || process.env.NODE_ENV !== 'production';

  const isAdmin = isAdminByRole || isAdminDevBypass;

  const openAuthModal = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthMode(mode);
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
      authMode,
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
      authMode,
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
