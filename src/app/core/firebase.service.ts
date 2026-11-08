import { Injectable } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  readonly isConfigured = Boolean(
    environment.firebase.apiKey && environment.firebase.authDomain
    && environment.firebase.projectId && environment.firebase.appId,
  );
  readonly app: FirebaseApp | null = this.isConfigured ? initializeApp(environment.firebase) : null;
  readonly auth: Auth | null = this.app ? getAuth(this.app) : null;
  readonly firestore: Firestore | null = this.app ? getFirestore(this.app) : null;
}
