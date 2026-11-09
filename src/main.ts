import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline, alertCircleOutline, appsOutline, arrowBackOutline, arrowForwardOutline, bandageOutline, businessOutline,
  callOutline, checkmarkCircle, checkmarkOutline, chevronDownOutline, chevronForwardOutline, chevronUpOutline, closeCircleOutline, closeOutline, cloudUploadOutline, createOutline, eyeOutline, flaskOutline, globeOutline,
  heart, heartOutline, homeOutline, imagesOutline, informationCircleOutline, listOutline, locateOutline, locationOutline,
  logOutOutline, mailOutline, mapOutline, medical, medkitOutline, navigateCircleOutline, navigateOutline,
  pauseCircleOutline, pauseOutline, personCircleOutline, personOutline, pinOutline, playOutline, pulseOutline, repeatOutline,
  searchOutline, settingsOutline, shieldCheckmarkOutline, sparklesOutline, stopCircleOutline, timeOutline,
  trashOutline, volumeHighOutline, volumeMuteOutline, warningOutline,
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
  'business-outline': businessOutline,
  'call-outline': callOutline,
  'checkmark-circle': checkmarkCircle,
  'checkmark-outline': checkmarkOutline,
  'chevron-down-outline': chevronDownOutline,
  'chevron-forward-outline': chevronForwardOutline,
  'chevron-up-outline': chevronUpOutline,
  'close-outline': closeOutline,
  'close-circle-outline': closeCircleOutline,
  'cloud-upload-outline': cloudUploadOutline,
  'create-outline': createOutline,
  'eye-outline': eyeOutline,
  'flask-outline': flaskOutline,
  'globe-outline': globeOutline,
  heart,
  'heart-outline': heartOutline,
  'home-outline': homeOutline,
  'images-outline': imagesOutline,
  'information-circle-outline': informationCircleOutline,
  'list-outline': listOutline,
  'locate-outline': locateOutline,
  'location-outline': locationOutline,
  'log-out-outline': logOutOutline,
  'mail-outline': mailOutline,
  'map-outline': mapOutline,
  medical,
  'medkit-outline': medkitOutline,
  'navigate-circle-outline': navigateCircleOutline,
  'navigate-outline': navigateOutline,
  'pause-outline': pauseOutline,
  'pause-circle-outline': pauseCircleOutline,
  'person-circle-outline': personCircleOutline,
  'person-outline': personOutline,
  'pin-outline': pinOutline,
  'play-outline': playOutline,
  'pulse-outline': pulseOutline,
  'repeat-outline': repeatOutline,
  'search-outline': searchOutline,
  'settings-outline': settingsOutline,
  'shield-checkmark-outline': shieldCheckmarkOutline,
  'sparkles-outline': sparklesOutline,
  'stop-circle-outline': stopCircleOutline,
  'time-outline': timeOutline,
  'trash-outline': trashOutline,
  'volume-high-outline': volumeHighOutline,
  'volume-mute-outline': volumeMuteOutline,
  'warning-outline': warningOutline,
});

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
  ],
});
