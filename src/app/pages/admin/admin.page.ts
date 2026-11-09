import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController, IonButton, IonCheckbox, IonContent, IonIcon,
  IonInput, IonItem, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonTextarea, ToastController,
} from '@ionic/angular';
import {
  CloudinaryService, cloudinaryImageUrl, facilityPhotoValidationError,
} from '../../core/cloudinary.service';
import { FacilityService } from '../../core/facility.service';
import {
  Facility, FacilityCategory, FacilityPhoto as FacilityPhotoData, OperatingHours, categoryLabels,
} from '../../models/facility.model';
import * as L from 'leaflet';

interface FacilityPhoto {
  id: number;
  url: string;
  previewUrl: string;
  publicId?: string;
  file?: File;
  progress: number;
  uploading: boolean;
  error?: string;
}

type AdminTab = 'facilities' | 'add';
type RecordStatusFilter = 'all' | 'active' | 'inactive';
type VerificationFilter = 'all' | 'verified' | 'unverified';

interface ScheduleDay {
  key: keyof OperatingHours;
  label: string;
  included: boolean;
  closed: boolean;
  open: string;
  close: string;
}

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  imports: [
    CommonModule, FormsModule, IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem,
    IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonTextarea,
  ],
})
export class AdminPage implements OnDestroy {
  @ViewChild('locationPicker') private locationPicker?: ElementRef<HTMLDivElement>;
  private readonly facilitiesService = inject(FacilityService);
  private readonly cloudinary = inject(CloudinaryService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private pickerMap?: L.Map;
  private pickerMarker?: L.CircleMarker;
  private initialFormState = '';

  readonly categoryLabels = categoryLabels;
  readonly categoryOptions: FacilityCategory[] = ['hospital', 'clinic', 'pharmacy', 'health_center'];
  readonly categoryIcons: Record<FacilityCategory, string> = {
    hospital: 'medkit-outline',
    clinic: 'pulse-outline',
    pharmacy: 'bandage-outline',
    health_center: 'heart-outline',
  };
  readonly weekdays: Array<{ key: keyof OperatingHours; label: string }> = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
  ];
  activeTab: AdminTab = 'facilities';
  statusFilter: RecordStatusFilter = 'all';
  verificationFilter: VerificationFilter = 'all';
  schedule: ScheduleDay[] = this.createSchedule();
  coordinatePickerVisible = false;
  records: Facility[] = [];
  selectedRecord: Facility | null = null;
  loading = false;
  saving = false;
  deletingId: string | null = null;
  submitAttempted = false;
  search = '';
  categoryFilter: FacilityCategory | 'all' = 'all';
  errorMessage = '';
  photoMessage = '';
  editingId: string | null = null;
  photos: FacilityPhoto[] = [];
  primaryPhotoId: number | null = null;
  private nextPhotoId = 0;

  form = this.emptyForm();

  get filteredRecords(): Facility[] {
    const search = this.search.trim().toLowerCase();
    return this.records.filter((record) => {
      const matchesCategory = this.categoryFilter === 'all' || record.category === this.categoryFilter;
      const matchesStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' ? record.isActive : !record.isActive);
      const matchesVerification = this.verificationFilter === 'all'
        || (this.verificationFilter === 'verified' ? record.isVerified : !record.isVerified);
      return matchesCategory && matchesStatus && matchesVerification && (!search
        || `${record.name} ${record.category} ${record.address} ${record.city ?? ''}`.toLowerCase().includes(search));
    });
  }

  get unverifiedCount(): number {
    return this.records.length - this.verifiedCount;
  }

  get hasUnsavedChanges(): boolean {
    return this.activeTab === 'add' && this.initialFormState !== this.currentFormState();
  }

