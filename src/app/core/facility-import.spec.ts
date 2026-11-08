import { describe, expect, it } from 'vitest';
import { Facility } from '../models/facility.model';
import {
  FacilityImportCandidate, commitFacilityImportBatches, facilityImportDuplicateIndex, facilityImportErrors,
  findPotentialExistingFacilityDuplicates, findPotentialFacilityDuplicates,
  facilityImportBatchSize, normalizeOsmCategory, osmFacilityDocumentId, parseFacilityImportFile,
  splitFacilityImportBatches,
} from './facility-import';

const csv = [
  'osmType,osmId,name,category,latitude,longitude,source,sourceUrl,attribution,rawTags',
  'node,123,"Clinic, North",clinic,13.2,121.1,openstreetmap,https://www.openstreetmap.org/node/123,"© OSM","{""amenity"": ""clinic""}"',
].join('\n');

describe('parseFacilityImportFile', () => {
  it('parses quoted CSV fields and keeps missing names optional', () => {
    const [candidate] = parseFacilityImportFile(csv, 'facilities.csv');
    expect(candidate?.name).toBe('Clinic, North');
    expect(candidate?.rawTags).toEqual({ amenity: 'clinic' });
    expect(candidate && facilityImportErrors(candidate)).toEqual([]);
    const unnamed = parseFacilityImportFile(csv.replace('"Clinic, North"', ''), 'facilities.csv')[0];
    expect(unnamed?.name).toBe('');
    expect(unnamed && facilityImportErrors(unnamed)).toEqual([]);
  });

  it('accepts a JSON records document and reads metadata provenance', () => {
    const data = JSON.stringify({
      metadata: { sourceArchive: 'extract.zip', license: 'ODbL' },
      records: [{
        osmType: 'way', osmId: '44', category: 'hospital', latitude: 13, longitude: 121,
        source: 'openstreetmap', sourceUrl: 'https://www.openstreetmap.org/way/44', attribution: '© OSM',
        rawTags: { amenity: 'hospital' },
      }],
    });
    const [candidate] = parseFacilityImportFile(data, 'facilities.json');
    expect(candidate?.provenance.datasetFile).toBe('extract.zip');
    expect(candidate?.provenance.datasetLicense).toBe('ODbL');
    expect(candidate && facilityImportErrors(candidate)).toEqual([]);
  });

  it('previews twenty test records and splits larger imports below Firestore limits', () => {
    const records = Array.from({ length: 20 }, (_, index) => ({
      osmType: 'node',
      osmId: String(1000 + index),
      name: `Clinic ${index}`,
      category: 'clinic',
      latitude: 13 + index / 1000,
      longitude: 121,
      source: 'openstreetmap',
      sourceUrl: `https://www.openstreetmap.org/node/${1000 + index}`,
      attribution: '© OpenStreetMap contributors',
    }));
    const candidates = parseFacilityImportFile(JSON.stringify({ records }), 'test.json');
    expect(candidates).toHaveLength(20);
    expect(candidates.every((candidate) => facilityImportErrors(candidate).length === 0)).toBe(true);

    const batches = splitFacilityImportBatches(Array.from({ length: 901 }, (_, index) => index));
    expect(facilityImportBatchSize).toBe(400);
    expect(batches.map((batch) => batch.length)).toEqual([400, 400, 101]);
    expect(batches.flat()).toHaveLength(901);
  });

  it('continues after a failed batch and reports exact partial results', async () => {
    const progress: number[] = [];
    const result = await commitFacilityImportBatches(
      [1, 2, 3, 4, 5],
      async (batch) => {
        if (batch[0] === 3) throw new Error('simulated batch failure');
      },
      (recordCount) => progress.push(recordCount),
      2,
    );
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.failures).toEqual([
      { firstRecord: 3, recordCount: 2, error: new Error('simulated batch failure') },
    ]);
    expect(progress).toEqual([2, 2, 1]);
  });

  it('rejects invalid coordinates and source identity but not absent names', () => {
    const candidate = parseFacilityImportFile(csv, 'facilities.csv')[0];
    expect(candidate).toBeDefined();
    if (!candidate) return;
    candidate.latitude = 91;
    candidate.sourceUrl = 'https://www.openstreetmap.org/node/999';
    expect(facilityImportErrors(candidate)).toHaveLength(2);
  });
});

describe('facility import identity and duplicate checks', () => {
  it('normalizes known categories from source tags and creates stable Firestore ids', () => {
    expect(normalizeOsmCategory('other_healthcare', { amenity: 'dentist' })).toBe('clinic');
    expect(osmFacilityDocumentId('relation', '123')).toBe('osm_relation_123');
  });

  it('flags repeated OSM ids and only suggests nearby same-name/category candidates', () => {
    const candidates: FacilityImportCandidate[] = parseFacilityImportFile(csv, 'facilities.csv');
    candidates.push({ ...candidates[0]!, osmId: '456', latitude: 13.2001, name: 'Clinic North' });
    candidates.push({ ...candidates[0]!, osmId: '123', name: 'Different name' });
    expect(facilityImportDuplicateIndex(candidates)).toEqual(new Set([2]));
    expect(findPotentialFacilityDuplicates(candidates)).toHaveLength(1);
  });

  it('only flags existing facilities when category, name, and proximity agree', () => {
    const candidate = parseFacilityImportFile(csv, 'facilities.csv')[0];
    expect(candidate).toBeDefined();
    if (!candidate) return;
    const existing: Facility[] = [
      { id: 'near', name: 'Clinic, North', category: 'clinic', address: '', latitude: 13.2001, longitude: 121.1, isVerified: false, isActive: true },
      { id: 'far', name: 'Clinic, North', category: 'clinic', address: '', latitude: 14, longitude: 121.1, isVerified: false, isActive: true },
      { id: 'near-different-name', name: 'Different', category: 'clinic', address: '', latitude: 13.2, longitude: 121.1, isVerified: false, isActive: true },
    ];
    expect(findPotentialExistingFacilityDuplicates([candidate], existing)).toEqual(new Set([0]));
  });
});
