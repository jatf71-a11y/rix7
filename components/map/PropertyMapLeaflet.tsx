'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Loader2, GraduationCap, Stethoscope, BusFront, ShoppingCart, Dumbbell, Trees, ShieldCheck, UtensilsCrossed, Landmark } from 'lucide-react';
import { POI_CATEGORIES } from '@/lib/data/poiCategories';
import { getCacheKey, getCachedPOIs, setCachedPOIs } from '@/lib/utils/overpassCache';

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

export default function PropertyMapLeaflet({ lat, lng, title, address, city }: PropertyMapLeafletProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [isMapReady, setIsMapReady] = useState(false);
  const [pois, setPois] = useState<POI[]>([]);
  const [loadingPois, setLoadingPois] = useState(false);
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

      // Fix para íconos
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
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

      L.marker([lat, lng], { icon: propertyIcon })
        .addTo(map)
        .bindPopup(`<div style="text-align:center;padding:4px;"><strong style="font-size:13px;">${title}</strong><br/><span style="font-size:11px;color:#666;">${address}</span></div>`);

      if (!cancelled) {
        mapInstanceRef.current = map;
        setIsMapReady(true);
      }
    };

    initMap();

    return () => {
      cancelled = true;
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
        if (parsed.length > 0) {
          setCachedPOIs(cacheKey, parsed);
        }
      } catch (err) {
        console.error('Error fetching POIs:', err);
      } finally {
        setLoadingPois(false);
      }
    };

    fetchPOIs();
  }, [isMapReady, lat, lng]);

  // ═══ Actualizar marcadores en el mapa ═══
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    // Limpiar marcadores anteriores (excepto el de la propiedad)
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    // Agregar marcadores de POIs filtrados — mismo formato que los chips de
    // la ficha: caja blanca redondeada con borde gris e ícono de la categoría
    pois.filter(p => activeCategories[p.category]).forEach(poi => {
      const icon = L.divIcon({
        html:
          `<div style="width:26px;height:26px;background:#ffffff;border:2px solid #e2e8f0;border-radius:9px;` +
          `box-shadow:0 2px 6px rgba(15,23,42,0.15);display:flex;align-items:center;justify-content:center;">` +
          poi.svg +
          `</div>`,
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker([poi.lat, poi.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<div style="text-align:center;padding:4px;min-width:140px;">` +
          `<div style="width:40px;height:40px;margin:0 auto 6px;background:#ffffff;border:2px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;">` +
          poi.svg.replace('width="13" height="13"', 'width="18" height="18"') +
          `</div>` +
          `<strong style="font-size:12px;">${poi.name}</strong><br/>` +
          `<span style="font-size:10px;color:#666;">${poi.typeLabel || poi.type}</span>` +
          `</div>`
        );

      markersRef.current.push(marker);
    });
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

  // Radio caminable estándar: 1200 m (~15 min a pie)
  const WALKABLE_RADIUS_M = 1200;
  const walkableCounts = Object.keys(POI_CATEGORIES).reduce((acc, key) => {
    acc[key] = pois.filter(p => p.category === key && distanceMeters(lat, lng, p.lat, p.lng) <= WALKABLE_RADIUS_M).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="text-xl font-bold text-slate-900">Ubicación y Sector</h2>
        <p className="text-xs text-slate-500">{address}, {city}</p>
      </div>

      {/* Mapa */}
      <div className="relative h-72 sm:h-96">
        <div ref={mapRef} className="w-full h-full" />

        {loadingPois && (
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
            <span className="text-xs font-medium text-slate-600">Cargando atractivos...</span>
          </div>
        )}
      </div>

      {/* Filtros de POIs — íconos con superíndice de cantidad a radio caminable (1200 m) */}
      <div className="p-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Atractivos a 15 min caminando
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

      </div>
    </div>
  );
}
