import { Component, OnDestroy, OnInit } from '@angular/core';
import { IonApp, IonIcon, IonRouterOutlet } from '@ionic/angular';
import { MainHeaderComponent } from './shared/main-header/main-header.component';
import { MainNavigationComponent } from './shared/main-navigation/main-navigation.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrl: './app.component.scss',
  imports: [IonApp, IonIcon, IonRouterOutlet, MainHeaderComponent, MainNavigationComponent],
})
export class AppComponent implements OnInit, OnDestroy {
  introVisible = true;
  introLeaving = false;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.leaveTimer = setTimeout(() => {
      this.introLeaving = true;
    }, reducedMotion ? 100 : 1050);
    this.hideTimer = setTimeout(() => {
      this.introVisible = false;
    }, reducedMotion ? 350 : 1400);
  }

  ngOnDestroy(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}
