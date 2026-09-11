'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PropertyFilterState, PropertyType, NewPropertyType } from '@/lib/types/property';
import { LocationSelector } from './LocationSelector';
import { CHILE_REGIONS } from '@/lib/data/chileLocations';
import { useCurrency } from '@/components/currency/CurrencyProvider';
import { Currency } from '@/lib/utils/formatters';
import { stripDiacritics } from '@/lib/utils/text';
import {
  Search,
  RotateCcw,
  Building,
  Home,
  Sparkles,
  Building2,
  Layers,
  Briefcase,
  Trees,
  Tag,
  KeyRound,
  Radio,
  MapPin,
  X,
  Car,
  Store,
  Warehouse,
  Sparkle,
  Bed,
  Bath,
  LampDesk,
} from 'lucide-react';

interface PropertyFiltersProps {
  filters: PropertyFilterState;
  onFilterChange: (filters: PropertyFilterState) => void;
  categoryCounts?: Record<PropertyType, number>;
  selectedRegion?: string | null;
  selectedCommune?: string | null;
  onSelectLocation?: (location: {
    regionName: string;
    communeName: string | null;
    lat: number;
    lng: number;
    zoom: number;
  }) => void;
  communeCounts?: Record<string, number>;
  totalAllProperties?: number;
  operationCounts?: { for_sale: number; for_rent: number };
  nearbyActive?: boolean;
  onToggleNearby?: () => void;
  nearbyCount?: number;
  newPropertyType?: NewPropertyType;
  newPropertiesCount?: number;
  onResetAll?: () => void;
  /** Buscador de POIs/direcciones que se renderiza junto al buscador por comuna */
  poiSearchSlot?: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════
// Botón "Nuevas" — Verde con dropdown Proyectos / Entrega Inmediata
// ═══════════════════════════════════════════════════════════════════
function PropiedadesNuevasButton({
  value,
  onChange,
  count = 0,
}: {
  value: NewPropertyType;
  onChange: (val: NewPropertyType) => void;
  count?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options: { id: 'proyectos' | 'entrega_inmediata'; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: 'proyectos',
      label: 'Proyectos',
      icon: <Building className="w-3.5 h-3.5" />,
      desc: 'Propiedades en construcción o lanzamiento',
    },
    {
      id: 'entrega_inmediata',
      label: 'Entrega Inmediata',
      icon: <Sparkle className="w-3.5 h-3.5" />,
      desc: 'Listas para mudarte ahora',
    },
  ];

  const isActive = value !== null;
  const activeLabel = options.find((o) => o.id === value)?.label || '';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
          isActive
            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-500/20'
            : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300'
        }`}
        title="Inmobiliarias"
      >
        <Sparkle className="w-3.5 h-3.5" />
        <span>Nuevas</span>
        {count > 0 && (
          <span className="text-[10px] font-extrabold bg-white/30 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
        {isActive && (
          <span className="text-[10px] bg-white/30 px-1.5 py-0.5 rounded-full">
            {activeLabel}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="p-1.5">
            {/* Opción: Todas (limpiar filtro) */}
            <button
              type="button"
              onClick={() => { onChange(null); setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                !isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'hover:bg-slate-50 text-slate-600'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <div>
                <div className="font-bold">Todas</div>
                <div className="text-[10px] text-slate-400">Sin filtro de novedad</div>
              </div>
              {!isActive && <span className="ml-auto text-emerald-600">✓</span>}
            </button>

            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.id); setIsOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
                  value === opt.id ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'hover:bg-slate-50 text-slate-600'
                }`}
              >
                <span className="text-emerald-500">{opt.icon}</span>
                <div>
                  <div className="font-bold">{opt.label}</div>
                  <div className="text-[10px] text-slate-400">{opt.desc}</div>
                </div>
                {value === opt.id && <span className="ml-auto text-emerald-600">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PropertyFilters({
  filters,
  onFilterChange,
  categoryCounts = {
    all: 0,
    apartment: 0,
    house: 0,
    premium: 0,
    parcel: 0,
    office: 0,
    land: 0,
    parking: 0,
    local: 0,
    warehouse: 0,
  },
  selectedRegion = null,
  selectedCommune = null,
  onSelectLocation,
  communeCounts = {},
  totalAllProperties = 0,
  operationCounts = { for_sale: 0, for_rent: 0 },
  nearbyActive = false,
  onToggleNearby,
  nearbyCount,
  newPropertyType = null,
  newPropertiesCount = 0,
  onResetAll,
  poiSearchSlot,
}: PropertyFiltersProps) {
  // Búsqueda de comunas: solo acepta nombres de comunas del listado oficial
  const [localSearch, setLocalSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sincronizar localSearch cuando filters.searchQuery cambia externamente (ej: nearby reset)
  useEffect(() => {
    setLocalSearch(filters.searchQuery || '');
  }, [filters.searchQuery]);

  // Communes planas con info de región
  const allCommunes = useMemo(() => {
    return CHILE_REGIONS.flatMap((r) =>
      r.communes.map((c) => ({
        name: c.name,
        regionName: r.name,
        lat: c.lat,
        lng: c.lng,
        zoom: c.zoom || 13,
      }))
    );
  }, []);

  // Sugerencias filtradas por texto
  const communeSuggestions = useMemo(() => {
    if (!localSearch.trim()) return [];
    const q = stripDiacritics(localSearch.toLowerCase());
    return allCommunes
      .filter((c) => stripDiacritics(c.name.toLowerCase()).includes(q))
      .slice(0, 8);
  }, [localSearch, allCommunes]);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectCommune = useCallback((commune: typeof allCommunes[0]) => {
    setLocalSearch('');
    setShowSuggestions(false);
    // Limpiar búsqueda de texto para que el filtro de comuna tenga efecto
    onFilterChange({ ...filters, searchQuery: '' });
    if (onSelectLocation) {
      onSelectLocation({
        regionName: commune.regionName,
        communeName: commune.name,
        lat: commune.lat,
        lng: commune.lng,
        zoom: commune.zoom,
      });
    }
  }, [onSelectLocation, filters, onFilterChange]);

  const isRent = filters.operationType === 'for_rent';
  const { currency, setCurrency, rates } = useCurrency();

  // Formatear precio segun moneda seleccionada
  const formatPriceForCurrency = (clp: number, curr: Currency): string => {
    if (curr === 'UF') {
      const uf = clp / rates.uf;
      return uf < 100 ? `UF ${uf.toFixed(1)}` : `UF ${Math.round(uf).toLocaleString('es-CL')}`;
    }
    if (curr === 'USD') {
      const usd = clp / rates.dolar;
      return `US$ ${Math.round(usd).toLocaleString('es-CL')}`;
    }
    return `$ ${clp.toLocaleString('es-CL')}`;
  };

  // Opciones de precio por moneda y tipo (venta/arriendo)
  const priceMinOptions = useMemo(() => {
    const saleMin = [100000000, 200000000, 350000000, 500000000, 800000000, 1200000000];
    const rentMin = [300000, 500000, 800000, 1200000, 2000000];
    const vals = isRent ? rentMin : saleMin;
    return [{ label: 'Mínimo', value: '' }, ...vals.map(v => ({ label: formatPriceForCurrency(v, currency), value: String(v) }))];
  }, [currency, isRent, rates]);

  const priceMaxOptions = useMemo(() => {
    const saleMax = [250000000, 450000000, 700000000, 1000000000, 1800000000, 3500000000];
    const rentMax = [600000, 1000000, 1500000, 2500000, 4000000, 8000000];
    const vals = isRent ? rentMax : saleMax;
    return [{ label: 'Máximo', value: '' }, ...vals.map(v => ({ label: formatPriceForCurrency(v, currency), value: String(v) }))];
  }, [currency, isRent, rates]);

  const allPropertyTypes: { id: PropertyType; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Todos', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'apartment', label: 'Departamentos', icon: <Building2 className="w-3.5 h-3.5" /> },
    { id: 'house', label: 'Casas', icon: <Home className="w-3.5 h-3.5" /> },
    { id: 'premium', label: 'Premium', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'parcel', label: 'Parcelas', icon: <Trees className="w-3.5 h-3.5" /> },
    { id: 'office', label: 'Oficinas', icon: <Briefcase className="w-3.5 h-3.5" /> },
    { id: 'land', label: 'Terrenos', icon: <Building className="w-3.5 h-3.5" /> },
    { id: 'parking', label: 'Estacionamientos', icon: <Car className="w-3.5 h-3.5" /> },
    { id: 'local', label: 'Locales', icon: <Store className="w-3.5 h-3.5" /> },
    { id: 'warehouse', label: 'Bodegas', icon: <Warehouse className="w-3.5 h-3.5" /> },
  ];

  // Solo mostrar categorías con stock (count > 0), siempre mostrar "Todos"
  const propertyTypes = allPropertyTypes.filter(
    (t) => t.id === 'all' || (categoryCounts[t.id] ?? 0) > 0
  );

  const bedroomOptionsDepartamento = [
    { label: 'Any', value: '' },
    { label: 'Estudio', value: '0' },
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '4', value: '4' },
    { label: '5+', value: '5' },
  ];

  const bedroomOptionsDefault = [
    { label: 'Any', value: '' },
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '4', value: '4' },
    { label: '5+', value: '5' },
  ];

  const bedroomOptions = filters.propertyType === 'apartment'
    ? bedroomOptionsDepartamento
    : bedroomOptionsDefault;

  const bathroomOptions = [
    { label: 'Any', value: '' },
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '4+', value: '4' },
  ];

  const privateOptions = [
    { label: 'Any', value: '' },
    { label: 'PL', value: '0' },
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '4+', value: '4' },
  ];

  // ¿Qué filtros mostrar según el tipo de propiedad?
  const showBedrooms = filters.propertyType === 'apartment' || filters.propertyType === 'house' || filters.propertyType === 'premium';
  const showBathrooms = filters.propertyType === 'apartment' || filters.propertyType === 'house' || filters.propertyType === 'premium' || filters.propertyType === 'office';
  const showPrivates = filters.propertyType === 'office';
  const handleReset = () => {
    setLocalSearch('');
    if (onResetAll) {
      onResetAll();
    } else {
      onFilterChange({
        operationType: filters.operationType,
        minPrice: null,
        maxPrice: null,
        minBedrooms: null,
        minBathrooms: null,
        minPrivates: null,
        propertyType: 'all',
        searchQuery: '',
        newPropertyType: null,
      });
    }
  };

  const handleOperationChange = (op: 'for_sale' | 'for_rent') => {
    onFilterChange({
      ...filters,
      operationType: op,
      minPrice: null,
      maxPrice: null,
    });
  };

  const hasActiveFilters =
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    filters.minBedrooms !== null ||
    filters.minBathrooms !== null ||
    filters.minPrivates !== null ||
    filters.propertyType !== 'all' ||
    filters.newPropertyType !== null ||
    filters.searchQuery !== '' ||
    selectedCommune !== null;

  return (
    <div className="relative z-30 bg-white border-b border-slate-200 px-4 py-3 shadow-xs">
      <div className="flex flex-col gap-3">
        {/* Fila 1: Segmented Toggle Comprar / Arrendar, Selector GIS, Búsqueda, Botón Nearby y Categorías */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle Comprar vs Arrendar */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-inner">
            <button
              type="button"
              onClick={() => handleOperationChange('for_sale')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                !isRent
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Comprar</span>
              <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
                !isRent ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
              }`} suppressHydrationWarning>{operationCounts.for_sale}</span>
            </button>
            <button
              type="button"
              onClick={() => handleOperationChange('for_rent')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                isRent
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Arrendar</span>
              <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
                isRent ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
              }`} suppressHydrationWarning>{operationCounts.for_rent}</span>
            </button>
          </div>

          {/* Selector de Región y Comuna GIS de Chile */}
          {onSelectLocation && (
            <LocationSelector
              selectedRegion={selectedRegion}
              selectedCommune={selectedCommune}
              onSelectLocation={onSelectLocation}
              communeCounts={communeCounts}
              totalAllProperties={totalAllProperties}
            />
          )}

          {/* Campo de búsqueda de comunas con autocomplete */}
          <div className="relative w-[200px] sm:w-[240px] shrink-0" ref={dropdownRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar por Comuna"
              value={localSearch}
              onChange={(e) => {
                const val = e.target.value;
                setLocalSearch(val);
                setShowSuggestions(true);
                // Aplicar filtro de texto inmediatamente para filtrar el grid
                onFilterChange({ ...filters, searchQuery: val });
              }}
              onFocus={() => localSearch.trim() && setShowSuggestions(true)}
              className="w-full pl-9 pr-7 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
            {localSearch && (
              <button
                onClick={() => { setLocalSearch(''); setShowSuggestions(false); onFilterChange({ ...filters, searchQuery: '' }); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Dropdown de sugerencias */}
            {showSuggestions && communeSuggestions.length > 0 && (
              <div className="absolute left-0 top-full mt-1 w-full bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                <div className="p-1.5 max-h-[240px] overflow-y-auto">
                  {communeSuggestions.map((commune) => (
                    <button
                      key={`${commune.regionName}-${commune.name}`}
                      onClick={() => selectCommune(commune)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors group ${
                        selectedCommune === commune.name
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className={`w-3.5 h-3.5 ${selectedCommune === commune.name ? 'text-blue-600' : 'text-slate-300 group-hover:text-blue-500'}`} />
                        <div>
                          <div className={`text-xs font-bold ${selectedCommune === commune.name ? 'text-blue-700' : 'text-slate-900'}`}>{commune.name}</div>
                          <div className="text-[10px] text-slate-400">{commune.regionName}</div>
                        </div>
                      </div>
                      {communeCounts[commune.name] > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {communeCounts[commune.name]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showSuggestions && localSearch.trim() && communeSuggestions.length === 0 && (
              <div className="absolute left-0 top-full mt-1 w-full bg-white rounded-xl shadow-2xl border border-slate-200 z-50 p-4 text-center">
                <p className="text-xs text-slate-500">No se encontró la comuna "{localSearch}"</p>
                <p className="text-[10px] text-slate-400 mt-1">Intenta con otro nombre</p>
              </div>
            )}
          </div>

          {/* Buscador de POIs / direcciones — junto al buscador por comuna */}
          {poiSearchSlot}

          {/* Botón de Mi Ubicación (Nearby) — icono + contador */}
          {onToggleNearby && (
            <button
              onClick={onToggleNearby}
              className={`relative flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                nearbyActive
                  ? 'bg-red-600 text-white shadow-sm shadow-red-500/20'
                  : 'bg-blue-600 text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700'
              }`}
              title={nearbyActive ? 'Todas' : 'Mi Ubicación'}
            >
              <Radio className={`w-4 h-4 ${nearbyActive ? 'animate-pulse' : ''}`} />
              {nearbyActive && nearbyCount !== undefined && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-extrabold bg-blue-500 text-white rounded-full border border-white">
                  {nearbyCount}
                </span>
              )}
            </button>            )}

          {/* Botón Nuevas — Verde con dropdown */}
          <PropiedadesNuevasButton
            value={filters.newPropertyType}
            onChange={(val) => onFilterChange({ ...filters, newPropertyType: val })}
            count={newPropertiesCount}
          />

          {/* Selector de Moneda + Rango de Precios */}
          <div className="flex items-center gap-1.5">
          <div className="inline-flex items-center gap-0.5 rounded-xl bg-slate-100 p-1 border border-slate-200">
            {/* Botones de Moneda */}
            <div className="inline-flex rounded-lg bg-slate-200/60 p-0.5">
              {([
                { id: 'CLP' as Currency, symbol: '$' },
                { id: 'UF' as Currency, symbol: 'UF' },
                { id: 'USD' as Currency, symbol: 'US$' },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setCurrency(opt.id)}
                  className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition-all ${
                    currency === opt.id
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.symbol}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 px-1.5">
              <select
                value={filters.minPrice ?? ''}
                onChange={(e) => onFilterChange({ ...filters, minPrice: e.target.value ? Number(e.target.value) : null })}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 shadow-sm"
              >
                {priceMinOptions.map((opt, i) => (
                  <option key={i} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <span className="text-[10px] text-slate-400 font-bold">-</span>
              <select
                value={filters.maxPrice ?? ''}
                onChange={(e) => onFilterChange({ ...filters, maxPrice: e.target.value ? Number(e.target.value) : null })}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 shadow-sm"
              >
                {priceMaxOptions.map((opt, i) => (
                  <option key={i} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

          </div>
          </div>

          {/* Selector de Tipo de Inmueble con Superíndice Contador */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {propertyTypes.map((type) => {
              const count = categoryCounts[type.id] ?? 0;
              const isSelected = filters.propertyType === type.id;
              const hasNewStock = newPropertyType !== null && count > 0;

              return (
                <button
                  key={type.id}
                  onClick={() => onFilterChange({ ...filters, propertyType: type.id })}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                      : hasNewStock
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {type.icon}
                  <span>{type.label}</span>
                  
                  <sup
                    className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-extrabold rounded-full -translate-y-1 transition-colors ${
                      isSelected
                        ? 'bg-white/30 text-white'
                        : hasNewStock
                        ? 'bg-emerald-200 text-emerald-800'
                        : 'bg-blue-100 text-blue-700 group-hover:bg-blue-200'
                    }`}
                  >
                    {count}
                  </sup>
                </button>
              );
            })}
          </div>

          {/* Botón Limpiar — siempre visible, para poder volver al inicio en cualquier momento.
              Se resalta en rojo cuando hay filtros activos y queda neutro cuando no hay nada que limpiar. */}
          <button
            onClick={handleReset}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all shrink-0 whitespace-nowrap ${
              hasActiveFilters
                ? 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100 hover:border-red-300'
                : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
            }`}
            title={hasActiveFilters ? 'Limpiar todos los filtros' : 'Volver al inicio'}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Limpiar</span>
          </button>

        </div>

        {/* Fila 2: Dormitorios y Baños */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            {/* Selector de Dormitorios — Casas, Departamentos, Premium */}
            {showBedrooms && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500" title="Dormitorios"><Bed className="w-4 h-4 text-blue-500" /></span>
                <select
                  value={filters.minBedrooms ?? ''}
                  onChange={(e) => onFilterChange({ ...filters, minBedrooms: e.target.value ? Number(e.target.value) : null })}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {bedroomOptions.map((opt, i) => (
                    <option key={i} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Selector de Privados — Oficinas (primero) */}
            {showPrivates && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500" title="Privados"><LampDesk className="w-4 h-4 text-blue-500" /></span>
                <select
                  value={filters.minPrivates ?? ''}
                  onChange={(e) => onFilterChange({ ...filters, minPrivates: e.target.value ? Number(e.target.value) : null })}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {privateOptions.map((opt, i) => (
                    <option key={i} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Selector de Baños — Casas, Departamentos, Premium, Oficinas */}
            {showBathrooms && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500" title="Baños"><Bath className="w-4 h-4 text-blue-500" /></span>
                <select
                  value={filters.minBathrooms ?? ''}
                  onChange={(e) => onFilterChange({ ...filters, minBathrooms: e.target.value ? Number(e.target.value) : null })}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {bathroomOptions.map((opt, i) => (
                    <option key={i} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

          </div>


        </div>
      </div>
    </div>
  );
}
