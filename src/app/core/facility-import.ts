import {
  DatasetProvenance, Facility, FacilityCategory, GeographicReview, OsmElementType,
} from '../models/facility.model';

export interface FacilityImportCandidate {
  osmType: OsmElementType | '';
  osmId: string;
  name: string;
  parseErrors: string[];
  sourceCategory: string;
  category: FacilityCategory | '';
  address: string;
  city: string;
  province: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  contactNumber: string;
  website: string;
  openingHours: string;
  services: string[];
  source: string;
  sourceUrl: string;
  attribution: string;
  rawTags?: Record<string, unknown>;
  provenance: DatasetProvenance;
  geographicReview: GeographicReview;
  selected: boolean;
}

const categories: FacilityCategory[] = ['hospital', 'clinic', 'pharmacy', 'health_center'];
const osmTypes: OsmElementType[] = ['node', 'way', 'relation'];
export const facilityImportBatchSize = 400;

export function parseFacilityImportFile(contents: string, filename: string): FacilityImportCandidate[] {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return parseCsv(contents);
  if (extension === 'json') return parseJson(contents);
  throw new Error('Choose a CSV or JSON file.');
}

export function facilityImportErrors(candidate: FacilityImportCandidate): string[] {
  const errors = [...candidate.parseErrors];
  if (!osmTypes.includes(candidate.osmType as OsmElementType)) errors.push('OSM element type must be node, way, or relation.');
  if (!/^\d+$/.test(candidate.osmId)) errors.push('OSM ID must contain only digits.');
  if (!categories.includes(candidate.category as FacilityCategory)) errors.push('Choose a supported facility category.');
  if (candidate.latitude === null || !Number.isFinite(candidate.latitude)
    || candidate.latitude < -90 || candidate.latitude > 90) errors.push('Latitude is missing or outside -90 to 90.');
  if (candidate.longitude === null || !Number.isFinite(candidate.longitude)
    || candidate.longitude < -180 || candidate.longitude > 180) errors.push('Longitude is missing or outside -180 to 180.');
  if (candidate.source !== 'openstreetmap') errors.push('Source must be openstreetmap.');
  if (!candidate.sourceUrl
    || candidate.sourceUrl !== `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`) {
    errors.push('Source URL must identify this exact OpenStreetMap element.');
  }
  if (!candidate.attribution.trim()) errors.push('Source attribution is required.');
  return errors;
}

export function facilityImportWarnings(candidate: FacilityImportCandidate): string[] {
  const warnings: string[] = [];
  if (!candidate.name.trim()) warnings.push('Facility name is not provided.');
  if (!candidate.rawTags) warnings.push('Original source tags are not provided.');
  if (candidate.geographicReview === 'unreviewed') {
    warnings.push('MIMAROPA geographic coverage has not been reviewed.');
  } else if (candidate.geographicReview === 'uncertain') {
    warnings.push('Geographic coverage remains uncertain.');
  } else if (candidate.geographicReview === 'outside') {
    warnings.push('Reviewer marked this record outside MIMAROPA; it cannot be imported.');
  }
  return warnings;
}

export function normalizeOsmCategory(
  sourceCategory: string,
  tags: Record<string, unknown> | undefined,
): FacilityCategory | '' {
  if (categories.includes(sourceCategory as FacilityCategory)) return sourceCategory as FacilityCategory;
  const amenity = stringTag(tags?.['amenity']);
  const healthcare = stringTag(tags?.['healthcare']);
  if (healthcare === 'pharmacy' || amenity === 'pharmacy') return 'pharmacy';
  if (healthcare === 'hospital' || amenity === 'hospital') return 'hospital';
  if (['clinic', 'doctor', 'dentist'].includes(healthcare)
    || ['clinic', 'doctors', 'dentist'].includes(amenity)) return 'clinic';
  if (['health_centre', 'centre', 'midwife'].includes(healthcare) || amenity === 'health_centre') {
    return 'health_center';
  }
  return '';
}

export function facilityImportDuplicateIndex(candidates: FacilityImportCandidate[]): Set<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  candidates.forEach((candidate, index) => {
    const key = `${candidate.osmType}/${candidate.osmId}`;
    if (seen.has(key)) duplicates.add(index);
    else seen.add(key);
  });
  return duplicates;
}

