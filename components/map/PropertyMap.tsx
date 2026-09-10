'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Property } from '@/lib/types/property';
import { Loader2 } from 'lucide-react';

interface PropertyMapProps {
  properties: Property[];
  selectedPropertyId?: string | null;
  targetLocation?: { lat: number; lng: number; zoom: number } | null;
  onUserLocation?: (loc: { lat: number; lng: number }) => void;
  nearbyActive?: boolean;
  onPropertySelect?: (id: string | null) => void;
  totalResults?: number;
  isRent?: boolean;
  regionName?: string;
  communeName?: string;
  externalUserLocation?: { lat: number; lng: number } | null;
  mapCenter?: { lat: number; lng: number } | null;
  detectedCity?: { name: string; regionName?: string; lat: number; lng: number; isGps?: boolean } | null;
}

const DynamicMapContainer = dynamic(
  () => import('./MapContainerInner'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-400 gap-2">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs font-semibold">Cargando mapa geoespacial de Chile...</span>
      </div>
    ),
  }
);

export function PropertyMap(props: PropertyMapProps) {
  const { totalResults: _totalResults, isRent: _isRent, regionName: _regionName, communeName: _communeName, mapCenter, detectedCity, ...mapProps } = props;

  return (
    <div className="w-full h-full relative overflow-hidden rounded-2xl">
      <DynamicMapContainer
        {...mapProps}
        detectedCity={detectedCity}
        center={mapCenter ? [mapCenter.lng, mapCenter.lat] : undefined}
        zoom={mapCenter ? 13 : undefined}
      />
    </div>
  );
}
