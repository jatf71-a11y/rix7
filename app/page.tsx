'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Property, PropertyFilterState, PropertyType } from '@/lib/types/property';
import { PropertyMap } from '@/components/map/PropertyMap';
import { PropertyFilters } from '@/components/properties/PropertyFilters';
import { PropertyGrid } from '@/components/properties/PropertyGrid';
import { FeaturedCarousel } from '@/components/properties/FeaturedCarousel';
import { PartnerLogosCarousel } from '@/components/properties/PartnerLogosCarousel';
import { SaveSearchButton } from '@/components/properties/SaveSearchButton';
import { PoiSearchInput, SelectedPoiLocation } from '@/components/properties/PoiSearchInput';
import { findNearestChileLocation } from '@/lib/data/chileLocations';
import { useRegistration } from '@/components/auth/RegistrationProvider';
import { firstNameOf } from '@/lib/utils/registration';
import { Map, List, Loader2 } from 'lucide-react';

// ═══ HAVERSINE: Distancia en km entre dos coordenadas ═══
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ═══ Default category counts ═══
const DEFAULT_COUNTS: Record<PropertyType, number> = {
  all: 0, apartment: 0, house: 0, premium: 0, parcel: 0,
  office: 0, land: 0, parking: 0, local: 0, warehouse: 0,
};

