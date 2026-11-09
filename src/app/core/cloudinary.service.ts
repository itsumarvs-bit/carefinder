import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

export function facilityPhotoValidationError(file: File): string | null {
  const allowedTypes: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/jpg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
  };
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowedTypes[file.type.toLowerCase()]?.includes(extension)) {
    return `${file.name}: choose a JPG, JPEG, PNG, or WEBP image.`;
  }
  if (file.size > 5 * 1024 * 1024) return `${file.name}: each photo must be 5 MB or smaller.`;
  return null;
}

@Injectable({ providedIn: 'root' })
export class CloudinaryService {
  private readonly auth = inject(AuthService);

  async upload(
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<CloudinaryUploadResult> {
    const validationError = facilityPhotoValidationError(file);
    if (validationError) throw new Error(validationError);
    if (!await this.auth.hasAdminClaim()) {
      throw new Error('Only authorized administrators can upload facility photos.');
    }

    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', environment.cloudinary.uploadPreset);
    body.append('folder', environment.cloudinary.folder);

    return new Promise<CloudinaryUploadResult>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `https://api.cloudinary.com/v1_1/${environment.cloudinary.cloudName}/image/upload`);
      request.timeout = 120_000;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onerror = () => reject(new Error('Photo upload failed. Check your internet connection and try again.'));
      request.ontimeout = () => reject(new Error('Photo upload timed out. Check your connection and retry.'));
      request.onload = () => {
        let response: CloudinaryResponse;
        try {
          response = JSON.parse(request.responseText) as CloudinaryResponse;
        } catch {
          reject(new Error('Cloudinary returned an unreadable response. Please retry.'));
          return;
        }

        if (request.status < 200 || request.status >= 300) {
          reject(new Error(response.error?.message || `Photo upload failed (${request.status}). Please retry.`));
          return;
        }
        if (!response.secure_url || !response.public_id) {
          reject(new Error('Cloudinary did not return the uploaded photo details. Please retry.'));
          return;
        }
        resolve({ secureUrl: response.secure_url, publicId: response.public_id });
      };
      request.send(body);
    });
  }
}

interface CloudinaryResponse {
  secure_url?: string;
  public_id?: string;
  error?: { message?: string };
}

export function cloudinaryImageUrl(url: string | undefined, width: number): string | undefined {
  if (!url || !url.startsWith('https://res.cloudinary.com/') || !url.includes('/image/upload/')) return url;
  return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width},c_limit/`);
}
