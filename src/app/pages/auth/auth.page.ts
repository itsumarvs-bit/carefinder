import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonSpinner,
} from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  imports: [
    FormsModule,
    RouterLink,
    IonButton,
    IonContent,
    IonIcon,
    IonInput,
    IonItem,
    IonSpinner,
  ],
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly requestTimeoutMs = 15000;

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

    // Prevent duplicate requests.
    if (this.loading) return;

    // Validate email.
    const email = this.email.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }

    // Validate password.
    if (!this.password || this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters.';
      return;
    }

    // Validate registration name.
    if (this.isRegister && !this.displayName.trim()) {
      this.errorMessage = 'Enter your name to create an account.';
      return;
    }

    this.loading = true;
    this.changeDetector.markForCheck();

    try {
      const authRequest = this.isRegister
        ? this.auth.register(this.displayName.trim(), email, this.password)
        : this.auth.login(email, this.password);

      await this.withTimeout(authRequest, this.requestTimeoutMs);

      const returnUrl =
        this.route.snapshot.queryParamMap.get('returnUrl') || '/profile';

      await this.router.navigateByUrl(returnUrl);
    } catch (error) {
      console.error('[CareFinder] Authentication error:', error);

      this.errorMessage = this.firebaseMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async resetPassword(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.loading) return;

    const email = this.email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorMessage = 'Enter your email address above first.';
      return;
    }

    this.loading = true;
    this.changeDetector.markForCheck();

    try {
      await this.withTimeout(
        this.auth.resetPassword(email),
        this.requestTimeoutMs,
      );

      this.successMessage = 'Password reset email sent. Check your inbox.';
    } catch (error) {
      console.error('[CareFinder] Password reset error:', error);

      this.errorMessage = this.firebaseMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  private withTimeout<T>(
    request: Promise<T>,
    milliseconds: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            'Firebase Authentication timed out after 15 seconds. Please check your internet connection and Firebase configuration.',
          ),
        );
      }, milliseconds);

      request.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private firebaseMessage(error: unknown): string {
    const code = (error as { code?: string })?.code;

    const messages: Record<string, string> = {
      'auth/email-already-in-use': 'An account already exists with this email.',

      'auth/invalid-credential': 'Email or password is incorrect.',

      'auth/invalid-email': 'Enter a valid email address.',

      'auth/weak-password':
        'Choose a stronger password with at least 6 characters.',

      'auth/too-many-requests':
        'Too many attempts. Wait a moment and try again.',

      'auth/network-request-failed':
        'Network connection failed. Check your internet and try again.',

      'auth/user-not-found': 'No account was found for this email.',

      'auth/wrong-password': 'Email or password is incorrect.',

      'auth/operation-not-allowed':
        'Email and password login is not enabled in Firebase.',

      'auth/invalid-api-key':
        'Firebase API key is invalid. Check your Firebase configuration.',

      'auth/app-not-authorized':
        'This application is not authorized to access Firebase.',

      'auth/unauthorized-domain':
        'This application domain is not authorized in Firebase.',

      'auth/web-storage-unsupported':
        'The app cannot access browser storage required by Firebase.',
    };

    if (code) {
      return (
        messages[code] ?? `Authentication failed (${code}). Please try again.`
      );
    }

    return error instanceof Error
      ? error.message
      : 'Authentication failed. Please try again.';
  }
}
