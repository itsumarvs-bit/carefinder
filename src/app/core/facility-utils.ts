import { Facility, OperatingDay } from '../models/facility.model';

export function facilityDistanceKm(from: GeolocationCoordinates | null | undefined, facility: Facility): number | null {
  if (!from || typeof from.latitude !== 'number' || typeof from.longitude !== 'number') return null;
  if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') return null;

  const latitude = facility.latitude;
  const longitude = facility.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(from.latitude) || !Number.isFinite(from.longitude)) {
    return null;
  }

  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitude - from.latitude);
  const longitudeDelta = radians(longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const safeA = Math.min(1, Math.max(0, a));
  return 6371 * 2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));
}

export function facilityOpenStatus(facility: Facility, now = new Date()): string {
  const hours = facility.operatingHours;
  if (!hours || !facility.timeZone) return 'Hours unavailable';

  let localDay: string;
  let localTime: string;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: facility.timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    localDay = normalizeDayName(parts.find((part) => part.type === 'weekday')?.value ?? '');
    localTime = `${parts.find((part) => part.type === 'hour')?.value ?? '00'}:${parts.find((part) => part.type === 'minute')?.value ?? '00'}`;
  } catch {
    return 'Hours unavailable';
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayIndex = weekdays.indexOf(localDay);
  if (todayIndex < 0) return 'Hours unavailable';

  const normalizedHours = Object.fromEntries(
    Object.entries(hours).map(([day, schedule]) => [normalizeDayName(day), schedule]),
  ) as Partial<Record<string, OperatingDay>>;

  const today = normalizedHours[localDay] as OperatingDay | undefined;
  const previousDayName = weekdays[(todayIndex + 6) % weekdays.length];
  const previousDay = normalizedHours[previousDayName] as OperatingDay | undefined;
  const current = toMinutes(localTime);

  if (today?.closed !== true && validTime(today?.open) && validTime(today?.close)) {
    const opening = toMinutes(today.open!);
    const closing = toMinutes(today.close!);
    if (closing <= opening && (current >= opening || current < closing)) return 'Open now';
    if (closing > opening && current >= opening && current < closing) return 'Open now';
  }
  if (previousDay?.closed !== true && validTime(previousDay?.open) && validTime(previousDay?.close)) {
    const previousOpening = toMinutes(previousDay.open!);
    const previousClosing = toMinutes(previousDay.close!);
    if (previousClosing <= previousOpening && current < previousClosing) return 'Open now';
  }
  if (!today || today.closed === undefined) return 'Hours unavailable';
  if (today.closed) return 'Closed';
  return validTime(today.open) && validTime(today.close) ? 'Closed' : 'Hours unavailable';
}

function normalizeDayName(value: string): string {
  return value.trim().toLowerCase();
}

function validTime(value?: string): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function toMinutes(value?: string): number {
  if (!value) return Number.NaN;
  const [hour, minute] = value.trim().split(':');
  if (hour === undefined || minute === undefined) return Number.NaN;
  const parsedHour = Number(hour);
  const parsedMinute = Number(minute);
  if (!Number.isFinite(parsedHour) || !Number.isFinite(parsedMinute)) return Number.NaN;
  return parsedHour * 60 + parsedMinute;
}

export function directionsUrl(facility: Facility): string {
  const destination = typeof facility.latitude === 'number' && typeof facility.longitude === 'number'
    ? `${facility.latitude},${facility.longitude}`
    : facility.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
