'use client';

// Estilos de Leaflet y del plugin de clustering. Antes estaban en `app/layout.tsx`
// y se bajaban en todas las páginas; acá viajan en el chunk de este componente,
// que la ficha carga con `dynamic()`.
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import React, { useEffect, useState, useRef } from 'react';
import { Loader2, GraduationCap, Stethoscope, BusFront, ShoppingCart, Dumbbell, Trees, ShieldCheck, UtensilsCrossed, Landmark, Map as MapIcon, ChevronDown, AlertTriangle, RotateCw, X, History } from 'lucide-react';
import { POI_CATEGORIES, poiSvgMarkup, poiImportance, poiMarkerSize, WALKABLE_RADIUS_M } from '@/lib/data/poiCategories';
import { getCacheKey, getCachedPOIs, getStalePOIs, setCachedPOIs } from '@/lib/utils/overpassCache';
import { buildEducationSummary, buildSectorSummaries } from '@/lib/utils/sectorSummary';

export interface POI {
  id: number;
  lat: number;
  lng: number;
  name: string;
  type: string;
  typeLabel: string;
  category: string;
  color: string;
  svg: string;
}

interface PropertyMapLeafletProps {
  lat: number;
  lng: number;
  title: string;
  address: string;
  city: string;
}

// ═══ Íconos Lucide por categoría (solo vista; la config base vive en lib/data/poiCategories) ═══
const POI_ICONS: Record<string, any> = {
  education: GraduationCap,
  health: Stethoscope,
  transport: BusFront,
  shopping: ShoppingCart,
  sports: Dumbbell,
  park: Trees,
  safety: ShieldCheck,
  leisure: UtensilsCrossed,
  services: Landmark,
};

// ═══ Popup del pin de la propiedad: título + dirección + descripción educativa ═══
// `summary` llega cuando los POIs están cargados (null antes del fetch).
const propertyPopupHtml = (title: string, address: string, summary: string | null) =>
  `<div style="text-align:center;padding:4px;max-width:240px;">` +
  `<strong style="font-size:13px;">${title}</strong><br/>` +
  `<span style="font-size:11px;color:#666;">${address}</span>` +
  (summary
    ? `<div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:6px;text-align:left;">` +
      `<div style="font-size:11px;font-weight:700;color:#1d4ed8;display:flex;align-items:center;gap:5px;">` +
      poiSvgMarkup('education', POI_CATEGORIES.education?.color || '#2563eb', 14) +
      `Perfil educativo del sector</div>` +
      `<div style="font-size:10.5px;color:#475569;line-height:1.5;margin-top:3px;">${summary}</div>` +
      `</div>`
    : '') +
  `</div>`;

