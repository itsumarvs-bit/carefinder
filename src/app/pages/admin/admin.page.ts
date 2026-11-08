import { CommonModule, JsonPipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AlertController, IonButton, IonCheckbox, IonContent, IonIcon,
  IonInput, IonItem, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonTextarea, ToastController,
} from '@ionic/angular';
import { FacilityService } from '../../core/facility.service';
import { Facility, FacilityCategory, OperatingHours, categoryLabels } from '../../models/facility.model';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  imports: [
    CommonModule, FormsModule, JsonPipe, RouterLink, IonButton, IonCheckbox, IonContent, IonIcon, IonInput, IonItem,
    IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonTextarea,
  ],
})
export class AdminPage {
  private readonly facilitiesService = inject(FacilityService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);

  readonly categoryLabels = categoryLabels;
  readonly categoryOptions: FacilityCategory[] = ['hospital', 'clinic', 'pharmacy', 'health_center'];
  records: Facility[] = [];
  selectedRecord: Facility | null = null;
  loading = false;
  saving = false;
  search = '';
  categoryFilter: FacilityCategory | 'all' = 'all';
  errorMessage = '';
  editingId: string | null = null;

  form = this.emptyForm();
  hoursJson = '';

  get filteredRecords(): Facility[] {
    const search = this.search.trim().toLowerCase();
    return this.records.filter((record) => {
      const matchesCategory = this.categoryFilter === 'all' || record.category === this.categoryFilter;
      return matchesCategory && (!search
        || `${record.name} ${record.category} ${record.address} ${record.city ?? ''}`.toLowerCase().includes(search));
    });
  }

  get verifiedCount(): number {
    return this.records.filter((record) => record.isVerified).length;
  }

  get activeCount(): number {
    return this.records.filter((record) => record.isActive).length;
  }

  categoryCount(category: FacilityCategory): number {
    return this.records.filter((record) => record.category === category).length;
  }

  view(record: Facility): void {
    this.selectedRecord = this.selectedRecord?.id === record.id ? null : record;
  }

  async ionViewWillEnter(): Promise<void> {
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
    this.editingId = record.id;
    this.form = {
      name: record.name,
      category: record.category,
      description: record.description ?? '',
      address: record.address,
      barangay: record.barangay ?? '',
      city: record.city ?? '',
      province: record.province ?? '',
      contactNumber: record.contactNumber ?? '',
      email: record.email ?? '',
      website: record.website ?? '',
      latitude: record.latitude,
      longitude: record.longitude,
      imageUrl: record.imageUrl ?? '',
      services: (record.services ?? []).join(', '),
      amenities: (record.amenities ?? []).join(', '),
      isVerified: record.isVerified,
      isActive: record.isActive,
      timeZone: record.timeZone ?? '',
    };
    this.hoursJson = record.operatingHours ? JSON.stringify(record.operatingHours, null, 2) : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  newFacility(): void {
    this.editingId = null;
    this.form = this.emptyForm();
    this.hoursJson = '';
  }

  async submit(): Promise<void> {
    this.errorMessage = '';
    const name = this.form.name.trim();
    const address = this.form.address.trim();
    if (!name || !address) {
      this.errorMessage = 'Facility name and address are required.';
      return;
    }
    if ((this.form.latitude === undefined) !== (this.form.longitude === undefined)) {
      this.errorMessage = 'Enter both latitude and longitude, or leave both blank.';
      return;
    }
    if (this.form.latitude !== undefined
      && (this.form.latitude < -90 || this.form.latitude > 90 || this.form.longitude! < -180 || this.form.longitude! > 180)) {
      this.errorMessage = 'Coordinates are outside the valid latitude or longitude range.';
      return;
    }

    let operatingHours: OperatingHours | undefined;
    if (this.hoursJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(this.hoursJson);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Hours must be a JSON object.');
        operatingHours = parsed as OperatingHours;
      } catch (error) {
        this.errorMessage = error instanceof Error ? `Operating hours: ${error.message}` : 'Operating hours must be valid JSON.';
        return;
      }
    }

    this.saving = true;
    try {
      const payload: Omit<Facility, 'id'> = {
        ...this.form,
        name,
        address,
        description: this.form.description.trim() || undefined,
        barangay: this.form.barangay.trim() || undefined,
        city: this.form.city.trim() || undefined,
        province: this.form.province.trim() || undefined,
        contactNumber: this.form.contactNumber.trim() || undefined,
        email: this.form.email.trim() || undefined,
        website: this.form.website.trim() || undefined,
        imageUrl: this.form.imageUrl.trim() || undefined,
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
      await this.loadRecords();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not save facility.';
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async delete(record: Facility): Promise<void> {
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
    try {
      await this.facilitiesService.deleteFacility(record.id);
      this.records = this.records.filter((item) => item.id !== record.id);
      if (this.selectedRecord?.id === record.id) this.selectedRecord = null;
      await this.notify('Facility deleted.');
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not delete facility.';
      this.changeDetector.markForCheck();
    }
  }

  private emptyForm() {
    return {
      name: '', category: 'clinic' as FacilityCategory, description: '', address: '', barangay: '',
      city: '', province: '', contactNumber: '', email: '', website: '', latitude: undefined as number | undefined,
      longitude: undefined as number | undefined, imageUrl: '', services: '', amenities: '',
      isVerified: false, isActive: true, timeZone: '',
    };
  }

  private async notify(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
