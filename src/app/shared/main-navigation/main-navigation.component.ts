import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';

@Component({
  selector: 'app-main-navigation',
  templateUrl: './main-navigation.component.html',
  styleUrl: './main-navigation.component.scss',
  imports: [IonIcon, RouterLink, RouterLinkActive],
})
export class MainNavigationComponent {}