export function findPotentialFacilityDuplicates(
  candidates: FacilityImportCandidate[],
  distanceLimitMeters = 100,
): Array<{ first: number; second: number; distanceMeters: number }> {
  const pairs: Array<{ first: number; second: number; distanceMeters: number }> = [];
  const byNameAndCategory = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const name = normalizeName(candidate.name);
    if (!name || !candidate.category) return;
    const key = `${candidate.category}/${name}`;
    const matchingIndices = byNameAndCategory.get(key);
    if (matchingIndices) matchingIndices.push(index);
    else byNameAndCategory.set(key, [index]);
  });

  for (const indices of byNameAndCategory.values()) {
    for (let firstIndex = 0; firstIndex < indices.length; firstIndex += 1) {
      const first = indices[firstIndex];
      if (first === undefined) continue;
      const firstCandidate = candidates[first];
      if (!firstCandidate || firstCandidate.latitude === null || firstCandidate.longitude === null) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < indices.length; secondIndex += 1) {
        const second = indices[secondIndex];
        if (second === undefined) continue;
        const secondCandidate = candidates[second];
        if (!secondCandidate || secondCandidate.latitude === null || secondCandidate.longitude === null) continue;
        const distanceMeters = distanceBetweenMeters(firstCandidate, secondCandidate);
        if (distanceMeters <= distanceLimitMeters) pairs.push({ first, second, distanceMeters });
      }
    }
  }
  return pairs;
}

export function findPotentialExistingFacilityDuplicates(
  candidates: FacilityImportCandidate[],
  existingFacilities: Facility[],
  distanceLimitMeters = 100,
): Set<number> {
  const existingByName = new Map<string, Facility[]>();
  for (const facility of existingFacilities) {
    if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') continue;
    const names = new Set([facility.name, facility.sourceData?.originalName]
      .map(normalizeName).filter(Boolean));
    for (const name of names) {
      const key = `${facility.category}/${name}`;
      const matchingFacilities = existingByName.get(key);
      if (matchingFacilities) matchingFacilities.push(facility);
      else existingByName.set(key, [facility]);
    }
  }

  const matches = new Set<number>();
  candidates.forEach((candidate, index) => {
    const name = normalizeName(candidate.name);
    if (!name || !candidate.category || candidate.latitude === null || candidate.longitude === null) return;
    const matchesByName = existingByName.get(`${candidate.category}/${name}`) ?? [];
    if (matchesByName.some((facility) =>
      typeof facility.latitude === 'number' && typeof facility.longitude === 'number'
      && distanceBetweenMeters(candidate, facility) <= distanceLimitMeters)) {
      matches.add(index);
    }
  });
  return matches;
}

export function osmFacilityDocumentId(type: OsmElementType, osmId: string): string {
  return `osm_${type}_${osmId}`;
}

export function splitFacilityImportBatches<T>(
  records: readonly T[],
  batchSize = facilityImportBatchSize,
): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('Firestore import batch size must be between 1 and 500.');
  }
  const batches: T[][] = [];
  for (let offset = 0; offset < records.length; offset += batchSize) {
    batches.push(records.slice(offset, offset + batchSize));
  }
  return batches;
}

export interface FacilityBatchFailure {
  firstRecord: number;
  recordCount: number;
  error: unknown;
}

export interface FacilityBatchCommitResult {
  succeeded: number;
  failed: number;
  failures: FacilityBatchFailure[];
}

export async function commitFacilityImportBatches<T>(
  records: readonly T[],
  commit: (batch: readonly T[]) => Promise<void>,
  onBatchCompleted?: (recordCount: number) => void,
  batchSize = facilityImportBatchSize,
): Promise<FacilityBatchCommitResult> {
  const result: FacilityBatchCommitResult = { succeeded: 0, failed: 0, failures: [] };
  let firstRecord = 1;
  for (const batch of splitFacilityImportBatches(records, batchSize)) {
    try {
      await commit(batch);
      result.succeeded += batch.length;
    } catch (error) {
      result.failed += batch.length;
      result.failures.push({ firstRecord, recordCount: batch.length, error });
    } finally {
      onBatchCompleted?.(batch.length);
    }
    firstRecord += batch.length;
  }
  return result;
}

