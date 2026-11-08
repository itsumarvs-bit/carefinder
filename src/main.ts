import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline, alertCircleOutline, appsOutline, arrowBackOutline, arrowForwardOutline, bandageOutline,
  callOutline, checkmarkCircle, chevronForwardOutline, createOutline, eyeOutline, flaskOutline, globeOutline,
  heart, heartOutline, homeOutline, informationCircleOutline, listOutline, locateOutline, locationOutline,
  logOutOutline, mailOutline, mapOutline, medical, medkitOutline, navigateOutline, personCircleOutline,
  personOutline, pinOutline, pulseOutline, searchOutline, settingsOutline, shieldCheckmarkOutline,
  sparklesOutline, timeOutline, trashOutline, warningOutline,
} from 'ionicons/icons';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

addIcons({
  'add-outline': addOutline,
  'alert-circle-outline': alertCircleOutline,
  'apps-outline': appsOutline,
  'arrow-back-outline': arrowBackOutline,
  'arrow-forward-outline': arrowForwardOutline,
  'bandage-outline': bandageOutline,
  'call-outline': callOutline,
  'checkmark-circle': checkmarkCircle,
  'chevron-forward-outline': chevronForwardOutline,
  'create-outline': createOutline,
  'eye-outline': eyeOutline,
  'flask-outline': flaskOutline,
  'globe-outline': globeOutline,
  heart,
  'heart-outline': heartOutline,
  'home-outline': homeOutline,
  'information-circle-outline': informationCircleOutline,
  'list-outline': listOutline,
  'locate-outline': locateOutline,
  'location-outline': locationOutline,
  'log-out-outline': logOutOutline,
  'mail-outline': mailOutline,
  'map-outline': mapOutline,
  medical,
  'medkit-outline': medkitOutline,
  'navigate-outline': navigateOutline,
  'person-circle-outline': personCircleOutline,
  'person-outline': personOutline,
  'pin-outline': pinOutline,
  'pulse-outline': pulseOutline,
  'search-outline': searchOutline,
  'settings-outline': settingsOutline,
  'shield-checkmark-outline': shieldCheckmarkOutline,
  'sparkles-outline': sparklesOutline,
  'time-outline': timeOutline,
  'trash-outline': trashOutline,
  'warning-outline': warningOutline,
});

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
  ],
});
