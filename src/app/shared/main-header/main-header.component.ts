import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonButtons, IonHeader, IonIcon, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-main-header',
  templateUrl: './main-header.component.html',
  styleUrl: './main-header.component.scss',
  imports: [IonButton, IonButtons, IonHeader, IonIcon, IonToolbar, RouterLink],
})
export class MainHeaderComponent {}
