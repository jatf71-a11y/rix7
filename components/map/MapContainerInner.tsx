'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Map as MapLibreMap, setWorkerUrl, NavigationControl, Marker, Popup, LngLatBounds, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PropertyMarker } from '@/lib/utils/markers';
import { Loader2, LocateFixed } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────

function formatMapPrice(price: number): string {
  if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(1)}B`;
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(0)}M`;
  if (price >= 1_000) return `$${(price / 1_000).toFixed(0)}K`;
  return `$${price}`;
}

if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre-gl-worker.mjs');
}

function getColor(isSelected: boolean, isNew: boolean): string {
  if (isSelected) return '#DC2626';
  if (isNew) return '#059669';
  return '#2563EB';
}

function createPinSvg(color: string, size: number, isSelected: boolean): string {
  return `<svg width="${size}" height="${size * 1.3}" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${color}"/>
    <circle cx="12" cy="11" r="4.5" fill="white" opacity="0.9"/>
    ${isSelected ? `<circle cx="12" cy="11" r="7" stroke="white" stroke-width="2" fill="none" opacity="0.5"/>` : ''}
  </svg>`;
}

// Color del marcador POI según categoría
const POI_CATEGORY_COLORS: Record<string, string> = {
  metro: '#2563EB',
  transport: '#2563EB',
  mall: '#D97706',
  education: '#059669',
  health: '#E11D48',
  civic: '#4F46E5',
  park: '#047857',
  commerce: '#EA580C',
  safety: '#0284C7',
  leisure: '#C026D3',
  finance: '#0891B2',
  sport: '#65A30D',
  address: '#475569',
};

function createUserLocationSvg(): string {
  return `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(239,68,68,0.18);animation:ping 3s cubic-bezier(0,0,0.2,1) infinite;"></div>
    <div style="position:absolute;inset:6px;border-radius:50%;background:rgba(239,68,68,0.28);animation:ping 3s cubic-bezier(0,0,0.2,1) infinite 0.8s;"></div>
    <div style="position:absolute;inset:12px;border-radius:50%;background:#dc2626;border:4px solid white;box-shadow:0 0 0 4px rgba(220,38,38,0.6),0 4px 16px rgba(220,38,38,0.7);"></div>
    <div style="position:absolute;inset:20px;border-radius:50%;background:white;"></div>
  </div>`;
}


// ─── Interface ────────────────────────────────────────────────────────

interface MapContainerInnerProps {
  /** Proyección compacta (lib/utils/markers.ts): solo los campos que pines y popups usan. */
  properties: PropertyMarker[];
  selectedPropertyId?: string | null;
  targetLocation?: { lat: number; lng: number; zoom: number } | null;
  center?: [number, number];
  zoom?: number;
  nearbyActive?: boolean;
  onPropertySelect?: (id: string | null) => void;
  externalUserLocation?: { lat: number; lng: number } | null;
  detectedCity?: { name: string; regionName?: string; lat: number; lng: number; isGps?: boolean } | null;
  activePoi?: { id: string; name: string; subtitle?: string; category?: string; categoryLabel?: string; lat: number; lng: number; zoom?: number; radiusKm: number } | null;
}

// ─── Component ────────────────────────────────────────────────────────

