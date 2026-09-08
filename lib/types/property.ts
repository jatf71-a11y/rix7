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

export type PropertyStatus = 'all' | 'for_sale' | 'for_rent' | 'sold';

export interface Property {
  id: string;
  title: string;
  description: string;
  price: number;
  property_type: PropertyType;
  status: 'for_sale' | 'for_rent' | 'sold';
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

export interface MortgageInputs {
  homePrice: number;
  downPaymentPercent: number;
  loanTermYears: number;
  interestRate: number;
  annualPropertyTaxRate?: number;
  annualHomeInsurance?: number;
  monthlyHoa?: number;
}

export interface MortgageBreakdown {
  monthlyPayment: number;
  principalAndInterest: number;
  monthlyPropertyTax: number;
  monthlyInsurance: number;
  monthlyHoa: number;
  downPaymentAmount: number;
  loanAmount: number;
  totalInterestPaid: number;
  totalCostOverTerm: number;
}