export function parseCsv(contents: string): FacilityImportCandidate[] {
  const rows = parseCsvRows(contents.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('The CSV must include a header and at least one record.');
  const header = rows[0]?.map((value) => value.trim()) ?? [];
  if (!header.includes('osmType') || !header.includes('osmId')) {
    throw new Error('The CSV must include osmType and osmId columns.');
  }
  return rows.slice(1).flatMap((values) => {
    if (values.every((value) => !value.trim())) return [];
    const raw: Record<string, unknown> = {};
    header.forEach((key, index) => { raw[key] = values[index] ?? ''; });
    return [candidateFromRecord(raw)];
  });
}

function parseJson(contents: string): FacilityImportCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`The JSON file is not valid: ${error instanceof Error ? error.message : 'parse error'}`);
  }
  const root = asRecord(parsed);
  const records = Array.isArray(parsed) ? parsed : root?.['records'];
  if (!Array.isArray(records)) throw new Error('The JSON file must contain an array or a records array.');
  const metadata = asRecord(root?.['metadata']);
  return records.map((record) => candidateFromRecord(asRecord(record) ?? {}, metadata ?? undefined));
}

function candidateFromRecord(
  record: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): FacilityImportCandidate {
  const tags = parseTags(record['rawTags']);
  const parseErrors: string[] = [];
  const rawTagsValue = record['rawTags'];
  if (typeof record['name'] !== 'undefined' && record['name'] !== null && typeof record['name'] !== 'string') {
    parseErrors.push('Facility name must be a string when provided.');
  }
  if (typeof record['source'] !== 'undefined' && typeof record['source'] !== 'string') {
    parseErrors.push('Source must be a string.');
  }
  if (typeof record['sourceUrl'] !== 'undefined' && typeof record['sourceUrl'] !== 'string') {
    parseErrors.push('Source URL must be a string.');
  }
  if (typeof record['attribution'] !== 'undefined' && typeof record['attribution'] !== 'string') {
    parseErrors.push('Source attribution must be a string.');
  }
  if (rawTagsValue !== undefined && rawTagsValue !== null
    && !(typeof rawTagsValue === 'string' && !rawTagsValue.trim())
    && !tags) {
    parseErrors.push('Original source tags must be a JSON object when provided.');
  }
  const sourceCategory = stringValue(record['category']);
  const provenance = {
    datasetName: optionalString(metadata?.['datasetName']),
    datasetProvider: optionalString(record['datasetProvider']) ?? optionalString(metadata?.['sourceProvenance']),
    datasetFile: optionalString(record['datasetFile']) ?? optionalString(metadata?.['sourceArchive']),
    datasetLicense: optionalString(record['datasetLicense']) ?? optionalString(metadata?.['license']),
    coverageRequested: optionalString(metadata?.['coverageRequested']),
    coverageActual: optionalString(metadata?.['coverageActual']),
    regionFilterMethod: optionalString(record['regionFilterMethod']),
  };
  return {
    osmType: stringValue(record['osmType']) as OsmElementType | '',
    osmId: stringValue(record['osmId']),
    name: stringValue(record['name']),
    parseErrors,
    sourceCategory,
    category: normalizeOsmCategory(sourceCategory, tags),
    address: stringValue(record['address']),
    city: stringValue(record['city']),
    province: stringValue(record['provinceOrArea'] ?? record['province']),
    region: stringValue(record['region'] ?? metadata?.['coverageRequested']),
    latitude: numberValue(record['latitude']),
    longitude: numberValue(record['longitude']),
    contactNumber: stringValue(record['contactNumber']),
    website: stringValue(record['website']),
    openingHours: stringValue(record['openingHours']),
    services: stringList(record['services']),
    source: stringValue(record['source']),
    sourceUrl: stringValue(record['sourceUrl']),
    attribution: stringValue(record['attribution']),
    rawTags: tags,
    provenance,
    geographicReview: 'unreviewed',
    selected: false,
  };
}

function parseTags(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    if (!value.trim()) return undefined;
    try {
      return asRecord(JSON.parse(value)) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return asRecord(value) ?? undefined;
}

function parseCsvRows(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && contents[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const result = stringValue(value);
  return result || undefined;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return value.split(';').map((item) => item.trim()).filter(Boolean);
  return [];
}

function stringTag(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeName(value: string | undefined): string {
  return value?.toLocaleLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
}

function distanceBetweenMeters(
  first: { latitude?: number | null; longitude?: number | null },
  second: { latitude?: number | null; longitude?: number | null },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude! - first.latitude!);
  const longitudeDelta = radians(second.longitude! - first.longitude!);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude!)) * Math.cos(radians(second.latitude!))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
