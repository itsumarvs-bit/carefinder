import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LocationService {
  getCurrentPosition(): Promise<GeolocationPosition> {
    if (!navigator.geolocation) return Promise.reject(new Error('Location is not available in this browser.'));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. You can still search by address.'
        : 'Could not determine your location. You can still search by address.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    ));
  }
}
