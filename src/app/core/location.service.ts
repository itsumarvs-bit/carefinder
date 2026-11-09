import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';

@Injectable({ providedIn: 'root' })
export class LocationService {
  private watchId?: string;
  private readonly watchIds = new Set<string>();
  private watchGeneration = 0;

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

  async getNavigationPosition(): Promise<Position> {
    try {
      if (Capacitor.isNativePlatform()) {
        const permissions = await Geolocation.checkPermissions();
        if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
          const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
          if (requested.location !== 'granted' && requested.coarseLocation !== 'granted') {
            throw new Error('Location permission was denied. Allow location access in Settings to start navigation.');
          }
        }
      }
      return await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    } catch (error) {
      if (error instanceof Error && /denied|permission/i.test(error.message)) {
        throw new Error('Location permission was denied. Allow location access in Settings or your browser to start navigation.');
      }
      if (error instanceof Error && /location services|location.*disabled/i.test(error.message)) {
        throw new Error('Location services are unavailable. Turn on GPS/location services and try again.');
      }
      if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
        throw new Error('Could not get a GPS fix in time. Move to an open area and try again.');
      }
      throw new Error('Could not determine your current location. Check location permission and GPS, then try again.');
    }
  }

  async watchNavigationPosition(
    onPosition: (position: Position) => void,
    onError: (error: unknown) => void,
  ): Promise<void> {
    await this.stopWatchingNavigationPosition();
    const generation = ++this.watchGeneration;
    try {
      const watchId = await Geolocation.watchPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 1000,
        interval: 3000,
        minimumUpdateInterval: 3000,
      }, (position, error) => {
        if (error) {
          onError(error);
          return;
        }
        if (position) onPosition(position);
      });
      this.watchIds.add(watchId);
      if (generation !== this.watchGeneration) {
        await Geolocation.clearWatch({ id: watchId });
        this.watchIds.delete(watchId);
        return;
      }
      this.watchId = watchId;
    } catch (error) {
      console.error('Capacitor GPS tracking could not be started.', error);
      throw new Error('Could not start GPS tracking. Check location permission and try again.');
    }
  }

  async stopWatchingNavigationPosition(): Promise<void> {
    this.watchGeneration += 1;
    let cleanupError: unknown;
    let failed = false;
    for (const watchId of this.watchIds) {
      try {
        await Geolocation.clearWatch({ id: watchId });
        this.watchIds.delete(watchId);
        if (this.watchId === watchId) this.watchId = undefined;
      } catch (error) {
        if (!failed) cleanupError = error;
        failed = true;
      }
    }
    if (failed) throw cleanupError;
  }
}