  get coordinateError(): string {
    if ((this.form.latitude === undefined) !== (this.form.longitude === undefined)) {
      return 'Enter both latitude and longitude, or leave both blank.';
    }
    if (this.form.latitude !== undefined
      && (!Number.isFinite(this.form.latitude) || !Number.isFinite(this.form.longitude)
        || this.form.latitude < -90 || this.form.latitude > 90 || this.form.longitude! < -180 || this.form.longitude! > 180)) {
      return 'Coordinates are outside the valid latitude or longitude range.';
    }
    return '';
  }

  get phoneIsValid(): boolean {
    const value = this.form.contactNumber.trim();
    return !value || isValidPhone(value);
  }

  get websiteIsValid(): boolean {
    const value = this.form.website.trim();
    return !value || isValidWebsite(value);
  }

  get verifiedCount(): number {
    return this.records.filter((record) => record.isVerified).length;
  }

  get activeCount(): number {
    return this.records.filter((record) => record.isActive).length;
  }

  recordPhotoUrl(record: Facility): string | undefined {
    return cloudinaryImageUrl(record.imageUrl ?? record.photos?.[0]?.secureUrl ?? record.imageUrls?.[0], 160);
  }

  recordAddress(record: Facility): string {
    return [record.address, record.barangay, record.city, record.province]
      .filter((part): part is string => Boolean(part?.trim()))
      .filter((part, index, parts) => parts.findIndex((value) => value.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
      .join(', ');
  }

  view(record: Facility): void {
    this.selectedRecord = this.selectedRecord?.id === record.id ? null : record;
  }

  async selectTab(tab: AdminTab): Promise<void> {
    if (tab === this.activeTab) return;
    if (this.hasUnsavedChanges) {
      if (!await this.confirmDiscardChanges()) return;
      this.newFacility();
    }
    if (tab === 'add' && !this.editingId) this.newFacility();
    this.activeTab = tab;
  }

  async openImportTab(): Promise<void> {
    if (this.hasUnsavedChanges) {
      if (!await this.confirmDiscardChanges()) return;
      this.newFacility();
    }
    await this.router.navigateByUrl('/admin/import');
  }

  clearFilters(): void {
    this.search = '';
    this.categoryFilter = 'all';
    this.statusFilter = 'all';
    this.verificationFilter = 'all';
  }

  async ionViewWillEnter(): Promise<void> {
    if (this.route.snapshot.queryParamMap.get('tab') === 'add') {
      this.newFacility();
      this.activeTab = 'add';
    } else {
      this.activeTab = 'facilities';
    }
    await this.loadRecords();
  }

  async loadRecords(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      this.records = await this.facilitiesService.getAdminFacilities();
      if (this.selectedRecord) {
        this.selectedRecord = this.records.find((item) => item.id === this.selectedRecord?.id) ?? null;
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not load facility records.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  edit(record: Facility): void {
    if (this.saving) return;
    this.clearPhotoPreviews();
    this.editingId = record.id;
    this.submitAttempted = false;
    this.form = {
      name: record.name || record.sourceData?.originalName || '',
      category: record.category,
      description: record.description ?? '',
      address: record.address || record.sourceData?.originalAddress || '',
      barangay: record.barangay ?? '',
      city: record.city ?? '',
      province: record.province ?? '',
      region: record.region ?? '',
      contactNumber: record.contactNumber ?? '',
      email: record.email ?? '',
      website: record.website ?? '',
      latitude: record.latitude,
      longitude: record.longitude,
      services: (record.services ?? []).join(', '),
      amenities: (record.amenities ?? []).join(', '),
      isVerified: record.isVerified,
      isActive: record.isActive,
      timeZone: record.timeZone ?? '',
    };
    const savedPhotos = record.photos ?? [];
    const imageUrls = [...new Set([record.imageUrl, ...savedPhotos.map((photo) => photo.secureUrl), ...(record.imageUrls ?? [])].filter(
      (url): url is string => Boolean(url),
    ))];
    this.photos = imageUrls.map((url) =>
      this.existingPhoto(url, savedPhotos.find((photo) => photo.secureUrl === url)?.publicId));
    this.primaryPhotoId = this.photos[0]?.id ?? null;
    this.photoMessage = '';
    this.schedule = this.weekdays.map(({ key, label }) => {
      const hours = record.operatingHours?.[key];
      return {
        key, label, included: Boolean(hours), closed: hours?.closed ?? false,
        open: hours?.open ?? '09:00', close: hours?.close ?? '17:00',
      };
    });
    this.activeTab = 'add';
    this.captureInitialFormState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  newFacility(): void {
    if (this.saving) return;
    this.clearPhotoPreviews();
    this.editingId = null;
    this.submitAttempted = false;
    this.form = this.emptyForm();
    this.schedule = this.createSchedule();
    this.photos = [];
    this.primaryPhotoId = null;
    this.photoMessage = '';
    this.captureInitialFormState();
  }

  async cancelForm(): Promise<void> {
    if (this.saving || (this.hasUnsavedChanges && !await this.confirmDiscardChanges())) return;
    this.newFacility();
    this.activeTab = 'facilities';
  }

  async resetForm(): Promise<void> {
    if (this.saving || (this.hasUnsavedChanges && !await this.confirmDiscardChanges('Reset this form?'))) return;
    this.newFacility();
  }

  async openCoordinatePicker(): Promise<void> {
    this.coordinatePickerVisible = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const host = this.locationPicker?.nativeElement;
    if (!host) return;
    this.pickerMap?.remove();
    const hasCoordinates = this.form.latitude !== undefined && this.form.longitude !== undefined;
    const center: L.LatLngExpression = hasCoordinates
      ? [this.form.latitude!, this.form.longitude!]
      : [12.8797, 121.774];
    this.pickerMap = L.map(host).setView(center, hasCoordinates ? 14 : 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.pickerMap);
    if (hasCoordinates) this.setPickerMarker(this.form.latitude!, this.form.longitude!);
    this.pickerMap.on('click', (event: L.LeafletMouseEvent) => {
      this.form.latitude = Number(event.latlng.lat.toFixed(7));
      this.form.longitude = Number(event.latlng.lng.toFixed(7));
      this.setPickerMarker(this.form.latitude, this.form.longitude);
      this.changeDetector.markForCheck();
    });
    setTimeout(() => this.pickerMap?.invalidateSize(), 0);
  }

  closeCoordinatePicker(): void {
    this.coordinatePickerVisible = false;
    this.pickerMap?.remove();
    this.pickerMap = undefined;
    this.pickerMarker = undefined;
  }

  onPhotoSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.photoMessage = '';
    const availableSlots = Math.max(0, 5 - this.photos.length);
    if (!availableSlots) {
      this.photoMessage = 'A facility can have up to 5 photos. Remove a photo before adding another.';
      return;
    }

    for (const file of files) {
      if (this.photos.length >= 5) {
        this.photoMessage = 'Only 5 photos are allowed per facility.';
        break;
      }
      const validationMessage = this.validatePhoto(file);
      if (validationMessage) {
        this.photoMessage = validationMessage;
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      const photo: FacilityPhoto = {
        id: this.nextPhotoId++,
        url: '',
        previewUrl,
        file,
        progress: 0,
        uploading: false,
      };
      this.photos = [...this.photos, photo];
      this.primaryPhotoId ??= photo.id;
    }
    if (files.length > availableSlots && !this.photoMessage) {
      this.photoMessage = 'Only 5 photos are allowed per facility. Extra selected files were not added.';
    }
  }

  removePhoto(photo: FacilityPhoto): void {
    if (photo.uploading) return;
    this.releasePreview(photo);
    this.photos = this.photos.filter((item) => item.id !== photo.id);
    if (this.primaryPhotoId === photo.id) this.primaryPhotoId = this.photos[0]?.id ?? null;
    this.photoMessage = '';
  }

  async retryPhoto(photo: FacilityPhoto): Promise<void> {
    if (photo.file) await this.uploadPhoto(photo);
  }

  async submit(): Promise<void> {
    if (this.saving) return;
    this.submitAttempted = true;
    this.errorMessage = '';
    const name = this.form.name.trim();
    const address = this.form.address.trim();
    if (!name || !address || !this.form.category) {
      this.errorMessage = 'Facility name, category, and address are required.';
      return;
    }
    if (this.coordinateError) {
      this.errorMessage = this.coordinateError;
      return;
    }
    if (!this.phoneIsValid) {
      this.errorMessage = 'Enter a valid contact number, including only digits and common phone punctuation.';
      return;
    }
    if (this.form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email.trim())) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }
    if (!this.websiteIsValid) {
      this.errorMessage = 'Enter a valid website address, such as https://example.com.';
      return;
    }
    if (this.photos.length > 5) {
      this.errorMessage = 'A facility can have up to 5 photos. Remove extra photos before saving.';
      return;
    }

    let operatingHours: OperatingHours | undefined;
    try {
      operatingHours = this.buildOperatingHours();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Check the operating hours.';
      return;
    }

    this.saving = true;
    try {
      for (const photo of this.photos) {
        if (photo.file) await this.uploadPhoto(photo);
      }
      if (this.photos.some((photo) => photo.file)) {
        throw new Error('Some photos could not be uploaded. Retry the failed uploads before saving.');
      }
      const gallery = this.photos.filter((photo) => photo.url);
      const selectedPrimary = gallery.find((photo) => photo.id === this.primaryPhotoId) ?? gallery[0];
      const orderedGallery = selectedPrimary
        ? [selectedPrimary, ...gallery.filter((photo) => photo.id !== selectedPrimary.id)]
        : [];
      const primaryPhoto = orderedGallery[0];
      const payload: Omit<Facility, 'id'> = {
        ...this.form,
        name,
        address,
        description: this.form.description.trim() || undefined,
        barangay: this.form.barangay.trim() || undefined,
        city: this.form.city.trim() || undefined,
        province: this.form.province.trim() || undefined,
        region: this.form.region.trim() || undefined,
        contactNumber: this.form.contactNumber.trim() || undefined,
        email: this.form.email.trim() || undefined,
        website: this.form.website.trim() || undefined,
        imageUrl: primaryPhoto?.url,
        imageUrls: orderedGallery.map((photo) => photo.url),
        photos: orderedGallery.map((photo): FacilityPhotoData => ({
          secureUrl: photo.url,
          ...(photo.publicId ? { publicId: photo.publicId } : {}),
        })),
        services: splitList(this.form.services),
        amenities: splitList(this.form.amenities),
        timeZone: this.form.timeZone.trim() || undefined,
        operatingHours,
        isSample: false,
      };
      if (this.editingId) await this.facilitiesService.updateFacility(this.editingId, payload);
      else await this.facilitiesService.createFacility(payload);
      await this.notify(this.editingId ? 'Facility updated.' : 'Facility created.');
      this.newFacility();
      this.activeTab = 'facilities';
      await this.loadRecords();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not save facility.';
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.clearPhotoPreviews();
    this.pickerMap?.remove();
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeLeaving(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = '';
  }

  async delete(record: Facility): Promise<void> {
    if (this.deletingId) return;
    const alert = await this.alertController.create({
      header: 'Delete facility?',
      message: `This permanently removes “${record.name}” from the directory.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'destructive') return;
    this.deletingId = record.id;
    try {
      await this.facilitiesService.deleteFacility(record.id);
      this.records = this.records.filter((item) => item.id !== record.id);
      if (this.selectedRecord?.id === record.id) this.selectedRecord = null;
      await this.notify('Facility deleted.');
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not delete facility.';
      this.changeDetector.markForCheck();
    } finally {
      this.deletingId = null;
    }
  }

  private emptyForm() {
    return {
      name: '', category: 'clinic' as FacilityCategory, description: '', address: '', barangay: '',
      city: '', province: '', region: '', contactNumber: '', email: '', website: '', latitude: undefined as number | undefined,
      longitude: undefined as number | undefined, services: '', amenities: '',
      isVerified: false, isActive: true, timeZone: '',
    };
  }

  private createSchedule(): ScheduleDay[] {
    return this.weekdays.map(({ key, label }) => ({
      key, label, included: false, closed: false, open: '09:00', close: '17:00',
    }));
  }

  private buildOperatingHours(): OperatingHours | undefined {
    const configured = this.schedule.filter((day) => day.included);
    const invalidDay = configured.find((day) => !day.closed
      && (!day.open || !day.close || day.open >= day.close));
    if (invalidDay) throw new Error(`${invalidDay.label}: choose a valid opening and closing time.`);
    if (!configured.length) return undefined;
    return Object.fromEntries(configured.map((day) => [
      day.key,
      day.closed ? { closed: true } : { open: day.open, close: day.close, closed: false },
    ])) as OperatingHours;
  }

  private currentFormState(): string {
    return JSON.stringify({
      form: this.form,
      schedule: this.schedule,
      photos: this.photos.map(({ id, url, publicId, file }) => ({ id, url, publicId, file: file?.name })),
      primaryPhotoId: this.primaryPhotoId,
    });
  }

  private captureInitialFormState(): void {
    this.initialFormState = this.currentFormState();
  }

  private async confirmDiscardChanges(header = 'Discard unsaved changes?'): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message: 'Your unsaved facility changes will be lost.',
      buttons: [
        { text: 'Keep editing', role: 'cancel' },
        { text: 'Discard changes', role: 'destructive' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'destructive';
  }

  private setPickerMarker(latitude: number, longitude: number): void {
    if (!this.pickerMap) return;
    if (this.pickerMarker) this.pickerMarker.setLatLng([latitude, longitude]);
    else this.pickerMarker = L.circleMarker([latitude, longitude], {
      radius: 8, color: '#fff', weight: 3, fillColor: '#1976d2', fillOpacity: 1,
    }).addTo(this.pickerMap);
  }

  private validatePhoto(file: File): string | null {
    return facilityPhotoValidationError(file);
  }

  private async uploadPhoto(photo: FacilityPhoto): Promise<void> {
    if (!photo.file || photo.uploading) return;
    photo.uploading = true;
    photo.progress = 0;
    photo.error = undefined;
    this.changeDetector.markForCheck();
    try {
      const result = await this.cloudinary.upload(photo.file, (progress) => {
        photo.progress = progress;
        this.changeDetector.markForCheck();
      });
      this.releasePreview(photo);
      photo.url = result.secureUrl;
      photo.publicId = result.publicId;
      photo.previewUrl = cloudinaryImageUrl(result.secureUrl, 320) ?? result.secureUrl;
      photo.file = undefined;
      photo.progress = 100;
    } catch (error) {
      photo.error = error instanceof Error ? error.message : 'Photo upload failed. Please retry.';
    } finally {
      photo.uploading = false;
      this.changeDetector.markForCheck();
    }
  }

  private existingPhoto(url: string, publicId?: string): FacilityPhoto {
    return {
      id: this.nextPhotoId++,
      url,
      publicId,
      previewUrl: cloudinaryImageUrl(url, 320) ?? url,
      progress: 100,
      uploading: false,
    };
  }

  private releasePreview(photo: FacilityPhoto): void {
    if (photo.previewUrl.startsWith('blob:')) URL.revokeObjectURL(photo.previewUrl);
  }

  private clearPhotoPreviews(): void {
    this.photos.forEach((photo) => this.releasePreview(photo));
  }

  private async notify(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function isValidWebsite(value: string): boolean {
  try {
    const url = new URL(value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
}
