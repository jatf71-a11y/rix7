export type PropertyType =
  | 'all'
  | 'apartment'
  | 'house'
  | 'premium'
  | 'parcel'
  | 'office'
  | 'land'
  | 'parking'
  | 'local'
  | 'warehouse';

export interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  property_type: PropertyType;
  // `sold` = venta concretada, `rented` = arriendo concretado (0015): el
  // portal los trata igual — fuera de los filtros de operación, visibles con
  // su etiqueta en la ficha y en el panel.
  status: 'for_sale' | 'for_rent' | 'sold' | 'rented';
  bedrooms: number;
  bathrooms: number;
  privates?: number;
  area_sqm: number;
  parking_spots: number;
  year_built?: number;
  address: string;
  city: string;
  state?: string;
  zip_code?: string;
  images: string[];
  features: string[];
  lat: number;
  lng: number;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string;
  agent_avatar?: string;
  created_at?: string;
  featured?: boolean;
  newPropertyType?: 'proyectos' | 'entrega_inmediata' | null;
  partner_id?: string;
  video_url?: string;
  /** Fotograma de portada del video: se muestra mientras el video carga. */
  video_poster?: string;
}

export type NewPropertyType = 'proyectos' | 'entrega_inmediata' | null;

export interface PropertyFilterState {
  operationType: 'for_sale' | 'for_rent' | 'all';
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  minBathrooms: number | null;
  minPrivates: number | null;
  propertyType: PropertyType;
  searchQuery: string;
  newPropertyType: NewPropertyType;
}
