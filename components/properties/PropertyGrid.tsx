'use client';

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Property } from '@/lib/types/property';
import { PropertyCard } from './PropertyCard';
import { SearchX } from 'lucide-react';

interface PropertyGridProps {
  properties: Property[];
  loading?: boolean;
  hoveredPropertyId?: string | null;
  onHoverProperty?: (id: string | null) => void;
  onResetFilters?: () => void;
}

// Agrupar propiedades en filas de 2 para grid virtual
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function PropertyGrid({
  properties,
  loading,
  hoveredPropertyId,
  onHoverProperty,
  onResetFilters,
}: PropertyGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = chunkArray(properties, 2);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 460,
    overscan: 3,
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
            <div className="aspect-[16/10] bg-slate-200" />
            <div className="p-4 space-y-3">
              <div className="h-6 bg-slate-200 rounded w-1/3" />
              <div className="h-4 bg-slate-200 rounded w-2/3" />
              <div className="h-4 bg-slate-200 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center my-auto min-h-[400px]">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
          <SearchX className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">
          No hay propiedades en este cuadrante
        </h3>
        <p className="text-sm text-slate-500 max-w-sm mt-1 mb-6">
          Prueba a alejar el zoom del mapa, desplazarte a otra zona o relajar los filtros aplicados.
        </p>
        {onResetFilters && (
          <button
            onClick={onResetFilters}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all shadow-sm shadow-blue-500/20"
          >
            Restablecer todos los filtros
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowItems = rows[virtualRow.index];
          return (
            <div
              key={`row-${virtualRow.index}`}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 absolute top-0 left-0 right-0"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                minHeight: `${virtualRow.size}px`,
              }}
            >
              {rowItems.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  isHovered={hoveredPropertyId === property.id}
                  onMouseEnter={() => onHoverProperty && onHoverProperty(property.id)}
                  onMouseLeave={() => onHoverProperty && onHoverProperty(null)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
