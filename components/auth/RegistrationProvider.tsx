'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  REGISTRATION_KEY,
  parseStoredRegistration,
  resolveRegistration,
  type Registration,
} from '@/lib/utils/registration';

interface RegistrationContextType {
  /**
   * Identidad reconocida del usuario: la sesión del portal si existe, y si no el
   * registro de este dispositivo. `null` si el sitio no lo reconoce.
   */
  registration: Registration | null;
  /** true mientras se verifica (sesión + almacenamiento del dispositivo). */
  isChecking: boolean;
  /** Registra al usuario en este dispositivo (nombre + correo + teléfono). */
  save: (data: { name: string; email: string; phone: string }) => void;
  /** Completa o corrige el teléfono del registro vigente. */
  updatePhone: (phone: string) => void;
  /** Olvida el registro de este dispositivo (no cierra sesión del portal). */
  forget: () => void;
}

const RegistrationContext = createContext<RegistrationContextType | undefined>(undefined);

/**
 * Identidad del usuario para todo el sitio.
 *
 * Antes esto vivía dentro del formulario de contacto, así que un usuario ya
 * registrado se reconocía en la ficha pero no en el resto del portal. Al subirlo
 * al layout, el Navbar y el home lo reconocen igual.
 *
 * El registro del dispositivo es del lado cliente (localStorage), así que el
 * HTML del servidor no puede traerlo: por eso existe `isChecking`, que permite
 * mostrar un estado neutro en vez de un parpadeo de "no registrado".
 */
export function RegistrationProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  /** Registro del dispositivo (independiente de la sesión del portal). */
  const [stored, setStored] = useState<Registration | null>(null);
  const [hasReadStorage, setHasReadStorage] = useState(false);

  // Lectura inicial del dispositivo.
  useEffect(() => {
    try {
      setStored(parseStoredRegistration(localStorage.getItem(REGISTRATION_KEY)));
    } catch {
      // Sin almacenamiento disponible: no hay identidad de dispositivo.
    }
    setHasReadStorage(true);
  }, []);

  // Otra pestaña puede registrar al usuario: mantenemos las pestañas alineadas
  // para que el Navbar no diga una cosa y la ficha otra.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== REGISTRATION_KEY && e.key !== null) return;
      try {
        setStored(parseStoredRegistration(e.newValue ?? localStorage.getItem(REGISTRATION_KEY)));
      } catch {
        /* ignorar */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Estado y almacenamiento se escriben siempre juntos, para que no se desincronicen. */
  const write = useCallback((next: Registration | null) => {
    setStored(next);
    try {
      if (next) localStorage.setItem(REGISTRATION_KEY, JSON.stringify({
        name: next.name,
        email: next.email,
        phone: next.phone,
      }));
      else localStorage.removeItem(REGISTRATION_KEY);
    } catch {
      // Sin almacenamiento: la identidad dura solo esta pestaña.
    }
  }, []);

  const save = useCallback(
    (data: { name: string; email: string; phone: string }) => write({ ...data, source: 'local' }),
    [write]
  );

  const updatePhone = useCallback(
    (phone: string) => {
      setStored((prev) => {
        if (!prev) return prev;
        const next = { ...prev, phone };
        try {
          localStorage.setItem(REGISTRATION_KEY, JSON.stringify({
            name: next.name,
            email: next.email,
            phone: next.phone,
          }));
        } catch {
          /* sin almacenamiento */
        }
        return next;
      });
    },
    []
  );

  const forget = useCallback(() => write(null), [write]);

  // La sesión del portal manda sobre el registro del dispositivo.
  const registration = useMemo(() => resolveRegistration(stored, user), [stored, user]);

  const value = useMemo(
    () => ({
      registration,
      isChecking: authLoading || !hasReadStorage,
      save,
      updatePhone,
      forget,
    }),
    [registration, authLoading, hasReadStorage, save, updatePhone, forget]
  );

  return <RegistrationContext.Provider value={value}>{children}</RegistrationContext.Provider>;
}

export function useRegistration() {
  const context = useContext(RegistrationContext);
  if (!context) {
    throw new Error('useRegistration debe usarse dentro de un RegistrationProvider');
  }
  return context;
}