function HomePageContent() {
  const searchParams = useSearchParams();
  // Reconocimiento del usuario que vuelve: el mismo que ve en el Navbar.
  const { registration, isChecking } = useRegistration();
  const initialOperation = searchParams.get('operation') === 'rent' ? 'for_rent' : 'for_sale';

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO GLOBAL
  // ═══════════════════════════════════════════════════════════════════════════
  const [serverProperties, setServerProperties] = useState<Property[]>([]);
  const [serverCategoryCounts, setServerCategoryCounts] = useState<Record<PropertyType, number>>(DEFAULT_COUNTS);
  const [serverOperationCounts, setServerOperationCounts] = useState({ for_sale: 0, for_rent: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filtros UI
  const [filters, setFilters] = useState<PropertyFilterState>({
    operationType: initialOperation,
    minPrice: null,
    maxPrice: null,
    minBedrooms: null,
    minBathrooms: null,
    minPrivates: null,
    propertyType: 'all',
    searchQuery: '',
    newPropertyType: null,
  });

  // Ubicación GIS
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedCommune, setSelectedCommune] = useState<string | null>(null);
  const [targetLocation, setTargetLocation] = useState<{ lat: number; lng: number; zoom: number } | null>(null);

  // Centro del mapa: Plaza de Armas de la ciudad del usuario (se detecta al montar)
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: -33.4425, lng: -70.6530 }); // Santiago por defecto

  // Ciudad detectada automáticamente al visitar la web
  const [detectedCity, setDetectedCity] = useState<{
    name: string;
    regionName?: string;
    lat: number;
    lng: number;
    isGps?: boolean;
  } | null>(null);

  // Ubicación del usuario (pin en el mapa) — se setea en la primera visita vía GPS
  // o cuando presiona "Mi Ubicación". nearbyActive (filtro 5km) solo se activa con el botón.
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearbyActive, setNearbyActive] = useState(false);
  // Búsqueda alrededor de un punto de interés / dirección aproximada (POI)
  const [activePoi, setActivePoi] = useState<SelectedPoiLocation | null>(null);
  const NEARBY_RADIUS_KM = 5;

  // Hover / Select en mapa
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('map');

  // Al montar, detectar la ciudad del usuario mediante /api/geo (headers Vercel / IP)
  // y afinar con GPS de navegador si está disponible.
  useEffect(() => {
    let cancelled = false;

    // 1. Detección rápida vía endpoint interno /api/geo (sin problemas de CSP ni CORS)
    fetch('/api/geo')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled || !data?.success) return;
        const cityData = {
          name: data.city || data.communeName || 'Santiago',
          regionName: data.regionName,
          lat: data.lat,
          lng: data.lng,
          isGps: false,
        };
        setDetectedCity((prev) => (prev?.isGps ? prev : cityData));
        setMapCenter({ lat: data.lat, lng: data.lng });
      })
      .catch(() => {
        // Fallback: Santiago centro (ya es el default de mapCenter)
      });

    // 2. Si el navegador soporta Geolocation API, consultar de forma no intrusiva.
    //    Si el usuario ya denegó el permiso, no insistimos: pedirlo igual solo
    //    genera ruido de errores del proveedor de ubicación de Chrome (403) sin
    //    ninguna posibilidad de éxito. La detección por /api/geo se mantiene.
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      const requestGpsPosition = () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const nearest = findNearestChileLocation(pos.coords.latitude, pos.coords.longitude);
            setDetectedCity({
              name: nearest.communeName,
              regionName: nearest.regionName,
              lat: nearest.lat,
              lng: nearest.lng,
              isGps: true,
            });
            setMapCenter({ lat: nearest.lat, lng: nearest.lng });
            // Primera visita: mostrar la ubicación real del usuario en el mapa
            // (MapContainerInner centra el mapa y dibuja el pin rojo).
            setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          },
          () => {
            // Si el usuario no otorga permisos o falla, se mantiene la detección por /api/geo
          },
          { enableHighAccuracy: false, timeout: 4000, maximumAge: 300000 }
        );
      };

      if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
        navigator.permissions
          .query({ name: 'geolocation' as PermissionName })
          .then((status) => {
            if (!cancelled && status.state !== 'denied') requestGpsPosition();
          })
          .catch(() => {
            if (!cancelled) requestGpsPosition();
          });
      } else {
        requestGpsPosition();
      }
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH: Server-side filtering con debounce
  // ═══════════════════════════════════════════════════════════════════════════
  const abortRef = useRef<AbortController | null>(null);

  const fetchProperties = useCallback((filterState: PropertyFilterState, region: string | null, commune: string | null) => {
    // Cancelar request anterior
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    params.set('operation', filterState.operationType);
    params.set('propertyType', filterState.propertyType);
    params.set('page', '1');
    params.set('limit', '2000');
    if (filterState.minPrice) params.set('minPrice', String(filterState.minPrice));
    if (filterState.maxPrice) params.set('maxPrice', String(filterState.maxPrice));
    if (filterState.minBedrooms !== null) params.set('minBedrooms', String(filterState.minBedrooms));
    if (filterState.minBathrooms !== null) params.set('minBathrooms', String(filterState.minBathrooms));
    if (filterState.minPrivates !== null) params.set('minPrivates', String(filterState.minPrivates));
    if (filterState.searchQuery) params.set('search', filterState.searchQuery);
    if (filterState.newPropertyType) params.set('newPropertyType', filterState.newPropertyType);
    if (region) params.set('region', region);
    if (commune) params.set('commune', commune);

    setIsLoading(true);

    fetch(`/api/properties?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          setServerProperties(result.data);
          setServerCategoryCounts(result.categoryCounts || DEFAULT_COUNTS);
          setServerOperationCounts(result.operationCounts || { for_sale: 0, for_rent: 0 });
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Error loading properties:', err);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Debounced fetch: dispara request 300ms después de que el usuario deja de cambiar filtros
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedFetch = useCallback((filterState: PropertyFilterState, region: string | null, commune: string | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProperties(filterState, region, commune);
    }, 300);
  }, [fetchProperties]);

  // Re-fetch cuando cambian los filtros relevantes (NO nearby — eso es client-side)
  useEffect(() => {
    debouncedFetch(filters, selectedRegion, selectedCommune);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters.operationType, filters.propertyType, filters.minPrice, filters.maxPrice, filters.minBedrooms, filters.minBathrooms, filters.minPrivates, filters.searchQuery, filters.newPropertyType, selectedRegion, selectedCommune, debouncedFetch]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTRADO CLIENT-SIDE: Solo nearby mode (necesita GPS del usuario)
  // ═══════════════════════════════════════════════════════════════════════════
  const propertiesFiltered = useMemo(() => {
    // Modo POI: filtrar alrededor del punto de interés / dirección seleccionado
    if (activePoi) {
      return serverProperties.filter((p) => {
        const dist = haversineDistance(activePoi.lat, activePoi.lng, p.lat, p.lng);
        return dist <= activePoi.radiusKm;
      });
    }
    if (!nearbyActive || !userLocation) return serverProperties;
    return serverProperties.filter((p) => {
      const dist = haversineDistance(userLocation.lat, userLocation.lng, p.lat, p.lng);
      return dist <= NEARBY_RADIUS_KM;
    });
  }, [serverProperties, nearbyActive, userLocation, activePoi]);

  // 2. Contadores de categorías — server-side o client-side (nearby / POI)
  const categoryCounts = useMemo(() => {
    if (!activePoi && (!nearbyActive || !userLocation)) return serverCategoryCounts;
    // Recalcular contadores desde el set filtrado (nearby o alrededor del POI)
    const counts: Record<PropertyType, number> = { ...DEFAULT_COUNTS, all: propertiesFiltered.length };
    for (const p of propertiesFiltered) {
      if (counts[p.property_type] !== undefined) counts[p.property_type]++;
    }
    return counts;
  }, [serverCategoryCounts, propertiesFiltered, nearbyActive, userLocation, activePoi]);

  // 3. Conteo por operación — server-side o client-side (nearby / POI)
  const operationCounts = useMemo(() => {
    if (!activePoi && (!nearbyActive || !userLocation)) return serverOperationCounts;
    let for_sale = 0;
    let for_rent = 0;
    for (const p of propertiesFiltered) {
      if (p.status === 'for_sale') for_sale++;
      else if (p.status === 'for_rent') for_rent++;
    }
    return { for_sale, for_rent };
  }, [serverOperationCounts, propertiesFiltered, nearbyActive, userLocation, activePoi]);

  // 4. Conteo por comuna (para LocationSelector dropdown)
  const communeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of serverProperties) {
      if (p.city) counts[p.city] = (counts[p.city] || 0) + 1;
    }
    return counts;
  }, [serverProperties]);

  // 5. Conteo de propiedades nuevas (year_built > currentYear)
  const currentYear = new Date().getFullYear();
  const newPropertiesCount = useMemo(() => {
    return serverProperties.filter((p) => p.year_built != null && p.year_built > currentYear).length;
  }, [serverProperties, currentYear]);

  // 6. Conteo por socio (partner_id) para el carrusel de socios
  const partnerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of serverProperties) {
      if (p.partner_id) {
        counts[p.partner_id] = (counts[p.partner_id] || 0) + 1;
      }
    }
    return counts;
  }, [serverProperties]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSelectLocation = useCallback((loc: {
    regionName: string;
    communeName: string | null;
    lat: number;
    lng: number;
    zoom: number;
  }) => {
    const effectiveRegion = loc.regionName || null;
    setSelectedRegion(effectiveRegion);
    setSelectedCommune(loc.communeName);
    setTargetLocation({ lat: loc.lat, lng: loc.lng, zoom: loc.zoom });
    setNearbyActive(false);
    setActivePoi(null);
  }, []);

  // Seleccionar un punto de interés / dirección para buscar alrededor
  const handleSelectPoi = useCallback((poi: SelectedPoiLocation | null) => {
    if (!poi) {
      setActivePoi(null);
      setTargetLocation(null);
      return;
    }
    setActivePoi(poi);
    setNearbyActive(false);
    setSelectedRegion(null);
    setSelectedCommune(null);
    setTargetLocation({ lat: poi.lat, lng: poi.lng, zoom: poi.zoom || 14.5 });
    // Resetear filtros de búsqueda para traer todo y filtrar alrededor del punto
    setFilters((prev) => ({
      ...prev,
      searchQuery: '',
      propertyType: 'all',
      minPrice: null,
      maxPrice: null,
      minBedrooms: null,
      minBathrooms: null,
      minPrivates: null,
      newPropertyType: null,
    }));
  }, []);

  // Ajustar el radio de la búsqueda alrededor del POI (1/2/3/5 km)
  const handlePoiRadiusChange = useCallback((km: number) => {
    setActivePoi((prev) => (prev ? { ...prev, radiusKm: km } : prev));
  }, []);

  const handleFilterChange = useCallback((newFilters: PropertyFilterState) => {
    setFilters(newFilters);
  }, []);

  // Callbacks de mapa/tarjetas con identidad estable: evitan que el grid y los
  // pines se re-rendericen en cada cambio de estado de la página.
  const handleHoverProperty = useCallback((id: string | null) => {
    setHoveredPropertyId(id);
    setSelectedPropertyId(id);
  }, []);

  const handlePropertySelect = useCallback((id: string | null) => {
    setSelectedPropertyId(id);
    setHoveredPropertyId(id);
  }, []);

  // Activar nearby: limpiar filtros geográficos y buscar por GPS
  const activateNearby = useCallback((lat: number, lng: number) => {
    setUserLocation({ lat, lng });
    setNearbyActive(true);
    setSelectedRegion(null);
    setSelectedCommune(null);
    setTargetLocation({ lat, lng, zoom: 13 });
    // Resetear filtros de búsqueda y geográficos para traer todo desde el server
    setFilters((prev) => ({
      ...prev,
      searchQuery: '',
      propertyType: 'all',
      minPrice: null,
      maxPrice: null,
      minBedrooms: null,
      minBathrooms: null,
      minPrivates: null,
      newPropertyType: null,
    }));
  }, []);

  // Toggle nearby — si no hay ubicación, solicitar GPS
  const DEV_FALLBACK = { lat: -33.4489, lng: -70.6693 }; // Santiago centro
  const toggleNearby = useCallback(() => {
    if (nearbyActive) {
      // Desactivar nearby
      setNearbyActive(false);
      setUserLocation(null);
      return;
    }
    // El modo "cerca de mí" reemplaza la búsqueda alrededor de un POI
    setActivePoi(null);
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    const resolve = (lat: number, lng: number) => {
      if (resolved) return;
      resolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      activateNearby(lat, lng);
    };
    // Timeout de seguridad: si GPS no responde en 3s, usar fallback
    fallbackTimer = setTimeout(() => {
      resolve(DEV_FALLBACK.lat, DEV_FALLBACK.lng);
    }, 3000);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        resolve(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        resolve(DEV_FALLBACK.lat, DEV_FALLBACK.lng);
      },
      { enableHighAccuracy: false, timeout: 2500 }
    );
  }, [nearbyActive, activateNearby]);

  // Limpiar TODO: filtros, ubicación, nearby, búsqueda
  // Devuelve el portal a su estado inicial, mapa incluido: sin esto el mapa
  // quedaba ajustado a todo Chile al cambiar el set de propiedades.
  const handleResetAll = useCallback(() => {
    setSelectedRegion(null);
    setSelectedCommune(null);
    setNearbyActive(false);
    setActivePoi(null);
    setUserLocation(null);
    setFilters({
      operationType: 'for_sale',
      minPrice: null,
      maxPrice: null,
      minBedrooms: null,
      minBathrooms: null,
      minPrivates: null,
      propertyType: 'all',
      searchQuery: '',
      newPropertyType: null,
    });
    // Recentrar en la ciudad detectada al abrir el portal (Plaza de Armas).
    const home = detectedCity ?? mapCenter;
    setTargetLocation({ lat: home.lat, lng: home.lng, zoom: 13 });
  }, [detectedCity, mapCenter]);

  // ═══════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  const locationTitle = activePoi
    ? `Cerca de ${activePoi.name}`
    : nearbyActive && userLocation
      ? `Cerca de ti (${NEARBY_RADIUS_KM}km)`
      : selectedCommune || selectedRegion || 'Chile';
  const operationText = filters.operationType === 'for_rent' ? 'Arriendo' : 'Venta';
  const totalAllProperties = operationCounts.for_sale + operationCounts.for_rent;

  // ¿Estamos en estado por defecto? (sin filtros aplicados)
  const isDefaultState = !nearbyActive && !activePoi && !selectedRegion && !selectedCommune &&
    filters.propertyType === 'all' && filters.minPrice === null && filters.maxPrice === null &&
    filters.minBedrooms === null && filters.minBathrooms === null && filters.minPrivates === null &&
    filters.searchQuery === '' && filters.newPropertyType === null;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Barra Superior de Filtros */}
      <PropertyFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        categoryCounts={categoryCounts}
        selectedRegion={selectedRegion}
        selectedCommune={selectedCommune}
        onSelectLocation={handleSelectLocation}
        communeCounts={communeCounts}
        totalAllProperties={totalAllProperties}
        operationCounts={operationCounts}
        nearbyActive={nearbyActive}
        onToggleNearby={toggleNearby}
        nearbyCount={nearbyActive ? propertiesFiltered.length : undefined}
        newPropertyType={filters.newPropertyType}
        newPropertiesCount={newPropertiesCount}
        onResetAll={handleResetAll}
        /* Buscador de POIs / direcciones: va a la derecha del buscador por comuna */
        poiSearchSlot={
          <PoiSearchInput
            activePoi={activePoi}
            onSelectPoi={handleSelectPoi}
            onRadiusChange={handlePoiRadiusChange}
            totalResultsInRadius={activePoi ? propertiesFiltered.length : undefined}
          />
        }
      />

      {/* Botón Flotante Móviles */}
      <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <button
          onClick={() => setMobileView(mobileView === 'list' ? 'map' : 'list')}
          className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white font-bold text-sm rounded-full shadow-2xl hover:bg-blue-600 transition-all scale-105 active:scale-95"
        >
          {mobileView === 'list' ? (
            <>
              <Map className="w-4 h-4 text-blue-400" />
              <span>Ver Mapa ({propertiesFiltered.length})</span>
            </>
          ) : (
            <>
              <List className="w-4 h-4 text-blue-400" />
              <span>Ver Lista de Propiedades</span>
            </>
          )}
        </button>
      </div>

      {/* Split Layout: Grid | Mapa */}
      <div className="flex-1 grid grid-rows-[1fr] grid-cols-1 md:grid-cols-12 overflow-hidden relative min-h-0">
        {/* Grid de Propiedades */}
        <section
          className={`md:col-span-6 lg:col-span-7 h-full min-h-0 p-2 pt-3 md:px-4 md:pt-[52px] md:pb-4 ${
            mobileView === 'map' ? 'hidden md:block' : 'block'
          }`}
        >
          <div className="p-4 pb-20 md:pb-6 h-full rounded-2xl border border-slate-200 overflow-y-auto shadow-sm bg-white">
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900">
                  Propiedades en {operationText} en {locationTitle}
                </h1>
                {isLoading && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Cargando...
                  </span>
                )}
              </div>
              {/* El saludo va dentro de este grupo alineado a la derecha: al
                  aparecer crece hacia la izquierda y no desplaza ni al título
                  ni al contador (nada salta de sitio después de hidratar). */}
              <div className="flex items-center gap-2 shrink-0">
                {!isChecking && registration && (
                  <span
                    className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md"
                    title={`Sesión de ${registration.email}`}
                  >
                    Hola, {firstNameOf(registration.name)}
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-500" suppressHydrationWarning>
                  {propertiesFiltered.length} resultados
                </span>
                {/* Guardar la búsqueda: es lo que le da un motivo real a la
                    cuenta. Va en este grupo alineado a la derecha para que al
                    aparecer no desplace el título ni el contador. */}
                <SaveSearchButton
                  filters={{
                    operationType: filters.operationType,
                    propertyType: filters.propertyType,
                    newPropertyType: filters.newPropertyType,
                    searchQuery: filters.searchQuery,
                    minPrice: filters.minPrice,
                    maxPrice: filters.maxPrice,
                    minBedrooms: filters.minBedrooms,
                    minBathrooms: filters.minBathrooms,
                    minPrivates: filters.minPrivates,
                  }}
                  commune={selectedCommune}
                  region={selectedRegion}
                />
              </div>
            </div>

            {/* Vista: Carrusel destacado (sin filtros) o Grid de propiedades (con filtros) */}
            {isDefaultState && !isLoading && propertiesFiltered.length > 0 ? (
              <FeaturedCarousel
                properties={propertiesFiltered}
              />
            ) : (
              <PropertyGrid
                properties={propertiesFiltered}
                loading={isLoading}
                hoveredPropertyId={hoveredPropertyId}
                onHoverProperty={handleHoverProperty}
                onResetFilters={handleResetAll}
              />
            )}

            {/* Socios estratégicos — debajo de las propiedades nuevas y destacadas,
                y solo en la vista por defecto para no competir con la grilla */}
            {isDefaultState && !isLoading && propertiesFiltered.length > 0 && (
              <PartnerLogosCarousel partnerCounts={partnerCounts} />
            )}
          </div>
        </section>

        {/* Mapa GIS */}
        <section
          className={`md:col-span-6 lg:col-span-5 h-full min-h-0 relative p-2 pt-3 md:px-4 md:pt-[52px] md:pb-4 ${
            mobileView === 'list' ? 'hidden md:block' : 'block'
          }`}
        >
          <div className="h-full rounded-2xl border border-slate-200 overflow-hidden shadow-sm relative bg-white">
          <PropertyMap
            properties={propertiesFiltered}
            selectedPropertyId={hoveredPropertyId || selectedPropertyId}
            targetLocation={targetLocation}
            nearbyActive={nearbyActive}
            externalUserLocation={userLocation}
            mapCenter={mapCenter}
            detectedCity={detectedCity}
            activePoi={activePoi}
            onPropertySelect={handlePropertySelect}
          />
          </div>
        </section>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-50">Cargando Rix7...</div>}>
      <HomePageContent />
    </Suspense>
  );
}
