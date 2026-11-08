import { Injectable, inject } from '@angular/core';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { FirebaseService } from './firebase.service';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly firebase = inject(FirebaseService);

  watchFavoriteIds(): Observable<string[]> {
    const user = this.firebase.auth?.currentUser;
    const firestore = this.firebase.firestore;
    if (!user || !firestore) return of([]);
    return new Observable((subscriber) => onSnapshot(
      collection(firestore, 'users', user.uid, 'favorites'),
      (snapshot) => subscriber.next(snapshot.docs.map((item) => item.id)),
      (error) => subscriber.error(error),
    ));
  }

  async toggle(facilityId: string, isFavorite: boolean): Promise<void> {
    const user = this.firebase.auth?.currentUser;
    const firestore = this.firebase.firestore;
    if (!user) throw new Error('Sign in to save facilities.');
    if (!firestore) throw new Error('Firebase is not configured.');
    const favorite = doc(firestore, 'users', user.uid, 'favorites', facilityId);
    if (isFavorite) await deleteDoc(favorite);
    else await setDoc(favorite, { facilityId, createdAt: serverTimestamp() });
  }
}