export default function PropertyMapLeaflet({ lat, lng, title, address, city }: PropertyMapLeafletProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const clusterRef = useRef<any>(null);
  // Marcador azul de la propiedad: su popup se enriquece al llegar los POIs
  const propertyMarkerRef = useRef<any>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  // Cantidad de POIs por categoría dentro del área visible del mapa
  const [viewportCounts, setViewportCounts] = useState<Record<string, number>>({});
  const [isMapReady, setIsMapReady] = useState(false);
  const [pois, setPois] = useState<POI[]>([]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [poisError, setPoisError] = useState(false);
  // Respaldo: POIs vencidos de caché local mostrados cuando Overpass falla
  const [staleInfo, setStaleInfo] = useState<{ ageHours: number } | null>(null);
  // Permite al botón "Reintentar" relanzar el fetch del efecto
  const fetchPoisRef = useRef<(() => void) | null>(null);
  const [activeCategories, setActiveCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(POI_CATEGORIES).map((key) => [key, true]))
  );

  // ═══ Inicializar Leaflet directamente ═══
  useEffect(() => {
    if (!mapRef.current) return;

    // Si ya hay un mapa, limpiarlo primero
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      // Limpiar el contenedor
      if (mapRef.current) {
        mapRef.current.innerHTML = '';
      }
    }

    let cancelled = false;

    const initMap = async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapRef.current) return;

      // El ícono por defecto de Leaflet resuelve sus imágenes desde el bundle,
      // y eso rompía con el hashing de Next. Se apunta a copias propias en
      // `/leaflet/` (las deja `scripts/sync-leaflet-icons.mjs` en postinstall):
      // antes venían de cdnjs, que el CSP bloqueaba en producción.
      // Ojo: hoy todos los marcadores usan `divIcon`, así que estas imágenes no
      // se piden; están para que un `L.marker` sin ícono propio funcione igual.
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: '/leaflet/marker-icon-2x.png',
        iconUrl: '/leaflet/marker-icon.png',
        shadowUrl: '/leaflet/marker-shadow.png',
      });

      const map = L.map(mapRef.current!, {
        center: [lat, lng],
        zoom: 15,
        scrollWheelZoom: false,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Marcador de la propiedad
      const propertyIcon = L.divIcon({
        html: `<div style="width:24px;height:24px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const propertyMarker = L.marker([lat, lng], { icon: propertyIcon })
        .addTo(map)
        .bindPopup(propertyPopupHtml(title, address, null));
      propertyMarkerRef.current = propertyMarker;

      if (!cancelled) {
        mapInstanceRef.current = map;
        setIsMapReady(true);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      clusterRef.current = null;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        setIsMapReady(false);
      }
    };
  }, [lat, lng, title, address]);

  // ═══ Fetch POIs desde Overpass API ═══
  useEffect(() => {
    if (!isMapReady) return;

    const fetchPOIs = async () => {
      setLoadingPois(true);
      setPoisError(false);
      setStaleInfo(null);
      const radius = 1500;

      // ═══ 1. Revisar caché (memoria + localStorage, TTL 24h) ═══
      const cacheKey = getCacheKey(lat, lng, radius);
      const cached = getCachedPOIs(cacheKey);
      if (cached) {
        setPois(cached);
        setLoadingPois(false);
        return;
      }

      // ═══ 2. Cache miss — consultar nuestra API (proxy server-side de Overpass) ═══
      // Los espejos de Overpass, la categorización y el rate limit viven en
      // /api/pois; el cliente solo consume JSON ya procesado.
      try {
        const response = await fetch(`/api/pois?lat=${lat}&lng=${lng}`);
        if (!response.ok) throw new Error(`API POIs error: ${response.status}`);

        const json = await response.json();
        const parsed: POI[] = json?.data || [];

        setPois(parsed);
        // ═══ 3. Guardar en caché para futuras visitas ═══
        // Las respuestas degradadas NO se cachean en localStorage: vienen
        // marcadas `stale: true` (caché vencida del servidor) o
        // `snapshot: true` (fallback estático del build) y podrían quedar
        // "congeladas" 24 h en el navegador aunque Overpass ya responda.
        if (parsed.length > 0 && json?.snapshot !== true && json?.stale !== true) {
          setCachedPOIs(cacheKey, parsed);
        }
      } catch (err) {
        console.error('Error fetching POIs:', err);
        // ═══ 4. Respaldo local: POIs vencidos de caché, si los hay ═══
        // Si existen, ese es el estado (banner "desactualizados"); el banner
        // de error queda reservado para cuando no hay nada que mostrar.
        const stale = getStalePOIs(cacheKey);
        if (stale) {
          setPois(stale.pois);
          setStaleInfo({ ageHours: stale.ageHours });
        } else {
          setPoisError(true);
        }
      } finally {
        setLoadingPois(false);
      }
    };

    fetchPoisRef.current = fetchPOIs;
    fetchPOIs();
  }, [isMapReady, lat, lng]);

  // ═══ Popup de la propiedad: descripción educativa del sector ═══
  // El bind inicial ocurre antes del fetch (sin summary); cuando llegan los
  // POIs (fresh, stale o snapshot) se reescribe el contenido con el resumen.
  useEffect(() => {
    if (!isMapReady) return;
    const marker = propertyMarkerRef.current;
    if (!marker) return;
    const summary = buildEducationSummary(pois, lat, lng);
    marker.setPopupContent(propertyPopupHtml(title, address, null));
  }, [isMapReady, pois, lat, lng, title, address]);

// ═══ Marcadores de POIs en cluster — mismo formato chip de la ficha ═══
// Con cientos de POIs (Comercio/Ocio), los marcadores individuales saturan
// el mapa; markercluster los agrupa por zoom y expande con clic/spiderfy.
const buildMarkerLayer = (L: any, visible: POI[]) => {
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17,
    // Re-render del cluster al cambiar filtros
    chunkedLoading: true,
    iconCreateFunction: (cluster: any) => {
      const count = cluster.getChildCount();
      const categoryCounts: Record<string, number> = {};
      let dominantCategory = 'shopping';
      let maxCount = 0;
      cluster.getAllChildMarkers().forEach((m: any) => {
        const c = m.options.poiCategory as string;
        // Pondera por importancia: una estación de metro pesa más que un
        // paradero al decidir el ícono del cluster
        const weight = 1 + (m.options.poiImportance ?? 0);
        categoryCounts[c] = (categoryCounts[c] || 0) + weight;
        if (categoryCounts[c] > maxCount) {
          maxCount = categoryCounts[c];
          dominantCategory = c;
        }
      });
      const dominant = POI_CATEGORIES[dominantCategory];
      const svg = poiSvgMarkup(dominantCategory, dominant?.color || '#2563eb', 16);
      // Caja chip blanca + badge con el total; el ícono refleja la categoría
      // dominante dentro del cluster
      return L.divIcon({
        html:
          `<div style="position:relative;width:38px;height:38px;background:#ffffff;border:2px solid ${dominant?.color || '#e2e8f0'};border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,0.18);display:flex;align-items:center;justify-content:center;">` +
          svg +
          `<span style="position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;padding:0 4px;background:${dominant?.color || '#2563eb'};color:#fff;font-size:9px;font-weight:700;line-height:16px;text-align:center;border-radius:9999px;border:2px solid #fff;">${count}</span>` +
          `</div>`,
        className: '',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
    },
  });

  visible.forEach((poi) => {
    // Tamaño según importancia del subtipo: estaciones/hospitales/universidades
    // más grandes que paraderos/farmacias/jardines
    const size = poiMarkerSize(poi.type);
    const svgSize = Math.round(size * 0.55);
    const icon = L.divIcon({
      html:
        `<div style="width:${size}px;height:${size}px;background:#ffffff;border:2px solid #e2e8f0;border-radius:${Math.round(size / 3)}px;` +
        `box-shadow:0 2px 6px rgba(15,23,42,0.15);display:flex;align-items:center;justify-content:center;">` +
        poi.svg.replace(/width="\d+" height="\d+"/, `width="${svgSize}" height="${svgSize}"`) +
        `</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([poi.lat, poi.lng], {
      icon,
      // El cluster lee la categoría desde las opciones del marcador
      poiCategory: poi.category,
      // Peso del POI para el ícono del cluster
      poiImportance: poiImportance(poi.type),
      // Los marcadores mayores quedan por encima al superponerse
      zIndexOffset: [0, 400, 800][poiImportance(poi.type)] ?? 0,
    });
    marker.bindPopup(
      `<div style="text-align:center;padding:4px;min-width:140px;">` +
      `<div style="width:40px;height:40px;margin:0 auto 6px;background:#ffffff;border:2px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;">` +
      poi.svg.replace('width="13" height="13"', 'width="18" height="18"') +
      `</div>` +
      `<strong style="font-size:12px;">${poi.name}</strong><br/>` +
      `<span style="font-size:10px;color:#666;">${poi.typeLabel || poi.type}</span>` +
      `</div>`
    );
    cluster.addLayer(marker);
    markersRef.current.push(marker);
  });

  return cluster;
};

// ═══ Actualizar marcadores en el mapa (cluster) ═══
useEffect(() => {
  if (!isMapReady || !mapInstanceRef.current) return;

  const map = mapInstanceRef.current;

  // Limpiar cluster y marcadores anteriores
  if (clusterRef.current) {
    clusterRef.current.clearLayers();
    map.removeLayer(clusterRef.current);
    clusterRef.current = null;
  }
  markersRef.current = [];

  const visible = pois.filter((p) => activeCategories[p.category]);
  if (visible.length === 0) return;

  // Carga del plugin (registra L.markerClusterGroup sobre el mismo L de CJS)
  const L = require('leaflet');
  require('leaflet.markercluster');

  const cluster = buildMarkerLayer(L, visible);
  map.addLayer(cluster);
  clusterRef.current = cluster;
}, [pois, activeCategories, isMapReady]);

// ═══ Conteo por categoría dentro del viewport (leyenda) ═══
// Se recalcula al mover/zoom y al cambiar POIs o filtros.
useEffect(() => {
  if (!isMapReady || !mapInstanceRef.current) return;
  const map = mapInstanceRef.current;

  const updateCounts = () => {
    const b = map.getBounds();
    const counts: Record<string, number> = {};
    pois.forEach((p) => {
      if (!activeCategories[p.category]) return;
      if (p.lat >= b.getSouth() && p.lat <= b.getNorth() && p.lng >= b.getWest() && p.lng <= b.getEast()) {
        counts[p.category] = (counts[p.category] || 0) + 1;
      }
    });
    setViewportCounts(counts);
  };

  updateCounts();
  map.on('moveend', updateCounts);
  map.on('zoomend', updateCounts);
  return () => {
    map.off('moveend', updateCounts);
    map.off('zoomend', updateCounts);
  };
}, [pois, activeCategories, isMapReady]);

  const toggleCategory = (cat: string) => {
    setActiveCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const filteredPois = pois.filter(p => activeCategories[p.category]);

  // ═══ Distancia Haversine en metros ═══
  const distanceMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Radio caminable (1200 m ≈ 15 min a pie) — constante compartida con la
  // descripción del sector, para que botón y popup siempre coincidan.
  const walkableCounts = Object.keys(POI_CATEGORIES).reduce((acc, key) => {
    acc[key] = pois.filter(p => p.category === key && distanceMeters(lat, lng, p.lat, p.lng) <= WALKABLE_RADIUS_M).length;
    return acc;
  }, {} as Record<string, number>);

  // Descripción del sector por categoría: la misma que usa el popup del pin,
  // para mostrarla al pasar el mouse (o enfocar con teclado) cada botón.
  const sectorSummaries = React.useMemo(
    () => buildSectorSummaries(pois, Object.keys(POI_CATEGORIES), lat, lng),
    [pois, lat, lng]
  );
  // Botón con el resumen desplegado, con su posición en pantalla. Se usa
  // `fixed` porque el contenedor del mapa recorta (`overflow-hidden`) cualquier
  // tooltip anclado dentro de la tarjeta.
  const [hoveredChip, setHoveredChip] = useState<
    { key: string; x: number; anchorTop: number; anchorBottom: number } | null
  >(null);
  const [tipHeight, setTipHeight] = useState(0);
  const chipTipRef = useRef<HTMLDivElement>(null);

  const CHIP_TIP_WIDTH = 260;
  const CHIP_TIP_GAP = 12;

  const showChipSummary = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const half = CHIP_TIP_WIDTH / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setHoveredChip({ key, x, anchorTop: r.top, anchorBottom: r.bottom });
  };

  // Mide la tarjeta ya renderizada: sin la altura real no se puede decidir si
  // cabe arriba del botón
  React.useLayoutEffect(() => {
    if (!hoveredChip || !chipTipRef.current) return;
    setTipHeight(chipTipRef.current.offsetHeight);
  }, [hoveredChip]);

  // Posición final de la tarjeta: arriba del botón si cabe, si no debajo, y
  // siempre dentro del viewport (con la altura ya medida).
  const chipTipStyle = (() => {
    if (!hoveredChip) return null;
    const h = tipHeight || 150; // estimación hasta la primera medición
    const spaceAbove = hoveredChip.anchorTop - CHIP_TIP_GAP;
    const below = spaceAbove < h + 8;
    const rawTop = below
      ? hoveredChip.anchorBottom + CHIP_TIP_GAP
      : hoveredChip.anchorTop - CHIP_TIP_GAP - h;
    const maxTop = Math.max(window.innerHeight - h - 8, 8);
    return { top: Math.min(Math.max(rawTop, 8), maxTop), below };
  })();

  // La tarjeta se posiciona con `fixed` (dentro de la tarjeta del mapa la
  // recortaría el `overflow-hidden`), así que al hacer scroll la ocultamos en
  // vez de dejarla descolgada de su botón.
  useEffect(() => {
    if (!hoveredChip) return;
    const hide = () => setHoveredChip(null);
    window.addEventListener('scroll', hide, { passive: true });
    return () => window.removeEventListener('scroll', hide);
  }, [hoveredChip]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="text-xl font-bold text-slate-900">Ubicación y Sector</h2>
        <p className="text-xs text-slate-500">{address}, {city}</p>
      </div>

      {/* Mapa. Cuando hay una tarjeta de categoría abierta, el popup del pin
          se atenúa para que los dos textos no compitan al superponerse.
          El `!` es necesario: Leaflet define su propia opacidad para el popup
          (`.leaflet-fade-anim .leaflet-popup.leaflet-zoom-animated`) con más
          especificidad, y la transición la aporta esa misma regla. */}
      <div
        className={`relative h-72 sm:h-96 ${
          hoveredChip ? '[&_.leaflet-popup]:!opacity-25' : ''
        }`}
      >
        <div ref={mapRef} className="w-full h-full" />

        {loadingPois && (
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
            <span className="text-xs font-medium text-slate-600">Cargando atractivos...</span>
          </div>
        )}

        {!loadingPois && staleInfo && (
          <div className="absolute inset-x-4 top-2 z-[1000] flex justify-center">
            <div className="bg-white/95 backdrop-blur-sm px-4 py-2.5 rounded-xl shadow-md border border-blue-200 flex items-center gap-3">
              <History className="w-4 h-4 text-blue-500 shrink-0" />
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">Posiblemente desactualizados.</span>{' '}
                <span className="hidden sm:inline">
                  Mostrando atractivos guardados en tu dispositivo (hace {staleInfo.ageHours === 0 ? 'menos de 1' : staleInfo.ageHours} h).
                </span>
              </div>
              <button
                onClick={() => fetchPoisRef.current?.()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Actualizar
              </button>
              <button
                onClick={() => setStaleInfo(null)}
                className="absolute -top-2 -right-1 p-1 bg-white rounded-full shadow border border-slate-200 text-slate-400 hover:text-slate-600"
                aria-label="Cerrar aviso"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {!loadingPois && poisError && (
          <div className="absolute inset-x-4 top-2 z-[1000] flex justify-center">
            <div className="bg-white/95 backdrop-blur-sm px-4 py-2.5 rounded-xl shadow-md border border-amber-200 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">Atractivos no disponibles.</span>{' '}
                <span className="hidden sm:inline">El servicio de mapas está saturado; el resto de la ficha funciona igual.</span>
              </div>
              <button
                onClick={() => fetchPoisRef.current?.()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Reintentar
              </button>
            </div>
            <button
              onClick={() => setPoisError(false)}
              className="absolute -top-2 -right-1 p-1 bg-white rounded-full shadow border border-slate-200 text-slate-400 hover:text-slate-600"
              aria-label="Cerrar aviso"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Leyenda expandible — cantidades según lo visible en el mapa */}
      <div className="px-4 py-2.5 border-t border-slate-100">
        <button
          onClick={() => setLegendOpen((o) => !o)}
          className="w-full flex items-center justify-between group"
          aria-expanded={legendOpen}
        >
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 group-hover:text-slate-700 transition-colors">
            <MapIcon className="w-3.5 h-3.5" />
            Leyenda
            <span className="font-semibold normal-case text-slate-400">
              · {Object.values(viewportCounts).reduce((a, b) => a + b, 0)} en vista
            </span>
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${legendOpen ? 'rotate-180' : ''}`} />
        </button>

        {legendOpen && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
            {Object.entries(POI_CATEGORIES).map(([key, cat]) => {
              const count = viewportCounts[key] || 0;
              const isActive = activeCategories[key];
              const Icon = POI_ICONS[key];
              return (
                <div
                  key={key}
                  className={`flex items-center gap-2 ${isActive ? '' : 'opacity-40'}`}
                >
                  {/* Mini chip con el mismo formato del marcador */}
                  <div
                    className="w-6 h-6 shrink-0 rounded-md bg-white border-2 flex items-center justify-center"
                    style={{ borderColor: cat.color }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: cat.color }} />
                  </div>
                  <span className="text-xs text-slate-600 flex-1 truncate" title={cat.description}>
                    {cat.label}
                  </span>
                  <span
                    className={`text-xs font-bold tabular-nums ${count > 0 ? '' : 'text-slate-300'}`}
                    style={count > 0 ? { color: cat.color } : undefined}
                  >
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filtros de POIs — íconos con superíndice de cantidad a radio caminable (1200 m) */}
      <div className="p-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            A 15 minutos caminando
          </span>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {Object.entries(POI_CATEGORIES).map(([key, cat]) => {
            const walkable = walkableCounts[key] || 0;
            const isActive = activeCategories[key];
            const Icon = POI_ICONS[key];
            return (
              <button
                key={key}
                onClick={() => toggleCategory(key)}
                onMouseEnter={(e) => showChipSummary(key, e.currentTarget)}
                onMouseLeave={() => setHoveredChip(null)}
                onFocus={(e) => showChipSummary(key, e.currentTarget)}
                onBlur={() => setHoveredChip(null)}
                title={`${cat.description}: ${walkable} a ${WALKABLE_RADIUS_M} m o menos (clic para ${isActive ? 'ocultar' : 'mostrar'} en el mapa)`}
                className="relative flex flex-col items-center justify-center group"
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center border-2 transition-all ${
                    isActive
                      ? 'bg-slate-50 border-slate-200 group-hover:border-slate-400 group-hover:shadow-sm'
                      : 'bg-slate-100/60 border-slate-100 opacity-40'
                  }`}
                >
                  <Icon className="w-5 h-5" style={{ color: isActive ? cat.color : '#94a3b8' }} />
                </div>
                {/* Superíndice con cantidad caminable */}
                {walkable > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full border-2 border-white ${
                      isActive ? 'text-white shadow-sm' : 'bg-slate-400 text-white'
                    }`}
                    style={isActive ? { backgroundColor: cat.color } : undefined}
                  >
                    {walkable}
                  </span>
                )}
                <span className={`mt-1 text-[9px] font-semibold leading-tight text-center ${
                  isActive ? 'text-slate-600' : 'text-slate-400'
                }`}>
                  {cat.label.split('/')[0]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Resumen del sector de la categoría bajo el cursor: mismo texto que
            usa el popup del pin, con los conteos y el lugar más cercano.
            Se posiciona dentro del viewport: si no cabe arriba del botón, se
            voltea hacia abajo (antes se salía de pantalla y no se leía), y el
            z-index supera los panes de Leaflet (200-1000), que si no lo tapan. */}
        {hoveredChip && chipTipStyle && (
          <div
            ref={chipTipRef}
            className="fixed z-[1100] -translate-x-1/2 pointer-events-none flex flex-col items-center"
            style={{ left: hoveredChip.x, top: chipTipStyle.top, width: CHIP_TIP_WIDTH }}
            role="tooltip"
          >
            {chipTipStyle.below && (
              <div className="w-2.5 h-2.5 bg-white border-l border-t border-slate-200 rotate-45 -mb-[6px]" />
            )}
            <div className="w-full bg-white rounded-xl border border-slate-200 shadow-lg p-3 text-left">
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: POI_CATEGORIES[hoveredChip.key]?.color }}
                />
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  {POI_CATEGORIES[hoveredChip.key]?.label}
                </span>
                <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-400">
                  {walkableCounts[hoveredChip.key] || 0} en 15 min
                </span>
              </div>
              <p className="text-[10.5px] leading-relaxed text-slate-600">
                {sectorSummaries[hoveredChip.key] ||
                  `Sin lugares de esta categoría a menos de 15 min caminando de ${address}.`}
              </p>
            </div>
            {!chipTipStyle.below && (
              <div className="w-2.5 h-2.5 bg-white border-r border-b border-slate-200 rotate-45 -mt-[6px]" />
            )}
          </div>
        )}

      </div>
    </div>
  );
}
