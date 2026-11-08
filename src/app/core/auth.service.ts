import { Injectable, inject } from '@angular/core';
import {
  User, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword,
  signOut, updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { FirebaseService } from './firebase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebase = inject(FirebaseService);
  readonly user$: Observable<User | null> = new Observable((subscriber) => {
    if (!this.firebase.auth) {
      subscriber.next(null);
      return;
    }
    return onAuthStateChanged(this.firebase.auth, (user) => subscriber.next(user), (error) => subscriber.error(error));
  });
  get currentUser(): User | null {
    return this.firebase.auth?.currentUser ?? null;
  }

  async register(displayName: string, email: string, password: string): Promise<void> {
    const { auth, firestore } = this.requireFirebase();
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName });
    await setDoc(doc(firestore, 'users', credential.user.uid), {
      uid: credential.user.uid, displayName, email, role: 'user',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.requireFirebase().auth, email, password);
  }

  async resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(this.requireFirebase().auth, email);
  }

  async logout(): Promise<void> {
    const auth = this.firebase.auth;
    if (auth) await signOut(auth);
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const { auth, firestore } = this.requireFirebase();
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to update your profile.');
    await updateProfile(user, { displayName });
    await updateDoc(doc(firestore, 'users', user.uid), {
      displayName, updatedAt: serverTimestamp(),
    });
  }

  async hasAdminClaim(): Promise<boolean> {
    const user = this.firebase.auth?.currentUser;
    if (!user) return false;
    const token = await user.getIdTokenResult();
    return token.claims['admin'] === true;
  }

  private requireFirebase() {
    if (!this.firebase.auth || !this.firebase.firestore) {
      throw new Error('Firebase is not configured. Add your Firebase web app settings to src/environments/environment.ts.');
    }
    return { auth: this.firebase.auth, firestore: this.firebase.firestore };
  }
}
