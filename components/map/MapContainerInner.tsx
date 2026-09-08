'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, setWorkerUrl, NavigationControl, Marker, Popup, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Property } from '@/lib/types/property';
import { LocateFixed } from 'lucide-react';

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

function createUserLocationSvg(): string {
  return `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(239,68,68,0.18);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
    <div style="position:absolute;inset:6px;border-radius:50%;background:rgba(239,68,68,0.28);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite 0.4s;"></div>
    <div style="position:absolute;inset:12px;border-radius:50%;background:#dc2626;border:4px solid white;box-shadow:0 0 0 4px rgba(220,38,38,0.6),0 4px 16px rgba(220,38,38,0.7);"></div>
    <div style="position:absolute;inset:20px;border-radius:50%;background:white;"></div>
  </div>`;
}


// ─── Interface ────────────────────────────────────────────────────────

interface MapContainerInnerProps {
  properties: Property[];
  selectedPropertyId?: string | null;
  targetLocation?: { lat: number; lng: number; zoom: number } | null;
  center?: [number, number];
  zoom?: number;
  onUserLocation?: (loc: { lat: number; lng: number }) => void;
  nearbyActive?: boolean;
  onPropertySelect?: (id: string | null) => void;
  externalUserLocation?: { lat: number; lng: number } | null;
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
}: MapContainerInnerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const userMarkerRef = useRef<Marker | null>(null);
  const effectiveUserLocation = externalUserLocation;

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

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      userMarkerRef.current = null;
    };
  }, []);

  // ─── Centrar mapa en ubicación del usuario + crear marker ──────────
  useEffect(() => {
    if (!map.current || !effectiveUserLocation) return;
    if (targetLocation) return;

    map.current.flyTo({
      center: [effectiveUserLocation.lng, effectiveUserLocation.lat],
      zoom: 13,
      duration: 2000,
    });

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
                <div style="position:absolute;inset:-3px;border-radius:50%;background:rgba(220,38,38,0.2);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
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
  }, [effectiveUserLocation, targetLocation]);

  // ─── Expanding rings: DOM-based, scale with zoom ────────────────────
  const pingOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map.current || !effectiveUserLocation) return;
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

    return () => {
      overlay.style.display = 'none';
      mapInstance.off('move', updatePosition);
      mapInstance.off('zoom', updatePosition);
    };
  }, [effectiveUserLocation]);

  // ─── Property markers (viewport-culled) ─────────────────────────────
  const updateMarkers = useCallback(() => {
    if (!map.current) return;
    const mapInstance = map.current;
    const bounds = mapInstance.getBounds();
    const zoomLevel = mapInstance.getZoom();
    const showLabels = zoomLevel >= 10;

    const visibleIds = new Set<string>();
    const maxVisible = properties.length > 500 ? 300 : properties.length;
    let count = 0;

    for (const p of properties) {
      if (count >= maxVisible) break;
      if (bounds.contains([p.lng, p.lat])) {
        visibleIds.add(p.id);
        count++;
      }
    }

    for (const [id, marker] of Array.from(markersRef.current.entries())) {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const p of properties) {
      if (!visibleIds.has(p.id)) continue;

      const isSelected = p.id === selectedPropertyId;
      const isNew = p.year_built != null && p.year_built > new Date().getFullYear();
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
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPropertySelect?.(p.id);
      });

      const marker = new Marker({ element: el, offset: [0, -size * 0.65] })
        .setLngLat([p.lng, p.lat])
        .addTo(mapInstance);

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
                  <div style="font-weight:700;font-size:13px;color:#0f172a;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.title}</div>
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

  useEffect(() => {
    if (!map.current) return;
    const timer = setTimeout(updateMarkers, 150);
    return () => clearTimeout(timer);
  }, [updateMarkers]);

  useEffect(() => {
    if (!map.current) return;
    const onMoveEnd = () => setTimeout(updateMarkers, 100);
    map.current.on('moveend', onMoveEnd);
    map.current.on('zoomend', onMoveEnd);
    return () => {
      if (map.current) {
        map.current.off('moveend', onMoveEnd);
        map.current.off('zoomend', onMoveEnd);
      }
    };
  }, [updateMarkers]);

  // ─── FlyTo a ubicación seleccionada ────────────────────────────────
  useEffect(() => {
    if (!map.current || !targetLocation) return;
    const { lat, lng, zoom: z } = targetLocation;
    if (typeof lat !== 'number' || typeof lng !== 'number' || typeof z !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng) || !isFinite(z)) return;
    map.current.flyTo({ center: [lng, lat], zoom: z, duration: 1500 });
  }, [targetLocation]);

  // ─── Auto-fit bounds (sin ubicación del usuario) ───────────────────
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

      {/* ═══ Ondas expandientes CSS desde la ubicación del usuario ═══ */}
      <div ref={pingOverlayRef} className="absolute inset-0 z-[500] pointer-events-none overflow-hidden" style={{ display: 'none' }}>
        <div className="ping-ring ping-ring-0" />
        <div className="ping-ring ping-ring-1" />
        <div className="ping-ring ping-ring-2" />
        <div className="ping-ring ping-ring-3" />
        <div className="ping-glow" />
      </div>

      {/* Botón volver a mi ubicación */}
      {effectiveUserLocation && (
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
