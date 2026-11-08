import { Injectable, inject } from '@angular/core';
import {
  addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where, onSnapshot, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { Facility, FacilityCategory } from '../models/facility.model';
import { demoFacilities } from './facility-data';
import { FirebaseService } from './firebase.service';
import { facilityImportBatchSize, osmFacilityDocumentId } from './facility-import';

export type ImportedFacilityInput = Omit<Facility, 'id' | 'isSample'>;

@Injectable({ providedIn: 'root' })
export class FacilityService {
  private readonly firebase = inject(FirebaseService);
  readonly isConfigured = this.firebase.isConfigured;

  watchActiveFacilities(): Observable<Facility[]> {
    if (!this.isConfigured) return of(demoFacilities);
    return new Observable<Facility[]>((subscriber) => onSnapshot(
      query(collection(this.requireFirestore(), 'facilities'), where('isActive', '==', true)),
      (result) => subscriber.next(result.docs.map((item) => ({ ...item.data(), id: item.id } as Facility))),
      (error) => {
        console.error('Unable to load facilities from Firestore.', error);
        subscriber.error(error);
      },
    ));
  }

  async getAdminFacilities(): Promise<Facility[]> {
    this.requireFirebase();
    const result = await getDocs(collection(this.requireFirestore(), 'facilities'));
    return result.docs.map((item) => ({ ...item.data(), id: item.id } as Facility));
  }

  async createFacility(input: Omit<Facility, 'id'>): Promise<string> {
    this.requireFirebase();
    const { isSample: _isSample, ...data } = input;
    const fields = omitUndefined(data);
    const result = await addDoc(collection(this.requireFirestore(), 'facilities'), {
      ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    return result.id;
  }

  async updateFacility(id: string, input: Partial<Facility>): Promise<void> {
    this.requireFirebase();
    const { id: _id, isSample: _isSample, ...data } = input;
    const fields = omitUndefined(data);
    await updateDoc(doc(this.requireFirestore(), 'facilities', id), {
      ...fields, updatedAt: serverTimestamp(),
    });
  }

  async deleteFacility(id: string): Promise<void> {
    this.requireFirebase();
    await deleteDoc(doc(this.requireFirestore(), 'facilities', id));
  }

  async importFacilityBatch(facilities: readonly ImportedFacilityInput[]): Promise<void> {
    if (facilities.length > facilityImportBatchSize) throw new Error(`Facility import batches cannot exceed ${facilityImportBatchSize} records.`);
    if (!facilities.length) return;
    this.requireFirebase();
    const firestore = this.requireFirestore();
    const batch = writeBatch(firestore);
    for (const facility of facilities) {
      if (!facility.osmType || !facility.osmId) {
        throw new Error('Every imported facility must have an OpenStreetMap element type and ID.');
      }
      batch.set(doc(firestore, 'facilities', osmFacilityDocumentId(facility.osmType, facility.osmId)), {
        ...omitUndefined(facility),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  categoryCounts(facilities: Facility[]): Record<FacilityCategory, number> {
    return facilities.reduce((counts, facility) => {
      counts[facility.category] += 1;
      return counts;
    }, { hospital: 0, clinic: 0, pharmacy: 0, health_center: 0 });
  }

  private requireFirebase(): void {
    if (!this.isConfigured) throw new Error('Configure Firebase in src/environments before using facility administration.');
  }

  private requireFirestore() {
    const firestore = this.firebase.firestore;
    if (!firestore) throw new Error('Firebase Firestore is not configured.');
    return firestore;
  }
}

function omitUndefined(input: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
