'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellPlus, Check, Loader2, Trash2, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { hasAnyFilter, type SavedSearch, type SavedSearchFilters } from '@/lib/data/savedSearches';

interface SaveSearchButtonProps {
  /** Filtros tal como están en el buscador. */
  filters: {
    operationType: 'for_sale' | 'for_rent' | 'all';
    propertyType: string;
    newPropertyType: 'proyectos' | 'entrega_inmediata' | null;
    searchQuery: string;
    minPrice: number | null;
    maxPrice: number | null;
    minBedrooms: number | null;
    minBathrooms: number | null;
    minPrivates: number | null;
  };
  commune: string | null;
  region: string | null;
}

/**
 * Guarda la búsqueda actual y avisa por correo cuando aparece algo nuevo.
 *
 * Es lo que le da sentido a tener cuenta: sin esto, entrar al portal solo servía
 * para publicar, que es cosa de las corredoras. La búsqueda se arma con los
 * **mismos filtros que el buscador**, así el aviso coincide con lo que la
 * persona estaba viendo cuando la guardó.
 */
export function SaveSearchButton({ filters, commune, region }: SaveSearchButtonProps) {
  const { user, openAuthModal } = useAuth();
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapped: SavedSearchFilters = {
    operation: filters.operationType,
    propertyType: filters.propertyType as SavedSearchFilters['propertyType'],
    newPropertyType: filters.newPropertyType,
    commune,
    region,
    searchQuery: filters.searchQuery,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minBedrooms: filters.minBedrooms,
    minBathrooms: filters.minBathrooms,
    minPrivates: filters.minPrivates,
  };

  const canSave = hasAnyFilter(mapped);

  const loadSaved = useCallback(async () => {
    if (!user) {
      setSaved([]);
      return;
    }
    try {
      const res = await fetch('/api/saved-searches');
      const json = await res.json();
      if (json?.success) setSaved(json.data);
    } catch {
      // Sin red se muestra la lista vacía; guardar volverá a intentarlo.
    }
  }, [user]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const handleSave = async () => {
    if (!user) {
      openAuthModal(
        'Entra con tu correo para guardar esta búsqueda y recibir un aviso cuando aparezca algo nuevo.'
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapped),
      });
      const json = await res.json();

      if (!json?.success) {
        setError(json?.error || 'No se pudo guardar la búsqueda.');
        return;
      }

      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 4000);
      await loadSaved();
    } catch {
      setError('No se pudo guardar la búsqueda. Revisa tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/saved-searches?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json?.success) setSaved((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // Si falla, la búsqueda sigue en la lista y se puede reintentar.
    }
  };

  const hint = !user
    ? 'Entra para guardar esta búsqueda y recibir avisos'
    : canSave
      ? 'Guardar esta búsqueda y avisarme por correo'
      : 'Elige algún filtro para poder guardar la búsqueda';

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || (!!user && !canSave)}
          title={hint}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            justSaved
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
          }`}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : justSaved ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <BellPlus className="w-3.5 h-3.5" />
          )}
          <span>{justSaved ? 'Te avisaremos' : 'Guardar búsqueda'}</span>
        </button>

        {user && saved.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Ver mis búsquedas guardadas"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>{saved.length}</span>
          </button>
        )}
      </div>

      {error && (
        <p className="absolute right-0 mt-1 w-56 text-[10px] text-red-600 bg-white border border-red-100 rounded-lg px-2 py-1 shadow-sm z-20">
          {error}
        </p>
      )}

      {/* Lista de búsquedas guardadas */}
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Búsquedas guardadas
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              aria-label="Cerrar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <ul className="max-h-64 overflow-auto py-1">
            {saved.map((search) => (
              <li
                key={search.id}
                className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 group"
              >
                <span className="flex-1 min-w-0 text-[11px] text-slate-700 leading-snug">
                  {search.label}
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {search.notify ? 'Aviso activo por correo' : 'Sin avisos'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(search.id)}
                  title="Borrar esta búsqueda"
                  className="p-1 text-slate-300 hover:text-red-600 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <p className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 leading-snug">
            Te avisamos por correo cuando aparezca una propiedad que coincida con una de estas
            búsquedas.
          </p>
        </div>
      )}
    </div>
  );
}
