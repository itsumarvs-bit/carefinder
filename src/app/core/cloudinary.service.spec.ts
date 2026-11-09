import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import {
  CloudinaryService, cloudinaryImageUrl, facilityPhotoValidationError,
} from './cloudinary.service';
import { environment } from '../../environments/environment';

describe('CloudinaryService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads to the unsigned facility preset and reports progress and Cloudinary identifiers', async () => {
    let progress = 0;
    const requests: FakeXMLHttpRequest[] = [];
    class FakeXMLHttpRequest {
      status = 200;
      responseText = JSON.stringify({
        secure_url: `https://res.cloudinary.com/${environment.cloudinary.cloudName}/image/upload/facility.jpg`,
        public_id: 'carefinder/facilities/facility',
      });
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;

      constructor() {
        requests.push(this);
      }

      open(method: string, url: string): void {
        expect(method).toBe('POST');
        expect(url).toBe(`https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/image/upload`);
      }

      send(body: FormData): void {
        expect(body.get('upload_preset')).toBe(environment.cloudinary.uploadPreset);
        expect(body.get('folder')).toBe(environment.cloudinary.folder);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { hasAdminClaim: async () => true } },
      ],
    });
    try {
      const service = runInInjectionContext(injector, () => new CloudinaryService());
      const result = await service.upload(new File(['photo'], 'clinic.jpg', { type: 'image/jpeg' }), (value) => {
        progress = value;
      });
      expect(result).toEqual({
        secureUrl: `https://res.cloudinary.com/${environment.cloudinary.cloudName}/image/upload/facility.jpg`,
        publicId: 'carefinder/facilities/facility',
      });
      expect(progress).toBe(50);
      expect(requests).toHaveLength(1);
    } finally {
      injector.destroy();
    }
  });

  it('refuses uploads when the current user is not an administrator', async () => {
    class UnexpectedXMLHttpRequest {
      constructor() {
        throw new Error('The request must not be created.');
      }
    }
    vi.stubGlobal('XMLHttpRequest', UnexpectedXMLHttpRequest);
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { hasAdminClaim: async () => false } },
      ],
    });
    try {
      const service = runInInjectionContext(injector, () => new CloudinaryService());
      await expect(service.upload(
        new File(['photo'], 'clinic.jpg', { type: 'image/jpeg' }),
        () => undefined,
      )).rejects.toThrow('Only authorized administrators');
    } finally {
      injector.destroy();
    }
  });
});

describe('cloudinaryImageUrl', () => {
  it('adds responsive auto-format and quality transformations only to Cloudinary images', () => {
    expect(cloudinaryImageUrl('https://res.cloudinary.com/demo/image/upload/photo.jpg', 320))
      .toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_320,c_limit/photo.jpg');
    expect(cloudinaryImageUrl('https://example.com/photo.jpg', 320)).toBe('https://example.com/photo.jpg');
    expect(cloudinaryImageUrl(undefined, 320)).toBeUndefined();
  });

  describe('facilityPhotoValidationError', () => {
    it('accepts supported image types and rejects invalid types and oversized files', () => {
      expect(facilityPhotoValidationError(new File(['photo'], 'clinic.webp', { type: 'image/webp' }))).toBeNull();
      expect(facilityPhotoValidationError(new File(['text'], 'notes.txt', { type: 'text/plain' })))
        .toContain('JPG, JPEG, PNG, or WEBP');
      const oversizedPhoto = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
      expect(facilityPhotoValidationError(oversizedPhoto)).toContain('5 MB or smaller');
    });
  });
});