export default function MapContainerInner({
  properties,
  selectedPropertyId,
  targetLocation,
  center = [-70.5870, -33.4190],
  zoom = 6,
  nearbyActive = false,
  onPropertySelect,
  externalUserLocation,
  detectedCity,
  activePoi,
}: MapContainerInnerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const openPopupMarkerRef = useRef<Marker | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const effectiveUserLocation = externalUserLocation;
  // Indica que el mapa ya fue creado. Permite reintentar el dibujo del pin / beacon
  // si la ubicación (GPS) llegó antes de que el mapa terminara de inicializarse.
  const [mapReady, setMapReady] = useState(false);

  // ─── Inicializar mapa ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new MapLibreMap({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
      },
      center: [center[0], center[1]],
      zoom,
      attributionControl: false,
    });

    map.current.addControl(new NavigationControl(), 'top-right');
    setMapReady(true);

    // El mapa no detecta cambios de tamaño de su contenedor por sí solo.
    const resizeObserver = new ResizeObserver(() => {
      map.current?.resize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      setMapReady(false);
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      userMarkerRef.current = null;
    };
  }, []);

  // ─── Centrar en la Ciudad Detectada (IP / GPS) ───
  // No se dibuja ningún pin de ciudad: el badge flotante "Tu Ciudad GIS" ya
  // muestra la ciudad detectada y permite recentrar el mapa al pulsarlo.
  useEffect(() => {
    if (!map.current || !mapReady || !detectedCity) return;
    if (nearbyActive) return;
    if (targetLocation) return;

    map.current.flyTo({
      center: [detectedCity.lng, detectedCity.lat],
      zoom: 13,
      duration: 2000,
    });
  }, [detectedCity, nearbyActive, targetLocation, mapReady]);

  // ─── Centrar mapa en ubicación del usuario + crear marker ──────────
  // El pin se muestra en la primera visita (GPS) y también en modo "Mi Ubicación".
  // Si hay targetLocation (botón "Mi Ubicación"), el centrado lo hace el efecto de abajo.
  // mapReady en las deps: si el GPS respondió antes de que el mapa existiera,
  // al crearse el mapa este efecto se re-ejecuta y dibuja el pin (no se descarta).
  useEffect(() => {
    if (!map.current || !mapReady || !effectiveUserLocation) return;
    if (!targetLocation) {
      map.current.flyTo({
        center: [effectiveUserLocation.lng, effectiveUserLocation.lat],
        zoom: 13,
        duration: 2000,
      });
    }

    // Recrear marker si el mapa cambió (HMR remount)
    if (userMarkerRef.current) {
      try {
        const mapEl = mapContainer.current;
        const markerEl = userMarkerRef.current.getElement();
        if (!mapEl || !markerEl || !mapEl.contains(markerEl)) {
          userMarkerRef.current = null;
        }
      } catch {
        userMarkerRef.current = null;
      }
    }

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.innerHTML = createUserLocationSvg();
      el.style.width = '44px';
      el.style.height = '44px';
      el.style.cursor = 'pointer';
      el.title = 'Mi Ubicación';

      userMarkerRef.current = new Marker({ element: el })
        .setLngLat([effectiveUserLocation.lng, effectiveUserLocation.lat])
        .addTo(map.current);

      const popup = new Popup({ offset: 24, closeButton: false, maxWidth: '230px' })
        .setHTML(`<div style="font-family:system-ui;background:white;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(220,38,38,0.15);border:1px solid #fecaca;">
          <div style="height:3px;background:linear-gradient(90deg,#dc2626,#ef4444,#dc2626);"></div>
          <div style="padding:12px 14px 10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="position:relative;width:10px;height:10px;flex-shrink:0;">
                <div style="position:absolute;inset:-3px;border-radius:50%;background:rgba(220,38,38,0.2);animation:ping 3s cubic-bezier(0,0,0.2,1) infinite;"></div>
                <div style="position:absolute;inset:0;border-radius:50%;background:#dc2626;"></div>
              </div>
              <div style="font-weight:700;font-size:13px;color:#0f172a;">Mi Ubicación</div>
            </div>
          </div>
        </div>`);

      const marker = userMarkerRef.current;
      marker.setPopup(popup);

      const markerEl = marker.getElement();
      markerEl.addEventListener('mouseenter', () => { try { (marker as any).openPopup(); } catch {} });
      markerEl.addEventListener('mouseleave', () => { try { (marker as any).closePopup(); } catch {} });
      markerEl.style.cursor = 'pointer';
    }
  }, [effectiveUserLocation, targetLocation, mapReady]);

  // ─── Expanding rings: DOM-based, scale with zoom ────────────────────
  const pingOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map.current || !effectiveUserLocation) return;
    if (!nearbyActive) return; // Solo mostrar ondas cuando el usuario activa "Mi Ubicación"
    const mapInstance = map.current;
    const overlay = pingOverlayRef.current;
    if (!overlay) return;

    overlay.style.display = 'block';

    const updatePosition = () => {
      const center = [effectiveUserLocation.lng, effectiveUserLocation.lat] as [number, number];
      const pt = mapInstance.project(center);
      overlay.style.setProperty('--ring-x', `${pt.x}px`);
      overlay.style.setProperty('--ring-y', `${pt.y}px`);

      // Calculate 5km in pixels based on current zoom
      const lngOffset = 5.0 / (111.32 * Math.cos(center[1] * Math.PI / 180));
      const ptEdge = mapInstance.project([center[0] + lngOffset, center[1]]);
      const radiusPx = Math.abs(ptEdge.x - pt.x);
      overlay.style.setProperty('--ring-max-size', `${radiusPx * 2}px`);
    };
    updatePosition();
    mapInstance.on('move', updatePosition);
    mapInstance.on('zoom', updatePosition);
    mapInstance.on('resize', updatePosition);

    return () => {
      overlay.style.display = 'none';
      mapInstance.off('move', updatePosition);
      mapInstance.off('zoom', updatePosition);
      mapInstance.off('resize', updatePosition);
    };
  }, [effectiveUserLocation, nearbyActive]);

  // ─── Punto de Interés (POI): centrar, marcador y círculo de radio ───
  const poiMarkerRef = useRef<Marker | null>(null);
  const lastPoiCenterRef = useRef<string>('');

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapReady) return;

    // Limpiar estado anterior (marcador y capas de radio)
    if (poiMarkerRef.current) {
      try { poiMarkerRef.current.remove(); } catch {}
      poiMarkerRef.current = null;
    }
    try { mapInstance.removeLayer('poi-radius-fill'); } catch {}
    try { mapInstance.removeLayer('poi-radius-line'); } catch {}
    try { mapInstance.removeSource('poi-radius'); } catch {}

    if (!activePoi) return;

    // Centrar solo cuando cambia el punto (no al ajustar el radio)
    const poiKey = `${activePoi.lat.toFixed(5)},${activePoi.lng.toFixed(5)}`;
    if (lastPoiCenterRef.current !== poiKey) {
      mapInstance.flyTo({ center: [activePoi.lng, activePoi.lat], zoom: activePoi.zoom || 14.5, duration: 1500 });
      lastPoiCenterRef.current = poiKey;
    }

    // Círculo de radio como polígono geográfico (escala con el zoom)
    const radiusKm = activePoi.radiusKm || 2;
    const latKm = radiusKm / 111.32;
    const lngKm = radiusKm / (111.32 * Math.cos((activePoi.lat * Math.PI) / 180));
    const ring: [number, number][] = [];
    for (let i = 0; i <= 72; i++) {
      const angle = (i * 2 * Math.PI) / 72;
      ring.push([activePoi.lng + lngKm * Math.cos(angle), activePoi.lat + latKm * Math.sin(angle)]);
    }
    const radiusGeoJson = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    } as GeoJSON.Feature<GeoJSON.Polygon>;

    try {
      const existing = mapInstance.getSource('poi-radius') as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(radiusGeoJson);
      } else {
        mapInstance.addSource('poi-radius', { type: 'geojson', data: radiusGeoJson });
        mapInstance.addLayer({
          id: 'poi-radius-fill',
          type: 'fill',
          source: 'poi-radius',
          paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.12 },
        });
        mapInstance.addLayer({
          id: 'poi-radius-line',
          type: 'line',
          source: 'poi-radius',
          paint: { 'line-color': '#2563EB', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] },
        });
      }
    } catch {}

    // Marcador del punto seleccionado
    const color = POI_CATEGORY_COLORS[activePoi.category || 'address'] || '#475569';
    const el = document.createElement('div');
    el.innerHTML = createPinSvg(color, 34, true);
    el.style.width = '34px';
    el.style.height = '44px';
    el.style.cursor = 'pointer';
    el.title = activePoi.name;

    poiMarkerRef.current = new Marker({ element: el })
      .setLngLat([activePoi.lng, activePoi.lat])
      .addTo(mapInstance);

    const marker = poiMarkerRef.current;
    const popup = new Popup({ offset: 26, closeButton: false, maxWidth: '240px' }).setHTML(
      `<div style="font-family:system-ui;background:white;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(37,99,235,0.15);border:1px solid #bfdbfe;">
        <div style="height:3px;background:linear-gradient(90deg,#2563EB,#3b82f6,#2563EB);"></div>
        <div style="padding:10px 14px;">
          <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;">${activePoi.categoryLabel || 'Punto de interés'} · Radio ${radiusKm} km</div>
          <div style="font-weight:800;font-size:13px;color:#0f172a;margin-top:2px;">${activePoi.name}</div>
        </div>
      </div>`
    );
    marker.setPopup(popup);
    marker.getElement().addEventListener('mouseenter', () => { try { (marker as any).openPopup(); } catch {} });
    marker.getElement().addEventListener('mouseleave', () => { try { (marker as any).closePopup(); } catch {} });
  }, [activePoi, mapReady]);

  // ─── Property markers (viewport-culled) ─────────────────────────────
  const updateMarkers = useCallback(() => {
    if (!map.current) return;
    const mapInstance = map.current;
    const bounds = mapInstance.getBounds();
    const zoomLevel = mapInstance.getZoom();
    const showLabels = zoomLevel >= 10;

    const currentYear = new Date().getFullYear();
    const visibleIds = new Set<string>();
    const visibleProperties: PropertyMarker[] = [];
    const maxVisible = properties.length > 500 ? 300 : properties.length;

    // Una sola pasada: recoge los pines dentro del viewport (con tope).
    for (const p of properties) {
      if (visibleProperties.length >= maxVisible) break;
      if (bounds.contains([p.lng, p.lat])) {
        visibleIds.add(p.id);
        visibleProperties.push(p);
      }
    }

    for (const [id, marker] of Array.from(markersRef.current.entries())) {
      if (!visibleIds.has(id)) {
        if (openPopupMarkerRef.current === marker) openPopupMarkerRef.current = null;
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const p of visibleProperties) {
      const isSelected = p.id === selectedPropertyId;
      const isNew = p.year_built != null && p.year_built > currentYear;
      const color = getColor(isSelected, isNew);
      const size = isSelected ? 32 : 22;

      const existing = markersRef.current.get(p.id);
      if (existing) {
        const existingEl = existing.getElement();
        const wasSelected = existingEl.dataset.selected === 'true';
        if (wasSelected !== isSelected) {
          existingEl.innerHTML = createPinSvg(color, size, isSelected);
          existingEl.dataset.selected = String(isSelected);
          existingEl.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))';
          existing.setOffset([0, -size * 0.65]);
        }
        continue;
      }

      const el = document.createElement('div');
      el.innerHTML = createPinSvg(color, size, isSelected);
      el.dataset.selected = String(isSelected);
      el.dataset.propertyId = p.id;
      el.style.cursor = 'pointer';
      el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))';

      const marker = new Marker({ element: el, offset: [0, -size * 0.65] })
        .setLngLat([p.lng, p.lat])
        .addTo(mapInstance);

      // Click en el pin: resalta la propiedad y despliega el popup resumen
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPropertySelect?.(p.id);
        if (openPopupMarkerRef.current && openPopupMarkerRef.current !== marker) {
          try { openPopupMarkerRef.current.getPopup()?.remove(); } catch {}
        }
        marker.togglePopup();
        openPopupMarkerRef.current = marker.getPopup()?.isOpen() ? marker : null;
      });

      const isRent = p.status === 'for_rent';
      const statusColor = isRent ? '#2563EB' : '#059669';
      const statusLabel = isRent ? 'Arriendo' : 'Venta';
      const detailPopup = new Popup({ offset: size * 1.3, closeButton: false, maxWidth: '240px' }).setHTML(
        `<div style="font-family:system-ui;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);border:1px solid #e2e8f0;min-width:200px;">
          <div style="position:relative;">
            <div style="height:4px;background:linear-gradient(90deg,${statusColor},${color});"></div>
            <div style="padding:12px 14px 10px;">
              <div style="display:flex;align-items:start;justify-content:space-between;gap:6px;">
                <div style="flex:1;min-width:0;">
                  <a href="/properties/${p.id}" title="Ver ficha de la propiedad" style="display:block;font-weight:700;font-size:13px;color:#0f172a;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;">${p.title}</a>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px;">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <span style="color:#64748b;font-size:10px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.address}, ${p.city}</span>
                  </div>
                </div>
                <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${statusColor}15;color:${statusColor};font-size:9px;font-weight:700;letter-spacing:0.3px;white-space:nowrap;">${statusLabel}</span>
              </div>
              <div style="margin-top:10px;">
                <span style="font-weight:800;font-size:17px;color:#0f172a;letter-spacing:-0.3px;">$${p.price.toLocaleString('es-CL')}</span>
                ${isRent ? '<span style="font-size:11px;color:#64748b;font-weight:500;">/mes</span>' : ''}
              </div>
              <div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
                ${p.bedrooms > 0 ? `<div style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:6px;background:#f8fafc;font-size:10px;color:#475569;font-weight:600;">🛏 <span>${p.bedrooms}</span></div>` : ''}
                ${p.bathrooms > 0 ? `<div style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:6px;background:#f8fafc;font-size:10px;color:#475569;font-weight:600;">🚿 <span>${p.bathrooms}</span></div>` : ''}
                <div style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:6px;background:#f8fafc;font-size:10px;color:#475569;font-weight:600;">📐 <span>${p.area_sqm}m²</span></div>
              </div>
              <a href="/properties/${p.id}" style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:10px;padding:7px 0;background:#0f172a;color:white;font-size:11px;font-weight:600;border-radius:8px;text-decoration:none;">Ver propiedad <span style="font-size:13px;">→</span></a>
            </div>
          </div>
        </div>`
      );

      marker.setPopup(detailPopup);

      if (showLabels || isSelected) {
        const priceStr = isRent ? `${formatMapPrice(p.price)}/mes` : formatMapPrice(p.price);
        el.title = priceStr;
      }

      markersRef.current.set(p.id, marker);
    }
  }, [properties, selectedPropertyId]);

  // Un único timer para todos los re-encuadres: antes cada `moveend`/`zoomend`
  // creaba un timeout nuevo sin cancelar el anterior, así que arrastrar el mapa
  // acumulaba redibujados de marcadores en cola.
  const markerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleMarkers = useCallback((delay: number) => {
    if (markerTimerRef.current) clearTimeout(markerTimerRef.current);
    markerTimerRef.current = setTimeout(updateMarkers, delay);
  }, [updateMarkers]);

  useEffect(() => {
    if (!map.current) return;
    scheduleMarkers(150);
    return () => {
      if (markerTimerRef.current) clearTimeout(markerTimerRef.current);
    };
  }, [scheduleMarkers]);

  useEffect(() => {
    if (!map.current) return;
    const onMoveEnd = () => scheduleMarkers(100);
    map.current.on('moveend', onMoveEnd);
    map.current.on('zoomend', onMoveEnd);
    return () => {
      if (map.current) {
        map.current.off('moveend', onMoveEnd);
        map.current.off('zoomend', onMoveEnd);
      }
    };
  }, [scheduleMarkers]);

  // ─── FlyTo a ubicación seleccionada ────────────────────────────────
  useEffect(() => {
    if (!map.current || !targetLocation) return;
    const { lat, lng, zoom: z } = targetLocation;
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof z !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(z)) return;
    map.current.flyTo({ center: [lng, lat], zoom: z, duration: 1500 });
  }, [targetLocation]);

  // ─── Centrar en la Plaza de Armas de la ciudad (cuando geolocation la resuelve) ───
  const prevCenterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map.current || !center) return;
    const key = `${center[0]},${center[1]}`;
    if (prevCenterKeyRef.current === null) {
      // Primer render: el mapa ya se construyó con este centro
      prevCenterKeyRef.current = key;
      return;
    }
    if (prevCenterKeyRef.current === key) return;
    prevCenterKeyRef.current = key;
    if (targetLocation) return;
    if (effectiveUserLocation) return;
    map.current.flyTo({ center: [center[0], center[1]], zoom: 13, duration: 2000 });
  }, [center, targetLocation, effectiveUserLocation]);

  // ─── Auto-fit bounds (solo en cambios de filtro posteriores) ─────────
  const prevCountRef = useRef(properties.length);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!map.current) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevCountRef.current = properties.length;
      return;
    }
    if (properties.length === prevCountRef.current) return;
    if (targetLocation) return;
    if (effectiveUserLocation) return;
    // Primera carga de datos: NO auto-ajustar a todo Chile. El mapa debe
    // quedarse centrado en la Plaza de Armas de la ciudad del usuario.
    if (prevCountRef.current === 0) {
      prevCountRef.current = properties.length;
      return;
    }
    prevCountRef.current = properties.length;
    if (properties.length === 0) return;

    const bounds = new LngLatBounds();
    for (const p of properties) {
      bounds.extend([p.lng, p.lat]);
    }
    map.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 1500 });
  }, [properties.length, targetLocation, effectiveUserLocation]);

  // ─── Destacar propiedad seleccionada ────────────────────────────────
  useEffect(() => {
    if (!map.current || !selectedPropertyId) return;
    const p = properties.find(x => x.id === selectedPropertyId);
    if (p) {
      map.current.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.current.getZoom(), 13), duration: 1000 });
    }
  }, [selectedPropertyId, properties]);

  // ─── FlyTo mi ubicación ────────────────────────────────────────────
  const flyToMyLocation = () => {
    if (!map.current || !effectiveUserLocation) return;
    map.current.flyTo({ center: [effectiveUserLocation.lng, effectiveUserLocation.lat], zoom: 14, duration: 1500 });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full z-0" />

      <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>

      {/* ═══ Indicador: detectando ubicación (GPS o IP) ═══ */}
      {!detectedCity && !nearbyActive && (
        <div className="absolute top-3 left-3 z-[400] flex items-center gap-2.5 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg shadow-slate-900/10 border border-slate-200/90 pointer-events-none">
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-none">
              Detectando
            </span>
            <span className="text-xs font-semibold text-slate-600 leading-tight">
              Tu ubicación...
            </span>
          </div>
        </div>
      )}

      {/* ═══ Badge de Ciudad Detectada en Mapa GIS ═══ */}
      {detectedCity && !nearbyActive && (
        <button
          type="button"
          onClick={() => {
            map.current?.flyTo({ center: [detectedCity.lng, detectedCity.lat], zoom: 13, duration: 1500 });
          }}
          className="absolute top-3 left-3 z-[400] flex items-center gap-2.5 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg shadow-slate-900/10 border border-slate-200/90 hover:bg-slate-50 transition-all text-left group cursor-pointer"
          title="Centrar mapa en tu ciudad detectada"
        >
          <div className="relative flex items-center justify-center w-3 h-3">
            <span className="w-3 h-3 rounded-full bg-blue-500 animate-ping absolute opacity-75" />
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 relative" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 leading-none">
              {detectedCity.isGps ? 'GPS Detectado' : 'Tu Ciudad GIS'}
            </span>
            <span className="text-xs font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">
              {detectedCity.name}
            </span>
          </div>
        </button>
      )}

      {/* ═══ Ondas expandientes CSS desde la ubicación del usuario ═══ */}
      <div ref={pingOverlayRef} className="absolute inset-0 z-[500] pointer-events-none overflow-hidden" style={{ display: 'none' }}>
        <div className="ping-ring ping-ring-0" />
        <div className="ping-ring ping-ring-1" />
        <div className="ping-ring ping-ring-2" />
        <div className="ping-ring ping-ring-3" />
        <div className="ping-glow" />
      </div>

      {/* ═══ Panel compacto de propiedades cercanas ═══ */}
      {nearbyActive && effectiveUserLocation && properties.length > 0 && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg shadow-black/10 border border-slate-200/80 pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-semibold text-slate-800">
            {properties.length} propiedades
          </span>
          <span className="text-xs text-slate-500">en 5 km</span>
        </div>
      )}

      {/* Botón volver a mi ubicación */}
      {nearbyActive && effectiveUserLocation && (
        <button
          onClick={flyToMyLocation}
          className="absolute bottom-14 right-4 z-[1000] p-3 bg-red-600 text-white rounded-full shadow-xl shadow-red-600/30 hover:bg-red-700 hover:scale-105 active:scale-95 transition-all"
          title="Volver a mi ubicación"
        >
          <LocateFixed className="w-5 h-5" />
        </button>
      )}

      <div className="absolute bottom-2 left-2 z-10 bg-white/80 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] text-slate-500 pointer-events-none">
        <span>© <a href="https://www.openstreetmap.org/copyright" className="hover:underline">OpenStreetMap</a></span>
      </div>

    </div>
  );
}
