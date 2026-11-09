import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertController, IonButton, IonContent, IonIcon, IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular';
import {
  DatasetProvenance, Facility, FacilityCategory, FacilitySourceData, GeographicReview, OsmElementType,
  categoryLabels,
} from '../../models/facility.model';
import {
  FacilityImportCandidate, commitFacilityImportBatches, facilityImportDuplicateIndex, facilityImportErrors,
  facilityImportWarnings, findPotentialExistingFacilityDuplicates, findPotentialFacilityDuplicates,
  osmFacilityDocumentId, parseFacilityImportFile,
} from '../../core/facility-import';
import { FacilityService, ImportedFacilityInput } from '../../core/facility.service';

interface ImportSummary {
  newRecords: number;
  existingRecords: number;
  duplicateRecords: number;
  invalidRecords: number;
  failedImports: number;
  batchErrors: string[];
}

@Component({
  selector: 'app-import-facilities',
  templateUrl: './import-facilities.page.html',
  styleUrls: ['./import-facilities.page.scss'],
  imports: [CommonModule, FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonSelect, IonSelectOption, IonSpinner],
})
export class ImportFacilitiesPage {
  private readonly facilities = inject(FacilityService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly alertController = inject(AlertController);

  readonly categoryLabels = categoryLabels;
  readonly categoryOptions: FacilityCategory[] = ['hospital', 'clinic', 'pharmacy', 'health_center'];
  readonly reviewOptions: Array<{ value: GeographicReview; label: string }> = [
    { value: 'unreviewed', label: 'Needs review' },
    { value: 'confirmed', label: 'Confirmed in MIMAROPA' },
    { value: 'uncertain', label: 'Uncertain — retain warning' },
    { value: 'outside', label: 'Outside MIMAROPA — do not import' },
  ];

  candidates: FacilityImportCandidate[] = [];
  duplicateIndices = new Set<number>();
  potentialDuplicateIndices = new Set<number>();
  existingIds = new Set<string>();
  existingFacilities: Facility[] = [];
  existingLoaded = false;
  loadingExisting = false;
  importing = false;
  errorMessage = '';
  fileName = '';
  search = '';
  categoryFilter: FacilityCategory | 'all' = 'all';
  boundaryValidationConfirmed = false;
  progressCompleted = 0;
  progressTotal = 0;
  summary: ImportSummary | null = null;

  get filteredCandidates(): Array<{ candidate: FacilityImportCandidate; index: number }> {
    const term = this.search.trim().toLocaleLowerCase();
    return this.candidates.flatMap((candidate, index) => {
      if (this.categoryFilter !== 'all' && candidate.category !== this.categoryFilter) return [];
      const searchable = [
        candidate.name, candidate.osmId, candidate.osmType, candidate.sourceCategory, candidate.address,
        candidate.city, candidate.province,
      ].join(' ').toLocaleLowerCase();
      return !term || searchable.includes(term) ? [{ candidate, index }] : [];
    });
  }

  get selectedCandidates(): FacilityImportCandidate[] {
    return this.candidates.filter((candidate) => candidate.selected);
  }

  get selectedValidCandidates(): FacilityImportCandidate[] {
    return this.candidates.filter((candidate, index) =>
      candidate.selected && !this.duplicateIndices.has(index) && facilityImportErrors(candidate).length === 0);
  }

  get validCount(): number {
    return this.candidates.filter((candidate, index) =>
      !this.duplicateIndices.has(index) && facilityImportErrors(candidate).length === 0).length;
  }

  get invalidCount(): number {
    return this.candidates.filter((candidate) => facilityImportErrors(candidate).length > 0).length;
  }

  get duplicateCount(): number {
    return this.duplicateIndices.size;
  }

  get potentialDuplicateCount(): number {
    return this.potentialDuplicateIndices.size;
  }

  get existingCount(): number {
    return this.selectedValidCandidates.filter((candidate) =>
      this.existingIds.has(this.documentId(candidate))).length;
  }

  get newCount(): number {
    return this.selectedValidCandidates.length - this.existingCount;
  }

  get blockedSelectionMessage(): string {
    if (this.selectedCandidates.some((candidate) =>
      facilityImportErrors(candidate).length > 0 || this.duplicateIndices.has(this.candidates.indexOf(candidate)))) {
      return 'Deselect selected records with validation errors or repeated OSM identifiers before importing.';
    }
    if (this.selectedCandidates.some((candidate) => candidate.geographicReview === 'unreviewed')) {
      return 'Review the MIMAROPA geographic status of every selected record before importing.';
    }
    if (this.selectedCandidates.some((candidate) => candidate.geographicReview === 'outside')) {
      return 'Deselect records marked outside MIMAROPA. They remain visible in the preview and are not discarded.';
    }
    if (this.selectedCandidates.length && !this.boundaryValidationConfirmed) {
      return 'Confirm that the selected records were checked against an authoritative MIMAROPA boundary.';
    }
    return '';
  }

  get canImport(): boolean {
    return this.facilities.isConfigured && this.existingLoaded && !this.importing
      && this.selectedValidCandidates.length > 0 && !this.blockedSelectionMessage;
  }

  async ionViewWillEnter(): Promise<void> {
    await this.loadExistingIds();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    await this.loadImportFile(file);
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  async onFileDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) await this.loadImportFile(file);
  }

