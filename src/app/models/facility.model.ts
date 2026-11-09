export type FacilityCategory = 'hospital' | 'clinic' | 'pharmacy' | 'health_center';
export type OsmElementType = 'node' | 'way' | 'relation';
export type GeographicReview = 'unreviewed' | 'confirmed' | 'uncertain' | 'outside';

export interface DatasetProvenance {
  datasetName?: string;
  datasetProvider?: string;
  datasetFile?: string;
  datasetLicense?: string;
  coverageRequested?: string;
  coverageActual?: string;
  regionFilterMethod?: string;
}

export interface FacilitySourceData {
  osmType: OsmElementType;
  osmId: string;
  sourceUrl: string;
  rawTags?: Record<string, unknown>;
  originalCoordinates: { latitude: number; longitude: number };
  originalName: string;
  originalAddress: string;
  originalCity?: string;
  originalProvince?: string;
  originalRegion?: string;
  originalContactNumber?: string;
  originalWebsite?: string;
  originalOpeningHours?: string;
  originalServices?: string[];
  originalCategory: string;
  attribution: string;
  datasetProvenance: DatasetProvenance;
}

export interface OperatingDay {
  open?: string;
  close?: string;
  closed?: boolean;
}

export interface FacilityPhoto {
  secureUrl: string;
  publicId?: string;
}

export type OperatingHours = Partial<Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  OperatingDay
>>;

export interface Facility {
  id: string;
  name: string;
  slug?: string;
  category: FacilityCategory;
  description?: string;
  address: string;
  barangay?: string;
  city?: string;
  province?: string;
  region?: string;
  contactNumber?: string;
  email?: string;
  website?: string;
  openingHoursText?: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
  imageUrls?: string[];
  photos?: FacilityPhoto[];
  services?: string[];
  amenities?: string[];
  operatingHours?: OperatingHours;
  timeZone?: string;
  isVerified: boolean;
  isActive: boolean;
  isSample?: boolean;
  source?: 'openstreetmap';
  osmType?: OsmElementType;
  osmId?: string;
  sourceData?: FacilitySourceData;
  geographicReview?: GeographicReview;
}

export const categoryLabels: Record<FacilityCategory, string> = {
  hospital: 'Hospitals',
  clinic: 'Clinics',
  pharmacy: 'Pharmacies',
  health_center: 'Health centers',
};
