import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { MainHeaderComponent } from './shared/main-header/main-header.component';
import { MainNavigationComponent } from './shared/main-navigation/main-navigation.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, MainHeaderComponent, MainNavigationComponent],
})
export class AppComponent {
  constructor() {}
}
