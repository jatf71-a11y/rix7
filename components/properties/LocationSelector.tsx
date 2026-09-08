'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { MapPin, ChevronDown, Check, Search, X, Globe } from 'lucide-react';

interface LocationSelectorProps {
  selectedCommune: string | null;
  selectedRegion: string | null;
  onSelectLocation: (location: {
    regionName: string;
    communeName: string | null;
    lat: number;
    lng: number;
    zoom: number;
  }) => void;
  communeCounts?: Record<string, number>;
  totalAllProperties?: number;
}

export function LocationSelector({
  selectedCommune,
  selectedRegion,
  onSelectLocation,
  communeCounts = {},
  totalAllProperties = 0,
}: LocationSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRegionCode, setActiveRegionCode] = useState<string>('XIII');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sincronizar el panel izquierdo con la región seleccionada
  useEffect(() => {
    if (selectedRegion) {
      const match = CHILE_REGIONS.find(
        (r) => r.name === selectedRegion || r.name.toLowerCase() === selectedRegion.toLowerCase()
      );
      if (match) {
        setActiveRegionCode(match.code);
      }
    } else {
      // Sin región seleccionada (nearby o Chile) — volver a Santiago por defecto
      setActiveRegionCode('XIII');
    }
  }, [selectedRegion]);

  // Cerrar dropdown al hacer click fuera y limpiar búsqueda
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeRegion = CHILE_REGIONS.find((r) => r.code === activeRegionCode) || CHILE_REGIONS[6];

  // Filtrado de comunas por búsqueda rápida
  const filteredCommunes = searchQuery.trim()
    ? CHILE_REGIONS.flatMap((r) =>
        r.communes
          .filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map((c) => ({ ...c, regionName: r.name, regionCode: r.code }))
      )
    : activeRegion.communes.map((c) => ({
        ...c,
        regionName: activeRegion.name,
        regionCode: activeRegion.code,
      }));

  const label = selectedCommune
    ? selectedCommune
    : selectedRegion
    ? selectedRegion
    : 'Chile';

  // ¿Hay una selección activa?
  const hasSelection = selectedRegion !== null || selectedCommune !== null;

  // Conteo de propiedades por región
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    CHILE_REGIONS.forEach((region) => {
      let total = 0;
      region.communes.forEach((c) => {
        total += communeCounts[c.name] || 0;
      });
      counts[region.name] = total;
      counts[region.code] = total;
    });
    return counts;
  }, [communeCounts]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Botón de Activación */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-xs font-semibold transition-all hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
          hasSelection
            ? 'bg-blue-50 border-blue-300 text-blue-800'
            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
        }`}
      >
        <MapPin className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
        <span className="max-w-[150px] truncate">{label}</span>
        {!hasSelection && totalAllProperties > 0 && (
          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full" suppressHydrationWarning>
            {totalAllProperties}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Modal / Menú Desplegable GIS */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-[340px] sm:w-[540px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Barra de búsqueda de comunas y botón Todo Chile */}
          <div className="p-3 border-b border-slate-100 bg-slate-50/50 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar comuna en todo Chile (ej. Providencia, Viña del Mar, Pucón)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Opción rápida: Todo Chile */}
            <button
              type="button"
              onClick={() => {
                onSelectLocation({
                  regionName: '',
                  communeName: null,
                  lat: -33.45,
                  lng: -70.66,
                  zoom: 6,
                });
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 border rounded-xl text-xs font-bold transition-colors ${
                !hasSelection
                  ? 'bg-blue-100 border-blue-300 text-blue-800'
                  : 'bg-blue-50/60 hover:bg-blue-100 border-blue-200/60 text-blue-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                <span>Ver Todo Chile</span>
                {totalAllProperties > 0 && (
                  <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                    {totalAllProperties}
                  </span>
                )}
              </div>
              {!hasSelection && <Check className="w-3.5 h-3.5 text-blue-600" />}
              {hasSelection && <span className="text-[11px] text-blue-600">Todas las regiones</span>}
            </button>
          </div>

          {searchQuery.trim() ? (
            /* Resultados de Búsqueda Directa */
            <div className="max-h-[300px] overflow-y-auto p-2 divide-y divide-slate-100">
              {filteredCommunes.length > 0 ? (
                filteredCommunes.map((commune) => (
                  <button
                    key={`${commune.regionCode}-${commune.name}`}
                    onClick={() => {
                      onSelectLocation({
                        regionName: commune.regionName,
                        communeName: commune.name,
                        lat: commune.lat,
                        lng: commune.lng,
                        zoom: commune.zoom || 13,
                      });
                      setIsOpen(false);
                      setSearchQuery('');
                    }}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center justify-between transition-colors group ${
                      selectedCommune === commune.name
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-blue-50'
                    }`}
                  >                    <div>
                      <div className={`text-xs font-bold ${selectedCommune === commune.name ? 'text-blue-700' : 'text-slate-900 group-hover:text-blue-600'}`}
                        >
                        {commune.name}
                      </div>
                      <div className="text-[11px] text-slate-500">{commune.regionName}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {communeCounts[commune.name] > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {communeCounts[commune.name]}
                        </span>
                      )}
                      {selectedCommune === commune.name ? (
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600" />
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-slate-500">
                  No encontramos comunas con ese nombre.
                </div>
              )}
            </div>
          ) : (
            /* Vista Dividida por Regiones Oficiales de Chile */
            <div className="grid grid-cols-1 sm:grid-cols-12 max-h-[340px]">
              {/* Columna Izquierda: Regiones de Chile */}
              <div className="sm:col-span-5 border-r border-slate-100 bg-slate-50/50 overflow-y-auto max-h-[340px] p-1.5 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Regiones de Chile
                </div>
                {CHILE_REGIONS.map((region) => {
                  const isActive = activeRegionCode === region.code;
                  const isSelectedRegion = selectedRegion === region.name;
                  return (
                    <button
                      key={region.code}
                      onClick={() => setActiveRegionCode(region.code)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-sm'
                          : isSelectedRegion
                          ? 'bg-blue-100 text-blue-800 font-bold'
                          : 'text-slate-700 hover:bg-slate-200/70'
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-bold text-[10px] opacity-75 mr-1">{region.code}</span>
                        {region.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] opacity-75">({regionCounts[region.name] || 0})</span>
                        {isSelectedRegion && !isActive && (
                          <Check className="w-3 h-3 text-blue-600" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Columna Derecha: Comunas de la Región Seleccionada */}
              <div className="sm:col-span-7 p-2 overflow-y-auto max-h-[340px]">
                {/* Botón para volar a toda la región */}
                <button
                  onClick={() => {
                    onSelectLocation({
                      regionName: activeRegion.name,
                      communeName: null,
                      lat: activeRegion.lat,
                      lng: activeRegion.lng,
                      zoom: activeRegion.zoom,
                    });
                    setIsOpen(false);
                  }}
                  className={`w-full text-left p-2.5 mb-2 rounded-xl text-xs font-bold flex items-center justify-between transition-colors border ${
                    selectedRegion === activeRegion.name && !selectedCommune
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-blue-50 hover:bg-blue-100/80 border-blue-200 text-blue-700'
                  }`}
                >
                  <span>Ver toda la Región ({activeRegion.name})</span>
                  {selectedRegion === activeRegion.name && !selectedCommune ? (
                    <Check className="w-4 h-4 text-blue-600" />
                  ) : (
                    <MapPin className="w-4 h-4 text-blue-600" />
                  )}
                </button>

                <div className="grid grid-cols-2 gap-1">
                  {activeRegion.communes.map((commune) => (
                    <button
                      key={commune.name}
                      onClick={() => {
                        onSelectLocation({
                          regionName: activeRegion.name,
                          communeName: commune.name,
                          lat: commune.lat,
                          lng: commune.lng,
                          zoom: commune.zoom || 13,
                        });
                        setIsOpen(false);
                      }}
                      className={`text-left p-2 rounded-lg text-xs font-medium transition-all hover:bg-slate-100 flex items-center justify-between ${
                        selectedCommune === commune.name
                          ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200'
                          : 'text-slate-700'
                      }`}
                    >
                      <span className="truncate">{commune.name}</span>
                      <div className="flex items-center gap-1">
                        {communeCounts[commune.name] > 0 && (
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                            {communeCounts[commune.name]}
                          </span>
                        )}
                        {selectedCommune === commune.name && (
                          <Check className="w-3 h-3 text-blue-600 flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
