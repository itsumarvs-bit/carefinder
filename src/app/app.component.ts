import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { MainHeaderComponent } from './shared/main-header/main-header.component';
import { MainNavigationComponent } from './shared/main-navigation/main-navigation.component';

let introPlayedThisLaunch = false;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrl: './app.component.scss',
  imports: [IonApp, IonRouterOutlet, MainHeaderComponent, MainNavigationComponent],
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  introVisible = false;
  introLeaving = false;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (introPlayedThisLaunch) return;
    introPlayedThisLaunch = true;
    this.introVisible = true;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.leaveTimer = setTimeout(() => {
      this.introLeaving = true;
      this.changeDetector.detectChanges();
    }, reducedMotion ? 100 : 1050);
    this.hideTimer = setTimeout(() => {
      this.introVisible = false;
      this.changeDetector.detectChanges();
    }, reducedMotion ? 350 : 1400);
  }

  ngOnDestroy(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}