  private async loadImportFile(file: File): Promise<void> {
    this.errorMessage = '';
    this.summary = null;
    this.boundaryValidationConfirmed = false;
    this.existingLoaded = false;
    this.candidates = [];
    this.fileName = file.name;
    try {
      this.candidates = parseFacilityImportFile(await file.text(), file.name);
      this.analyzeCandidates();
      if (!this.candidates.length) this.errorMessage = 'The uploaded file contains no records.';
      await this.loadExistingIds();
    } catch (error) {
      this.candidates = [];
      this.errorMessage = error instanceof Error ? error.message : 'Could not read the selected file.';
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  selectAllValid(): void {
    this.candidates.forEach((candidate, index) => {
      candidate.selected = !this.duplicateIndices.has(index) && facilityImportErrors(candidate).length === 0;
    });
  }

  deselectAll(): void {
    this.candidates.forEach((candidate) => { candidate.selected = false; });
  }

  async confirmAllGeographicReviews(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Confirm all records?',
      message: `This marks all ${this.candidates.length} records in the file as confirmed in MIMAROPA. Only continue after checking every record against an authoritative boundary. The import confirmation checkbox will still be required.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Confirm all', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;
    this.candidates.forEach((candidate) => { candidate.geographicReview = 'confirmed'; });
  }

  categoryChanged(): void {
    this.analyzeCandidates();
  }

  candidateErrors(candidate: FacilityImportCandidate): string[] {
    return facilityImportErrors(candidate);
  }

  candidateWarnings(candidate: FacilityImportCandidate): string[] {
    return facilityImportWarnings(candidate);
  }

  isPotentialDuplicate(index: number): boolean {
    return this.potentialDuplicateIndices.has(index);
  }

  documentId(candidate: FacilityImportCandidate): string {
    return osmFacilityDocumentId(candidate.osmType as OsmElementType, candidate.osmId);
  }

  async loadExistingIds(): Promise<void> {
    if (!this.facilities.isConfigured || this.loadingExisting) return;
    this.loadingExisting = true;
    this.existingLoaded = false;
    try {
      const existing = await this.facilities.getAdminFacilities();
      this.existingFacilities = existing;
      this.existingIds = new Set(existing.map((facility) => facility.id));
      this.existingLoaded = true;
      if (this.candidates.length) this.analyzeCandidates();
    } catch (error) {
      this.errorMessage = error instanceof Error
        ? `Could not check existing facilities: ${error.message}`
        : 'Could not check existing facilities.';
    } finally {
      this.loadingExisting = false;
      this.changeDetector.markForCheck();
    }
  }

  async importSelected(): Promise<void> {
    if (!this.canImport) return;
    const confirmation = await this.alertController.create({
      header: 'Import selected facilities?',
      message: `Add ${this.newCount} new records. ${this.existingCount} records already in Firestore will be skipped and not overwritten.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Import facilities', role: 'confirm' },
      ],
    });
    await confirmation.present();
    if ((await confirmation.onDidDismiss()).role !== 'confirm') return;
    this.errorMessage = '';
    this.summary = null;
    this.importing = true;
    this.progressCompleted = 0;
    const duplicateRecords = this.duplicateCount;
    const invalidRecords = this.invalidCount;
    const selected = this.selectedValidCandidates;
    const batchErrors: string[] = [];
    let created = 0;
    let failed = 0;
    try {
      await this.loadExistingIds();
      if (!this.existingLoaded) throw new Error(this.errorMessage || 'Could not verify existing facility records.');
      const newFacilities = selected
        .filter((candidate) => !this.existingIds.has(this.documentId(candidate)))
        .map((candidate) => this.toImportedFacility(candidate));
      const existingRecords = selected.length - newFacilities.length;
      this.progressTotal = newFacilities.length;
      const commitResult = await commitFacilityImportBatches(
        newFacilities,
        (batch) => this.facilities.importFacilityBatch(batch),
        (recordCount) => {
          this.progressCompleted += recordCount;
          this.changeDetector.markForCheck();
        },
      );
      created = commitResult.succeeded;
      failed = commitResult.failed;
      batchErrors.push(...commitResult.failures.map(({ firstRecord, recordCount, error }) =>
        `Records ${firstRecord}–${firstRecord + recordCount - 1}: ${
          error instanceof Error ? error.message : 'Firestore batch write failed.'
        }`));
      this.summary = {
        newRecords: created,
        existingRecords,
        duplicateRecords,
        invalidRecords,
        failedImports: failed,
        batchErrors,
      };
      if (failed) this.errorMessage = `${failed} records failed in ${batchErrors.length} atomic batch(es); successful batches were retained.`;
      await this.loadExistingIds();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'The facility import could not be completed.';
    } finally {
      this.importing = false;
      this.changeDetector.markForCheck();
    }
  }

  private analyzeCandidates(): void {
    this.duplicateIndices = facilityImportDuplicateIndex(this.candidates);
    this.potentialDuplicateIndices = new Set(
      findPotentialFacilityDuplicates(this.candidates).flatMap(({ first, second }) => [first, second]),
    );
    for (const index of findPotentialExistingFacilityDuplicates(this.candidates, this.existingFacilities)) {
      this.potentialDuplicateIndices.add(index);
    }
  }

  private toImportedFacility(candidate: FacilityImportCandidate): ImportedFacilityInput {
    if (!candidate.category || !candidate.osmType || candidate.latitude === null || candidate.longitude === null) {
      throw new Error(`Record ${candidate.osmId} is missing required import data.`);
    }
    const sourceData: FacilitySourceData = {
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      sourceUrl: candidate.sourceUrl,
      ...(candidate.rawTags ? { rawTags: candidate.rawTags } : {}),
      originalCoordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
      originalName: candidate.name,
      originalAddress: candidate.address,
      ...(candidate.city ? { originalCity: candidate.city } : {}),
      ...(candidate.province ? { originalProvince: candidate.province } : {}),
      ...(candidate.region ? { originalRegion: candidate.region } : {}),
      ...(candidate.contactNumber ? { originalContactNumber: candidate.contactNumber } : {}),
      ...(candidate.website ? { originalWebsite: candidate.website } : {}),
      ...(candidate.openingHours ? { originalOpeningHours: candidate.openingHours } : {}),
      ...(candidate.services.length ? { originalServices: candidate.services } : {}),
      originalCategory: candidate.sourceCategory,
      attribution: candidate.attribution,
      datasetProvenance: cleanProvenance(candidate.provenance),
    };
    return {
      name: candidate.name,
      category: candidate.category,
      address: candidate.address,
      ...(candidate.city ? { city: candidate.city } : {}),
      ...(candidate.province ? { province: candidate.province } : {}),
      ...(candidate.region ? { region: candidate.region } : {}),
      ...(candidate.contactNumber ? { contactNumber: candidate.contactNumber } : {}),
      ...(candidate.website ? { website: candidate.website } : {}),
      ...(candidate.services.length ? { services: candidate.services } : {}),
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      isVerified: false,
      isActive: true,
      source: 'openstreetmap',
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      sourceData,
      geographicReview: candidate.geographicReview,
    };
  }
}

function cleanProvenance(provenance: DatasetProvenance): DatasetProvenance {
  return Object.fromEntries(
    Object.entries(provenance).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as DatasetProvenance;
}
