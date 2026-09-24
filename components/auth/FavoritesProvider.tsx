'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  FAVORITES_STORAGE_KEY,
  MAX_FAVORITES,
  decideLocalFavoritesMigration,
  parseLocalFavorites,
} from '@/lib/data/favorites';

/**
 * Favoritos: en la cuenta si hay sesión, en el dispositivo si no.
 *
 * Antes eran solo `localStorage`, así que se quedaban en ese navegador. Ahora,
 * al entrar, **la cuenta manda** y lo del dispositivo se sube una sola vez si la
 * cuenta está vacía (ver `decideLocalFavoritesMigration`).
 *
 * Por qué se mantiene el modo dispositivo en vez de exigir cuenta para guardar:
 * obligar a entrar para marcar un corazón es justo la fricción que veníamos
 * quitando. La cuenta se justifica porque el favorito **viaja**, no porque sea
 * un requisito para la acción.
 */

interface FavoritesContextType {
  /** Ids de las propiedades guardadas. */
  ids: string[];
  /** `account` = sigue a la persona; `device` = solo en este navegador. */
  source: 'account' | 'device';
  /** true mientras se sincroniza con la cuenta por primera vez. */
  isLoading: boolean;
  isFavorite: (propertyId: string) => boolean;
  /** Guarda o quita. Devuelve el estado resultante para poder mostrar el cambio. */
  toggle: (propertyId: string) => Promise<boolean>;
  /** Cuántos se pueden guardar todavía. */
  remaining: number;
  /** Aviso de error, para que un fallo no pase desapercibido. */
  error: string | null;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

function readLocalFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseLocalFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeLocalFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Modo privado o cuota llena: el favorito se ve en la sesión y no persiste.
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [source, setSource] = useState<'account' | 'device'>('device');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Evita que la migración se dispare dos veces (StrictMode, re-render por
  // refresh de token) y así no se pisan dos importaciones en paralelo.
  const migratedFor = useRef<string | null>(null);

  const loadForAccount = useCallback(async (userId: string) => {
    setError(null);
    try {
      const res = await fetch('/api/favorites', { cache: 'no-store' });
      const json = await res.json();

      // Sin sesión válida del lado del servidor: se sigue con el dispositivo.
      if (!json?.success) {
        setIds(readLocalFavorites());
        setSource('device');
        return;
      }

      const accountIds = Array.isArray(json.data) ? (json.data as string[]) : [];
      const localIds = readLocalFavorites();

      const decision = decideLocalFavoritesMigration(accountIds, localIds);
      if (decision.action !== 'import') {
        // La cuenta manda: lo del dispositivo se ignora (y no se borra, por si
        // la persona vuelve a salir de la cuenta).
        setIds(accountIds);
        setSource('account');
        return;
      }

      const importRes = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: decision.ids }),
      });
      const importJson = await importRes.json();

      if (importJson?.success) {
        setIds(importJson.data as string[]);
        setSource('account');
        // Recién acá se limpia el dispositivo: si la subida falla, los favoritos
        // siguen donde estaban y el próximo intento los vuelve a tomar.
        try {
          window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
        } catch {}
      } else {
        setIds(decision.ids);
        setSource('device');
      }
    } catch {
      setIds(readLocalFavorites());
      setSource('device');
    } finally {
      migratedFor.current = userId;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!user) {
      migratedFor.current = null;
      setIds(readLocalFavorites());
      setSource('device');
      setIsLoading(false);
      return;
    }

    if (migratedFor.current === user.id) return;
    setIsLoading(true);
    loadForAccount(user.id);
  }, [user, isAuthLoading, loadForAccount]);

  // El mismo dispositivo puede estar abierto en dos pestañas: si los favoritos
  // cambian en una, la otra se entera.
  useEffect(() => {
    if (source !== 'device' || typeof window === 'undefined') return;

    const sync = (event: StorageEvent) => {
      if (event.key === FAVORITES_STORAGE_KEY) setIds(readLocalFavorites());
    };

    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [source]);

  const toggle = useCallback(
    async (propertyId: string): Promise<boolean> => {
      const wasFavorite = ids.includes(propertyId);
      setError(null);

      // Sin sesión: el dispositivo sigue siendo suficiente para guardar.
      if (source === 'device') {
        const next = wasFavorite
          ? ids.filter((id) => id !== propertyId)
          : [...ids, propertyId].slice(0, MAX_FAVORITES);

        setIds(next);
        writeLocalFavorites(next);
        return !wasFavorite;
      }

      // Optimista para que el corazón responda al toque; si el servidor dice
      // otra cosa, se corrige con su lista (que es la verdad).
      const optimistic = wasFavorite ? ids.filter((id) => id !== propertyId) : [...ids, propertyId];
      setIds(optimistic);

      try {
        const res = wasFavorite
          ? await fetch(`/api/favorites?propertyId=${encodeURIComponent(propertyId)}`, {
              method: 'DELETE',
            })
          : await fetch('/api/favorites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ propertyId }),
            });

        const json = await res.json();

        if (!json?.success) {
          setIds(ids);
          setError(json?.error || 'No se pudo guardar el favorito.');
          return wasFavorite;
        }

        setIds(json.data as string[]);
        return !wasFavorite;
      } catch {
        setIds(ids);
        setError('No se pudo guardar el favorito. Revisa tu conexión.');
        return wasFavorite;
      }
    },
    [ids, source]
  );

  const value = useMemo<FavoritesContextType>(
    () => ({
      ids,
      source,
      isLoading,
      isFavorite: (propertyId: string) => ids.includes(propertyId),
      toggle,
      remaining: Math.max(0, MAX_FAVORITES - ids.length),
      error,
    }),
    [ids, source, isLoading, toggle, error]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites debe usarse dentro de un FavoritesProvider');
  }
  return context;
}
