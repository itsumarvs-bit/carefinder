
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonInput, IonItem, IonSpinner } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonInput, IonItem, IonSpinner],
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isRegister = false;
  displayName = '';
  email = '';
  password = '';
  loading = false;
  errorMessage = '';
  successMessage = '';

  async submit(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }
    if (!this.password || this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters.';
      return;
    }
    if (this.isRegister && !this.displayName.trim()) {
      this.errorMessage = 'Enter your name to create an account.';
      return;
    }
    this.loading = true;
    try {
      if (this.isRegister) await this.auth.register(this.displayName.trim(), this.email.trim(), this.password);
      else await this.auth.login(this.email.trim(), this.password);
      await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('returnUrl') || '/profile');
    } catch (error) {
      this.errorMessage = this.firebaseMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async resetPassword(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.errorMessage = 'Enter your email address above first.';
      return;
    }
    this.loading = true;
    try {
      await this.auth.resetPassword(this.email.trim());
      this.successMessage = 'Password reset email sent. Check your inbox.';
    } catch (error) {
      this.errorMessage = this.firebaseMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  private firebaseMessage(error: unknown): string {
    const code = (error as { code?: string })?.code;
    const messages: Record<string, string> = {
      'auth/email-already-in-use': 'An account already exists with this email.',
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
      'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
      'auth/network-request-failed': 'Network connection failed. Check your internet and try again.',
      'auth/user-not-found': 'No account was found for this email.',
      'auth/wrong-password': 'Email or password is incorrect.',
    };
    return code ? (messages[code] ?? 'Authentication failed. Please try again.') : error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
}
