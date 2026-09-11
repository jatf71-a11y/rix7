'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  X,
  GraduationCap,
  Train,
  ShoppingBag,
  HeartPulse,
  Landmark,
  Trees,
  Navigation,
  Loader2,
  Compass,
  ShoppingCart,
  Shield,
  UtensilsCrossed,
  Banknote,
  Dumbbell,
} from 'lucide-react';
import { searchPOIs } from '@/lib/data/chilePOIs';

export interface SelectedPoiLocation {
  id: string;
  name: string;
  subtitle?: string;
  category?: string;
  categoryLabel?: string;
  lat: number;
  lng: number;
  zoom: number;
  radiusKm: number;
}

interface PoiSearchInputProps {
  activePoi: SelectedPoiLocation | null;
  onSelectPoi: (poi: SelectedPoiLocation | null) => void;
  onRadiusChange?: (radiusKm: number) => void;
  totalResultsInRadius?: number;
}

interface SuggestionItem {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  categoryLabel: string;
  lat: number;
  lng: number;
  zoom: number;
  source: 'poi' | 'commune' | 'nominatim';
}

export function PoiSearchInput({
  activePoi,
  onSelectPoi,
  onRadiusChange,
  totalResultsInRadius,
}: PoiSearchInputProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoadingGeocode, setIsLoadingGeocode] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<SuggestionItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 1. Sugerencias locales instantáneas (0ms) de PUNTOS DE INTERÉS.
  //    Este buscador es exclusivo para POIs y direcciones: la búsqueda por
  //    comuna vive en su propio campo dentro de PropertyFilters.
  const localSuggestions = useMemo<SuggestionItem[]>(() => {
    const clean = query.trim();
    if (!clean || clean.length < 2) return [];

    const items: SuggestionItem[] = [];

    const pois = searchPOIs(clean, 5);
    for (const p of pois) {
      items.push({
        id: `poi-${p.id}`,
        name: p.name,
        subtitle: `${p.commune} · ${p.region.replace('Región de ', '').replace('Región del ', '').replace('Región Metropolitana de ', 'RM ')}`,
        category: p.category,
        categoryLabel: p.categoryLabel,
        lat: p.lat,
        lng: p.lng,
        zoom: 15,
        source: 'poi',
      });
    }

    return items.slice(0, 6);
  }, [query]);

  // 2. Búsqueda remota (Geocoding de direcciones / POIs adicionales)
  const fetchRemoteGeocode = useCallback((searchQuery: string) => {
    if (!searchQuery || searchQuery.trim().length < 3) {
      setRemoteSuggestions([]);
      setIsLoadingGeocode(false);
      return;
    }

    setIsLoadingGeocode(true);
    fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.results)) {
          // Este buscador es de POIs y direcciones: las comunas se excluyen
          // porque tienen su propio campo de búsqueda en los filtros.
          const remotePlaces = (data.results as any[]).filter((r) => r.category !== 'commune');
          const formatted: SuggestionItem[] = remotePlaces.map((r: any) => ({
            id: r.id,
            name: r.name,
            subtitle: r.subtitle || r.commune || 'Chile',
            category: r.category || 'address',
            categoryLabel: r.categoryLabel || 'Dirección',
            lat: r.lat,
            lng: r.lng,
            zoom: r.zoom || 15,
            source: r.source || 'nominatim',
          }));
          setRemoteSuggestions(formatted);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingGeocode(false));
  }, []);

  // Manejar cambio de texto con debounce para geocode
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (val.trim().length >= 3) {
      debounceTimerRef.current = setTimeout(() => {
        fetchRemoteGeocode(val);
      }, 400);
    } else {
      setRemoteSuggestions([]);
      setIsLoadingGeocode(false);
    }
  };

  // Combinar sugerencias locales y remotas evitando duplicados
  const allSuggestions = useMemo(() => {
    const map = new Map<string, SuggestionItem>();
    localSuggestions.forEach((s) => map.set(s.id, s));
    remoteSuggestions.forEach((s) => {
      if (!map.has(s.id)) {
        map.set(s.id, s);
      }
    });
    return Array.from(map.values()).slice(0, 8);
  }, [localSuggestions, remoteSuggestions]);

  // Seleccionar un resultado
  const handleSelect = (item: SuggestionItem) => {
    const selected: SelectedPoiLocation = {
      id: item.id,
      name: item.name,
      subtitle: item.subtitle,
      category: item.category,
      categoryLabel: item.categoryLabel,
      lat: item.lat,
      lng: item.lng,
      zoom: item.zoom || 14.5,
      radiusKm: 2, // Radio por defecto: 2 km
    };
    onSelectPoi(selected);
    setQuery('');
    setIsOpen(false);
  };

  // Limpiar búsqueda por POI
  const handleClear = () => {
    onSelectPoi(null);
    setQuery('');
    setIsOpen(false);
  };

  // Icono por categoría
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'metro':
      case 'transport':
        return <Train className="w-4 h-4 text-blue-600" />;
      case 'mall':
        return <ShoppingBag className="w-4 h-4 text-amber-600" />;
      case 'education':
        return <GraduationCap className="w-4 h-4 text-emerald-600" />;
      case 'health':
        return <HeartPulse className="w-4 h-4 text-rose-600" />;
      case 'civic':
        return <Landmark className="w-4 h-4 text-indigo-600" />;
      case 'park':
        return <Trees className="w-4 h-4 text-emerald-700" />;
      case 'commerce':
        return <ShoppingCart className="w-4 h-4 text-orange-600" />;
      case 'safety':
        return <Shield className="w-4 h-4 text-sky-700" />;
      case 'leisure':
        return <UtensilsCrossed className="w-4 h-4 text-fuchsia-600" />;
      case 'finance':
        return <Banknote className="w-4 h-4 text-cyan-700" />;
      case 'sport':
        return <Dumbbell className="w-4 h-4 text-lime-700" />;
      default:
        return <Navigation className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'metro':
      case 'transport':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'mall':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'education':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'health':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'civic':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'park':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'commerce':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'safety':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'leisure':
        return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
      case 'finance':
        return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case 'sport':
        return 'bg-lime-50 text-lime-700 border-lime-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="relative w-[200px] sm:w-[240px] shrink-0" ref={containerRef}>
      {/* ═══ MODO ACTIVO: Pill con radio y botón para cerrar ═══ */}
      {activePoi ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-2.5 py-1 bg-blue-50/90 border border-blue-200 rounded-lg shadow-sm text-xs animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-1.5 min-w-[120px] flex-1">
            <div className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-600 text-white shadow-sm shrink-0">
              {getCategoryIcon(activePoi.category || 'address')}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-blue-950 truncate max-w-[110px] sm:max-w-[160px]">
                  {activePoi.name}
                </span>
                <span className="text-[10px] font-bold text-blue-600 bg-white px-1.5 py-0.5 rounded-md border border-blue-200 shrink-0">
                  {totalResultsInRadius !== undefined ? `${totalResultsInRadius} prop.` : 'Alrededor'}
                </span>
              </div>
            </div>
          </div>

          {/* Selector rápido de radio: 1km, 2km, 3km, 5km */}
          <div className="flex items-center gap-0.5 shrink-0">
            {[1, 2, 3, 5].map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => onRadiusChange?.(km)}
                className={`px-1 py-0.5 text-[10px] font-extrabold rounded transition-colors ${
                  activePoi.radiusKm === km
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-blue-700 hover:bg-blue-100 border border-blue-200'
                }`}
                title={`Buscar en un radio de ${km} km`}
              >
                {km}k
              </button>
            ))}

            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors ml-0.5"
              title="Quitar búsqueda alrededor"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* ═══ MODO INPUT: Buscador con autocompletado ═══ */
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar Cerca de..."
            value={query}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            className="w-full pl-9 pr-8 py-1.5 bg-emerald-50 hover:bg-emerald-100 focus:bg-white border border-emerald-200 hover:border-emerald-300 rounded-lg text-xs font-semibold text-emerald-700 placeholder:text-emerald-600/80 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
          />

          {isLoadingGeocode ? (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
            </div>
          ) : query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRemoteSuggestions([]);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-700 p-1 rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      )}

      {/* ═══ DROPDOWN DE SUGERENCIAS POIs Y DIRECCIONES ═══ */}
      {isOpen && !activePoi && (
        <div className="absolute left-0 top-full mt-1.5 w-full bg-white rounded-2xl shadow-2xl border border-slate-200 z-[1100] overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[360px] flex flex-col">
          {allSuggestions.length > 0 ? (
            <div className="p-1.5 overflow-y-auto divide-y divide-slate-100">
              <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Puntos de Interés & Direcciones</span>
                <span className="text-[9px] text-blue-600 font-semibold flex items-center gap-1">
                  <Compass className="w-3 h-3" /> Busca alrededor
                </span>
              </div>

              {allSuggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-colors hover:bg-blue-50/70 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0 transition-colors">
                      {getCategoryIcon(item.category)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${getCategoryBadgeClass(
                      item.category
                    )}`}
                  >
                    {item.categoryLabel}
                  </span>
                </button>
              ))}
            </div>
          ) : query.trim().length >= 2 ? (
            <div className="p-5 text-center">
              {isLoadingGeocode ? (
                <div className="flex flex-col items-center gap-2 text-slate-500 py-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="text-xs font-semibold">Buscando dirección o lugar en Chile...</span>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-700">
                    No encontramos "{query}"
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Prueba con un nombre de colegio, estación de metro, mall, o dirección aproximada.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="p-3">
              <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Sugerencias rápidas
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {[
                  { name: 'Costanera Center', cat: 'mall' },
                  { name: 'Metro Tobalaba', cat: 'metro' },
                  { name: 'Parque Arauco', cat: 'mall' },
                  { name: 'Clínica Alemana', cat: 'health' },
                  { name: 'Palacio La Moneda', cat: 'civic' },
                  { name: 'The Grange School', cat: 'education' },
                ].map((quick) => (
                  <button
                    key={quick.name}
                    type="button"
                    onClick={() => {
                      setQuery(quick.name);
                      setIsOpen(true);
                      fetchRemoteGeocode(quick.name);
                    }}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-xs font-semibold transition-colors text-left"
                  >
                    <span className="shrink-0">{getCategoryIcon(quick.cat)}</span>
                    <span className="truncate">{quick.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
