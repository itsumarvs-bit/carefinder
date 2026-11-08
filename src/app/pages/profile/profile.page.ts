import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonInput, IonItem, IonSpinner, ToastController,
} from '@ionic/angular';
import { User } from 'firebase/auth';
import { Observable, of, shareReplay, switchMap, tap } from 'rxjs';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  imports: [
    CommonModule, FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonInput, IonItem, IonSpinner,
  ],
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);

  readonly user$: Observable<User | null> = this.auth.user$.pipe(
    tap((user) => { if (user && !this.displayName) this.displayName = user.displayName ?? ''; }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  readonly isAdmin$ = this.user$.pipe(switchMap((user) => user ? this.auth.hasAdminClaim() : of(false)));
  displayName = '';
  saving = false;

  async saveProfile(): Promise<void> {
    if (!this.displayName.trim()) {
      await this.showToast('Enter a name before saving.');
      return;
    }
    this.saving = true;
    try {
      await this.auth.updateDisplayName(this.displayName.trim());
      await this.showToast('Profile updated.');
    } catch (error) {
      await this.showToast(error instanceof Error ? error.message : 'Could not update your profile.');
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.auth.logout();
      await this.router.navigate(['/home']);
    } catch (error) {
      await this.showToast(error instanceof Error ? error.message : 'Could not sign out.');
    }
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2400, position: 'bottom' });
    await toast.present();
  }
}
